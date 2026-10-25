// D-3: 서비스 오픈 (v1 stage 3 + 4). Start the enrollment app on WEB-01 and move it to port 80, put it
// behind the L4 (pool + health check), reach it through the public name, look at the service monitor,
// then split the monolith into services (DecomposeBoard).
// Teaching incident: the L4 health check asks the wrong path or port.
import { capacity } from '../../sim/app';
import { hostDelivery, lbView, listening, studentDelivery } from '../../sim/network';
import type { AppService, Health, PlayContext, World } from '../../sim/types';
import { studentsServed } from '../incidents/d3';
import type { DaySpec } from '../types';
import { emptyHealth } from '../worlds';
import { BASE_INTERACTIONS, WEEKDAY_CLOCK } from './common';
import { resave } from './day1';

/** Beta testers only: about 20 requests a second. */
const BETA_RPS = 20;
/** v1 stage 3: one worker serves ~25 rps, a worker per connection ~2000. */
const SINGLE_THREAD_RPS = 25;
const MULTI_THREAD_RPS = 2000;

type Status = 'up' | 'degraded' | 'down';
const status = (ok: number): Status => (ok >= 0.99 ? 'up' : ok > 0 ? 'degraded' : 'down');

/** v1 stage 4's app model: the monolith dies whole; split services fail alone. */
function appState(w: World): { ok: number; services: Record<string, Status>; notes: string[] } {
  const app = w.app;
  const services: Record<string, Status> = {};
  const notes: string[] = [];
  if (!app) return { ok: 1, services, notes };
  const rps = Math.max(1, w.traffic.rps);
  if (app.arch === 'monolith') {
    const m = app.services.monolith;
    services['앱(모놀리스)'] = m?.up ? 'up' : 'down';
    if (!m?.up) notes.push('수강신청 앱 전체가 응답하지 않음');
    return { ok: m?.up ? Math.min(1, capacity(m) / rps) : 0, services, notes };
  }
  const s = app.services;
  for (const v of Object.values(s)) services[v.label] = !v.up ? 'down' : capacity(v) < rps * v.share ? 'degraded' : 'up';
  const served = (x: AppService | undefined, share: number) => (x?.up ? Math.min(1, capacity(x) / (rps * share)) : 0);
  if (s.notify && !s.notify.up) notes.push('알림 서비스 응답 없음 (신청은 계속 됨)');
  return { ok: (s.login?.up ? 1 : 0) * served(s.enroll, 1) * served(s.course, 0.6), services, notes };
}

function health(w: World): Health {
  const path = studentDelivery(w);
  const app = appState(w);
  // The app on WEB-01 keeps its enrollment records on DB-01 (found by name, as D-4 set up).
  const db = hostDelivery(w, 'web', 'db');
  const web = w.web;
  const cap = web?.threads === 'multi' ? MULTI_THREAD_RPS : SINGLE_THREAD_RPS;
  const threads = Math.min(1, cap / Math.max(1, w.traffic.rps));
  const notes = [...path.notes, ...db.notes, ...app.notes];
  if (threads < 1) notes.push('요청이 줄 서서 기다리는 중 (응답 지연)');
  for (const c of Object.values(w.campus ?? {})) {
    if (!c.up) notes.push(`${c.label} 응답 없음`);
    else if (c.latencyMs >= 1000) notes.push(`${c.label} 응답 느림 (${(c.latencyMs / 1000).toFixed(1)}초)`);
  }
  const ok = path.ok * db.ok * app.ok * threads;
  const services: Record<string, Status> = { 수강신청: status(ok), 'web → db': status(db.ok), ...app.services };
  for (const c of Object.values(w.campus ?? {})) services[c.label] = !c.up ? 'down' : c.latencyMs >= 1000 ? 'degraded' : 'up';
  const latencyMs = ok === 0 ? 0 : threads < 1 ? Math.round(80 * (w.traffic.rps / SINGLE_THREAD_RPS)) : 60;
  return emptyHealth(w, { availability: ok, errorRate: 1 - ok, latencyMs, services, notes });
}

const healthyMembers = (w: World) => lbView(w).members.filter((m) => m.healthy);

/**
 * The player's latest curl asked for sugang and got a 200 back: the last curl line typed names sugang,
 * and no other curl result (503, refused, a 200 from somewhere else…) is newer than the latest 200 from
 * sugang. Event times are whole game seconds, so a result in the same second as that 200 doesn't count
 * against it (the 200 wins).
 */
