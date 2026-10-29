// D-Day: 수강신청 당일 (v1 stage 7). Nothing to build: a short pre-check before 10:00, then hold the
// service through the open spike, 신청 집중 and the macro bots until the 10:30 first close, then write the
// postmortem. The traffic is a fixed curve on the D-Day clock (onTick); the incidents are the fixed
// timeline in incidents/dday.ts (departure 9), each one what the curve does to the morning world.
import { gameSec, parseHms, stageAt } from '../../sim/clock';
import { lbView, studentDelivery, withNetMemo } from '../../sim/network';
import type { Health, PlayContext, World } from '../../sim/types';
import {
  botsAllowed,
  dbMax,
  dbPool,
  dbWanted,
  enrollCapacity,
  FOCUS_RPS,
  LATE_RPS,
  macroPress,
  OPEN_RPS,
  WOBBLE,
} from '../incidents/dday';
import { k8sHealth } from '../k8sWorld';
import type { DaySpec, FixedIncident } from '../types';
import { emptyHealth } from '../worlds';
import { BASE_INTERACTIONS, DDAY_CLOCK } from './common';

// ---------- the traffic curve ----------
// Students per second at 10:00 open (OPEN_RPS), 신청 집중 10:05–10:15 (FOCUS_RPS) and 정정 10:15–10:20
// (LATE_RPS) live with the incidents (incidents/dday.ts), whose checks hold the world to those peaks.

/** (game time, students per second) points; linear in between, the last value after 10:30. */
const CURVE: [number, number][] = (
  [
    ['09:50:00', 300],
    ['09:59:00', 600],
    ['10:00:00', 900],
    ['10:00:20', OPEN_RPS],
    ['10:05:00', OPEN_RPS],
    ['10:06:00', FOCUS_RPS],
    ['10:15:00', FOCUS_RPS],
    ['10:16:00', LATE_RPS],
    ['10:20:00', LATE_RPS],
    ['10:20:30', 3000],
    ['10:30:00', 1500],
  ] as [string, number][]
).map(([hms, rps]) => [parseHms(hms), rps]);

/**
 * Students hitting 수강신청 at day time `t`. Once the doors open it wobbles by ±1.5% so the graph looks
 * alive; the peaks stay where the timeline needs them: open ≤ 10,962 (11+ pods needed, so any big enough
 * scale-out passes DB-01's 200 connections; TOR-02 stays under 90%), 신청 집중 ≤ 14,616 (TOR-02 ~115%,
 * yet the L4's 30,000 sessions hold until the bots come).
 */
export function studentRps(t: number): number {
  const g = gameSec(DDAY_CLOCK, t);
  let rps = CURVE[CURVE.length - 1][1];
  if (g <= CURVE[0][0]) rps = CURVE[0][1];
  else {
    for (let i = 1; i < CURVE.length; i++) {
      const [g1, r1] = CURVE[i];
      if (g <= g1) {
        const [g0, r0] = CURVE[i - 1];
        rps = r0 + ((r1 - r0) * (g - g0)) / (g1 - g0);
        break;
      }
    }
  }
  const wobble = g >= parseHms('10:00:20') ? 1 + WOBBLE * Math.sin(t * 0.9) : 1;
  return Math.round(rps * wobble);
}

// ---------- missions ----------

/** Day time of the 10:00 open and of the 10:30 first close. */
const OPEN_AT = stageAt(DDAY_CLOCK, '10:00:00');
export const HOLD_AT = stageAt(DDAY_CLOCK, '10:30:00');

/** Students are served and no macro source is let in. */
const serviceOk = (w: World, h: Health = health(w)): boolean => h.availability >= 0.95 && botsAllowed(w).length === 0;