function curledSugang(c: PlayContext): boolean {
  const last = [...c.commands].reverse().find((x) => /^curl\b/.test(x));
  if (!last || !/sugang/i.test(last)) return false;
  const results = Object.entries(c.eventTimes).filter(([e]) => e.startsWith('curl:'));
  const ok = results.filter(([e]) => /^curl:200:[^/]*sugang/.test(e)).map(([, t]) => t);
  if (!ok.length) return false;
  const at = Math.max(...ok);
  return results.every(([, t]) => t <= at);
}

/**
 * The D-Day topology already has what D-2 and D-1 build; on D-5 … D-3 it isn't there yet:
 * D-2's LACP bundle (Po1 = TOR-01 Te1/1/1-2 ↔ CORE-01 Te1/0/3-4: one plain uplink, the second cable not
 * laid yet), D-1's standby gateways for VLANs 10/20 on CORE-02 (CORE-01 alone is the gateway), and the
 * k8s cluster. Each step is a no-op when a later day's own unbuild already took it out.
 */
function laterDaysOut(w: World): void {
  const bundle: [string, string[]][] = [
    ['TOR-01', ['Te1/1/1', 'Te1/1/2']],
    ['CORE-01', ['Te1/0/3', 'Te1/0/4']],
  ];
  for (const [id, members] of bundle) {
    const n = w.devices[id]?.nd;
    if (!n) continue;
    for (const p of members) if (n.ifs[p]) delete n.ifs[p].group;
    delete n.ifs.Po1;
  }
  delete w.cables['tor1-up2'];
  const core2 = w.devices['CORE-02']?.nd;
  if (core2) for (const v of [10, 20]) delete core2.svis[v];
  delete w.k8s;
  for (const id of ['TOR-01', 'CORE-01', 'CORE-02']) resave(w.devices[id]);
}

export const day2: DaySpec = {
  id: 2,
  label: 'D-3',
  date: '02-07',
  clock: WEEKDAY_CLOCK,
  fixed: [
    { template: 'd3-l4health', trigger: { type: 'gate', objectives: ['curl'] } },
    // The 담당팀 이관 lesson every save meets once, on the lightest day (it is only an extra elsewhere).
    { template: 'd3-campus', trigger: { type: 'gate', objectives: ['msa'] } },
  ],
  extras: [0, 1],
  mapSwitch: 'TOR-01',
  mapDevices: ['web', 'web2', 'db'],
  title: '서비스 오픈',
  subtitle: '포트 · HTTP · L4 · MSA',
  topics: ['포트와 소켓', 'TCP · HTTP', 'L4 로드밸런서와 헬스체크', '관제(NMS·SMS)와 폴링', '모놀리스 → MSA'],
  intro: [
    { who: 'boss', text: 'D-3! 오늘 수강신청 웹 서비스를 연다. 우선 먼저 써보기로 한 학생들(베타 테스터)만 들어와. 1초에 20건 정도야.' },
    { who: 'mentor', text: 'WEB-01(이름은 web)에 접속해서 앱을 켜고, L4(입구 안내원)에 등록해. 학생들은 대표 이름 sugang 하나로 들어오고, L4가 뒤의 서버로 나눠 보내.' },
    { who: 'boss', text: '그리고 개발팀이 미리 돌려 봤더니, 알림 메일 기능 버그 하나로 앱 전체가 멈췄대. 기능별로 쪼개는 설계도 오늘 끝내자.' },
    { who: 'lion', text: '앱 켜고, 안내원 세우고, 쪼개기! 가보자!', mood: 'happy' },
  ],
  outro: [
    { who: 'mentor', text: '포트는 호실 번호, L4는 입구 안내원, 헬스체크는 "살아 있니?" 순찰. 그리고 기능별로 나누면 장애가 그 안에 갇혀.' },
    { who: 'boss', text: '그런데 서비스마다 서버를 손으로 깔다간 끝이 없겠어… 내일(D-2)은 더 빠른 방법을 써보자.' },
  ],
  objectives: [
    {
      id: 'start',
      text: 'web 서버에 원격 접속해 수강신청 앱 실행하기 (ssh web → server start)',
      spot: 'desk',
      done: (w) => !!w.web?.running,
      concept: 'socket',
      lesson: '앱을 켜면 정해진 포트에서 손님을 기다려요(LISTEN). 지금은 직원 한 명(single) 방식이라, 베타 테스터 정도는 괜찮지만 손님이 몰리면 줄이 길어져요.',
    },
    {
      id: 'port',
      text: '학생들이 찾아오는 문(80번 포트)에서 앱이 기다리게 하기 (curl로 확인)',
      spot: 'desk',
      done: (w) => !!w.web?.running && w.web.port === 80 && listening(w, 'web', 80),
      after: ['start'],
      concept: 'port',
      lesson: 'IP가 건물 주소라면 포트는 호실 번호예요. 웹은 보통 80번. 앱이 다른 호실(8080)에서 기다리면 손님은 "연결 거부"를 받아요.',
    },
    {
      id: 'l4',
      text: 'L4-01에 web 서버 등록하고, 헬스체크 경로를 /health 로 맞추기',
      spot: 'desk',
      done: (w) => healthyMembers(w).length > 0 && w.net?.lb?.health.path === '/health',
      after: ['port'],
      concept: 'l4',
      lesson: 'L4가 학생들을 대표 주소(VIP) 하나로 받아서 살아 있는 서버로 보내요. "살아 있니?"는 /health 같은 가벼운 전용 주소로 물어봐요(헬스체크).',
    },
    {
      id: 'curl',
      text: '관리 PC에서 학생처럼 http://sugang/enroll 요청해 200 OK 받기',
      spot: 'desk',
      done: (w, c) => studentsServed(w) && curledSugang(c),
      after: ['l4'],
      concept: 'tcp',
      lesson: 'curl -v로 보면 TCP는 먼저 SYN → SYN-ACK → ACK 세 번 인사(3-way handshake)를 나누고, 그다음 "GET /enroll"(이 페이지 주세요) 주문서가 가고 200 OK(여기 있어요)가 돌아와요.',
    },
    {
      id: 'sms',
      text: '관제 화면 SMS 탭에서 서비스 응답 상태 보기',
      spot: 'monitor',
      done: (_w, c) => c.events.includes('noc:sms'),
      after: ['curl'],
      concept: 'nms',
      lesson: '관제 화면은 장비와 서비스에 정해진 간격으로 상태를 물어봐서(폴링) 그려요. 그래서 숫자로 보는 문제는 다음 순찰 때에야 경보가 돼요. 장비가 스스로 알리는 trap·syslog는 바로 뜨고요.',
    },
    {
      id: 'msa',
      text: '관제실 설계 보드에서 수강신청 앱을 기능별 서비스로 나누기 (svc list로 확인)',
      spot: 'board',
      done: (w) => w.app?.arch === 'msa',
      after: ['sms'],
      concept: 'monolith',
      lesson: '한 덩어리(모놀리스)는 알림 버그 하나에도 전체가 멈춰요. 기능별 작은 서비스로 나누면(MSA) 푸드코트처럼 탈 난 매장만 문을 닫아요.',
    },
  ],
  interactions: {
    ...BASE_INTERACTIONS,
    rack1: { kind: 'consolePick', hosts: ['web', 'web2', 'db'] },
    rack2: { kind: 'inspect', text: '2번 랙: 선배들이 설치해 둔 서버들. 수강신청 앱은 1번 랙 WEB-01에서 돌아요.' },
    rack3: { kind: 'inspect', text: '3번 랙: TOR-02와 K8S 서버들.' },
    rack4: { kind: 'inspect', text: '4번 랙: DHCP·DNS 서버.' },
    switch: { kind: 'cable', mode: 'repair' },
    router: { kind: 'consolePick', hosts: ['TOR-01', 'CORE-01'] },
    patch: { kind: 'inspect', text: '패치 패널: 케이블이 모이는 곳. TOR-01에 꽂힌 케이블(서버·코어로 가는 업링크)은 옆의 TOR 배선판에서 검사하고 바꿔요.' },
    pdu: { kind: 'gauge', target: 'pdu' },
    board: { kind: 'board', board: 'decompose' },
  },
  health,
  panels: ['traffic', 'services', 'links'],
  /** What D-3 builds on the L4, taken back out: its pool members and the /health check. And what later days build. */
  unbuild: (w) => {
    laterDaysOut(w);
    const lb = w.net?.lb;
    if (!lb) return;
    lb.members = [];
    lb.health = { proto: 'http', port: 80, path: '/' };
  },
  /** The enrollment app on WEB-01 (stopped, on the wrong port), still one monolith, and the beta testers. */
  setup: (w) => {
    w.web = { host: 'web', running: false, port: 8080, threads: 'single', routes: ['/', '/enroll', '/courses', '/health'] };
    const monolith: AppService = {
      name: 'monolith', label: '수강신청 앱 (모놀리스)', up: true, replicas: 1, capacityRps: 8000, share: 1,
      calls: [], dbAccess: ['main-db'], installing: [], crashLoop: false, restartTimer: 5,
    };
    w.app = { arch: 'monolith', services: { monolith }, courseDbSchema: 1, notifyBug: true };
    w.traffic.rps = BETA_RPS;
    w.traffic.noticeShare = 0;
  },
};