/** The timeline's own incidents (every run has them, all fired by 10:15:30), as opposed to the DB one. */
const FIXED: FixedIncident[] = [
  { template: 'dday-capacity', trigger: { type: 'stageStart', delay: stageAt(DDAY_CLOCK, '10:00:30'), overlap: true } },
  // The scale-out's side effect: only if the pods ask DB-01 for more connections than it allows (or a
  // DB_POOL that isn't a usable number leaves the running pods without any).
  { template: 'dday-db', trigger: { type: 'condition', when: (w) => enrollCapacity(w) > 0 && (dbPool(w) === null || dbWanted(w) > dbMax(w)) } },
  { template: 'dday-uplink', trigger: { type: 'stageStart', delay: stageAt(DDAY_CLOCK, '10:06:00'), overlap: true } },
  { template: 'dday-macro', trigger: { type: 'stageStart', delay: stageAt(DDAY_CLOCK, '10:15:30'), overlap: true } },
];
const TIMELINE = FIXED.filter((f) => f.trigger.type === 'stageStart').map((f) => f.template);

/**
 * What `hold` waits for at 10:30: the service is fine and every timeline incident has been fixed. After
 * 10:20:30 the traffic alone no longer shows a missing scale-out or bundle, but their incidents stay open
 * (their checks hold the world to the day's peaks), so the report is never written over open incidents.
 */
const held = (w: World, c: PlayContext): boolean => TIMELINE.every((tpl) => c.resolved.some((id) => id.startsWith(`${tpl}:`))) && serviceOk(w);

// ---------- 수강신청 availability from the open to the close ----------
// The engine normally scores availability only between incidents, and on D-Day they overlap from
// 10:00:30 on. So D-Day sets scoreAvailabilityFrom / scoreAvailabilityUntil below: the engine averages
// every second from the 10:00 open until `hold` is done. That one number is the daily report's, the
// stars' and the postmortem board's.

// ---------- health ----------

type Status = 'up' | 'degraded' | 'down';
const status = (ok: number): Status => (ok >= 0.99 ? 'up' : ok > 0 ? 'degraded' : 'down');

/**
 * Students → firewall → L4 → links (studentDelivery: the students of every block the firewall lets in) ×
 * enroll pods vs. students (k8sHealth) × DB-01 connections: pods that can't get one fail their requests.
 */
function health(w: World): Health {
  // One memo scope: the student path and the L4 view share the network's derived views.
  return withNetMemo(w, () => measure(w));
}

function measure(w: World): Health {
  const net = studentDelivery(w);
  const app = k8sHealth(w);
  const pool = dbPool(w);
  const want = dbWanted(w);
  const max = dbMax(w);
  const dbOk = pool === null ? 0 : want > max ? max / want : 1;
  const notes = [...net.notes, ...app.notes];
  if (pool === null) notes.push('신청 요청이 DB 연결 오류로 실패해요 (DB 연결 설정을 읽지 못함)');
  else if (want > max) notes.push(`신청 요청 일부가 DB 연결 오류로 실패해요 (DB-01 연결 ${max}/${max})`);
  const lb = lbView(w);
  if (lb.over) notes.push(`L4 세션이 가득 찼어요 (${lb.sessions}/${w.net?.lb?.maxConn ?? lb.sessions}): 새 접속은 거부돼요`);
  const ok = net.ok * app.availability * dbOk;
  const services: Record<string, Status> = { 수강신청: status(ok), ...app.services, 'DB-01': dbOk >= 1 ? 'up' : dbOk > 0 ? 'degraded' : 'down' };
  for (const c of Object.values(w.campus ?? {})) {
    services[c.label] = !c.up ? 'down' : c.latencyMs >= 1000 ? 'degraded' : 'up';
    if (!c.up) notes.push(`${c.label} 응답 없음`);
    else if (c.latencyMs >= 1000) notes.push(`${c.label} 응답 느림 (${(c.latencyMs / 1000).toFixed(1)}초)`);
  }
  const slow = net.notes.some((n) => n.includes('느려요'));
  const latencyMs = ok === 0 ? 0 : app.latencyMs >= 1600 || dbOk < 1 ? 1600 : slow ? 900 : app.latencyMs;
  return emptyHealth(w, { availability: ok, errorRate: 1 - ok, latencyMs, services, notes });
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** Game time left until the 10:30 first close (the HUD clock's time, not real seconds). */
const CLOSE_GAME = parseHms('10:30:00');
const toClose = (t: number) => Math.max(0, CLOSE_GAME - gameSec(DDAY_CLOCK, t));

export const day5: DaySpec = {
  id: 5,
  label: 'D-Day',
  date: '02-10',
  clock: DDAY_CLOCK,
  // The SNMP poll runs every 10 s on D-Day (weekdays 15).
  pollEvery: 10,
  fixed: FIXED,
  extras: [0, 0],
  mapSwitch: 'TOR-01',
  mapDevices: ['web', 'web2', 'db', 'srv-new', 'srv-db', 'n1', 'n2', 'ns2'],
  title: '수강신청 당일',
  subtitle: '10:00 오픈 · 실시간 관제',
  topics: ['접속 대기열과 트래픽 피크', '장애 우선순위(triage)', 'MTTD · MTTR', '장애 보고서'],
  intro: [
    { who: 'boss', text: '드디어 D-Day. 10시 정각에 수강신청이 열린다. 오늘은 아무것도 새로 안 만들어. 지켜보고, 터지면 막는다.' },
    { who: 'mentor', text: '지금은 1초에 300건쯤 들어와. 10시 정각엔 1만 건 넘게, 10시 5분 신청이 몰릴 땐 1만 4천 건 넘게 들어올 거야. 신청 pod는 지금 4개고, 하나가 1초에 1000건쯤 처리해.' },
    { who: 'mentor', text: '경보가 한꺼번에 여러 개 뜰 수 있어. 보면 바로 확인(ACK)을 누르고, 학생이 신청을 아예 못 하는 Critical부터 막아.' },
    { who: 'boss', text: '10시 전에 점검 한 바퀴 돌고, 10시 30분 1차 마감까지 버텨. 끝나면 장애 보고서 쓰고 퇴근!' },
    { who: 'lion', text: '심장이 쿵쾅거려요… 그래도 5일 동안 만든 거니까, 지켜볼게요!', mood: 'worried' },
  ],
  outro: [
    { who: 'boss', text: '10시 30분, 1차 마감! 큰 사고 없이 넘겼다. 수고했어!' },
    { who: 'mentor', text: '케이블 꽂던 첫날부터 VLAN, L4, 컨테이너, 쿠버네티스, 이중화까지. 오늘 그걸 다 써서 버텼네. 이제 진짜 데이터센터 엔지니어야.' },
    { who: 'lion', text: '다음 학기 수강신청도 맡겨주세요!', mood: 'happy' },
  ],
  recap: {
    built: [
      'D-5: 1번 랙에 WEB-01·WEB-02(웹 서버: 학생 화면을 내주는 서버)와 DB-01(DB 서버: 신청 기록을 적는 창고 서버)을 설치하고, 전원 두 줄(A/B)과 케이블을 꽂았어요. 랙마다 맨 위 랙 스위치(TOR-01·TOR-02)가 그 랙 서버들을 데이터센터 중심의 코어 스위치(CORE-01·02)로 이어요.',
      'D-4: 스위치 하나를 VLAN(독립된 작은 네트워크)으로 나누고, 코어 스위치에 VLAN마다 게이트웨이(다른 VLAN으로 나가는 문, 주소 끝 .1)를 달았어요. 장비 설정은 관리 PC에서 ssh(원격 접속)로 들어가 enable(관리자 모드) → configure terminal(설정 모드) → … → end → write memory(저장) 순서로 바꿔요.',
      'D-3: 학생 요청은 방화벽(입구 경비) → L4(대표 주소 하나로 받아 서버들에 나눠 주는 장비) → 신청 앱 순서로 들어오고, 앱은 신청 기록을 DB-01에 적어요. 관제 화면(NOC)의 NMS(장비·선 지도와 경보)와 SMS(서비스 상태)로 지켜봐요.',
      'D-2: 랙 스위치 TOR-01에서 코어로 올라가는 굵은 길(업링크) 두 줄(10G씩)을 LACP로 묶어 20G 한 줄(Port-channel 1, 줄여서 Po1)로 쓰고 있어요.',
      'D-1: 신청 앱은 쿠버네티스(서버 여러 대를 한 팀으로 묶어 앱을 돌봐 주는 프로그램)가 노드(일하는 서버) 4대 위에 pod(앱 한 벌)로 돌려요. 게이트웨이는 코어 두 대가 짝(HSRP)으로 맡아서, CORE-01이 멈추면 대기하던 CORE-02(Standby)가 이어받아요.',
    ],
    concepts: ['nms', 'mttd', 'l4', 'lacp', 'oversubscription', 'pod', 'selfHealing', 'hsrp'],
  },
  primer: [
    { tool: 'NOC 경보 목록 · 확인(ACK)', role: '경보가 뜨면 열어서 "확인"을 눌러 내가 보고 있다고 남겨요. 목록 위에 있을수록 급해요. SMS 탭의 "지금 보이는 문제"에 무엇이 얼마나 망가졌는지 적혀요.' },
    { tool: 'ssh <장비>', role: '관리 PC 터미널에서 스위치·L4·방화벽에 접속해요. 스위치는 enable → configure terminal 로 설정 모드에 들어가 바꾸고, end → write memory 로 저장해요.' },
    { tool: 'pods · nodes · deploys', role: '관리 PC에서 쳐요. 신청 앱이 도는 pod(앱 한 벌)와 노드(일하는 서버), 원하는 상태(몇 벌, 어떤 버전)를 보여 줘요.' },
    { tool: 'scale <앱> <개수>', role: '원하는 pod 개수를 바꿔요. 쿠버네티스가 그 수만큼 pod를 띄워 줘요. pod 하나가 1초에 1000건쯤 처리해요.' },
    { tool: 'env <앱> · env set <앱> 이름=값', role: '앱이 읽는 설정값(환경변수)을 보고 바꿔요. 바꾸면 pod들이 새 설정으로 다시 떠요.' },
    { tool: 'LACP 묶기 (channel-group … mode active)', role: '같은 두 스위치 사이 케이블 여러 가닥을 한 줄(Port-channel)로 묶어 길을 넓혀요. 두 장비 양쪽 포트에 똑같이 하고, show etherchannel summary 로 확인해요.' },
    { tool: 'fw top · fw deny <대역>', role: '방화벽(FW-01: 바깥에서 들어오는 요청을 검사하는 입구 경비)에서 쳐요. 요청을 많이 보내는 출발지 순위를 보고, 수상한 출발지 주소 범위를 막아요.' },
    { tool: 'lb status', role: 'L4에서 쳐요. 지금 붙어 있는 접속(세션) 수와 최대 수, 서버들의 상태를 보여 줘요.' },
  ],
  objectives: [
    {
      id: 'noc',
      text: '점검 ① 관제 화면(NMS)을 열어 열린 경보가 없는지 확인하기',
      spot: 'monitor',
      done: (_w, c) => c.events.includes('noc:nms'),
      why: 'NMS(네트워크 관제)는 장비와 선의 상태를 지도로 보여 주고, 문제가 생기면 경보를 목록에 쌓아요. 10시 전에 경보 목록이 비어 있고 지도에 빨간 선이 없는지 봐 둬요.',
    },
    {
      id: 'hsrp',
      text: '점검 ② 코어 스위치에서 게이트웨이 이중화 상태 보기 (ssh CORE-01 → show standby brief)',
      spot: 'desk',
      done: (_w, c) => c.events.some((e) => /^ios:CORE-0[12]:(do )?show standby( brief)?$/.test(e)),
      after: ['noc'],
      why: '서버들이 밖으로 나가는 문(게이트웨이 .1)은 코어 스위치 두 대가 짝(HSRP)으로 맡고 있어요. show standby brief 에서 VLAN마다 Active 하나, Standby 하나가 보이면 코어 하나가 멈춰도 버틸 수 있어요.',
    },
    {
      id: 'l4',
      text: '점검 ③ L4(접속을 서버들에 나눠 주는 장비)에서 세션(지금 붙어 있는 접속) 수와 서버 상태 보기 (ssh L4-01 → lb status)',
      spot: 'desk',
      done: (_w, c) => (c.events.includes('ssh:L4-01') || c.events.includes('ssh:L4-02')) && c.commands.some((x) => /^lb(\s+status)?$/.test(x)),
      after: ['hsrp'],
      why: '학생 요청은 인터넷 → 방화벽(FW-01: 바깥에서 들어오는 요청을 출발지 주소별로 보고 통과시키거나 막는 입구 경비) → L4 → 신청 pod 순서로 들어와요. L4는 학생 접속을 대표 주소 하나로 받아 신청 pod들에 나눠 주는 장비예요. lb status 의 Sessions 는 "지금 붙어 있는 접속 수 / L4가 한 번에 붙잡을 수 있는 최대 수"예요.',
    },
    {
      id: 'hold',
      text: '10:30 1차 마감까지 수강신청 지키기',
      done: (w, c) => c.stageTime >= HOLD_AT && held(w, c),
      progress: (w, c) => (c.stageTime < HOLD_AT ? `10:30까지 ${mmss(toClose(c.stageTime))}` : held(w, c) ? '완료' : '남은 장애 해결하기'),
      concept: 'triage',
      why: '10시 정각부터 학생 요청이 평소의 수십 배로 몰려요. 경보가 뜨면 먼저 확인(ACK)해서 "보고 있다"를 남기고, 급한 것부터 막아요: Critical(신청이 아예 안 됨) → Major(느리거나 이중화가 깨짐) → Minor → Warning. 10:30이 지나도 남은 장애가 있으면 다 고칠 때까지 마감이 안 돼요.',
      lesson: '경보가 겹칠 때마다 "학생이 신청을 아예 못 하는 것"부터 막았어요. 피해가 큰 것부터 고르는 것, 그게 triage(우선순위 판단)예요.',
    },
    {
      id: 'postmortem',
      text: '관제실 설계 보드에서 장애 보고서 쓰기',
      spot: 'board',
      // Only a report filed after the 10:30 close counts (the board opens once `hold` is done).
      done: (_w, c) => (c.eventTimes['board:postmortem'] ?? -1) >= HOLD_AT,
      after: ['hold'],
      concept: 'postmortem',
      // Connection limits (the queue card) get a home on every run, also when no DB incident happened.
      alsoConcepts: ['queue'],
      why: '장애 보고서는 오늘 무슨 일이 언제, 왜 일어났고, 어떻게 고쳤고, 다음엔 어떻게 막을지 남기는 기록이에요. 누구를 탓하려는 게 아니라, 같은 장애를 두 번 겪지 않으려고 써요.',
      lesson: '무슨 일이, 언제, 왜 일어났고, 어떻게 고쳤고, 다음엔 어떻게 막을지 남겼어요. 사람 탓이 아니라 시스템을 고치는 기록이에요.',
    },
  ],
  interactions: {
    ...BASE_INTERACTIONS,
    rack1: { kind: 'consolePick', hosts: ['TOR-01', 'db'] },
    rack2: { kind: 'consolePick', hosts: ['n1', 'n2'] },
    rack3: { kind: 'consolePick', hosts: ['TOR-02', 'n3', 'n4'] },
    rack4: { kind: 'inspect', text: '4번 랙: DHCP 서버(dhcp01)와 DNS 서버(ns1). 오늘은 조용히 일하는 중이에요.' },
    switch: { kind: 'cable', mode: 'repair' },
    // The L4 is reached with ssh from the 관리 PC (the pre-check looks for that ssh); the firewall has a
    // console here too, at the spot named after it.
    router: { kind: 'consolePick', hosts: ['CORE-01', 'CORE-02', 'FW-01'] },
    patch: { kind: 'inspect', text: '패치 패널: 케이블이 모이는 곳. 랙 스위치와 코어 사이 선들도 여기를 지나가요. 케이블 검사·교체는 바로 위 TOR 배선판(E · 케이블 점검)에서 해요.' },
    pdu: { kind: 'gauge', target: 'pdu' },
    board: { kind: 'board', board: 'postmortem' },
  },
  health,
  panels: ['traffic', 'services', 'pods', 'links'],
  /** Before 10:00: the morning trickle, no bots. (The topology is the D-Day morning: nothing to take out.) */
  setup: (w) => {
    w.traffic.rps = studentRps(0);
    w.traffic.sources = [];
  },
  onTick: (w, t) => {
    w.traffic.rps = studentRps(t);
    macroPress(w);
  },
  scoreAvailabilityFrom: OPEN_AT,
  scoreAvailabilityUntil: 'hold',
};
