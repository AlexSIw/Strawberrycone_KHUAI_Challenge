// D-5: 물리 구축 (v1 stage 0 + 1). Tour the rooms, mount three new servers in rack 1, feed them from
// PDU A and B, cable them to TOR-01, then look at the port LEDs (NMS) and the facilities (FMS).
// Teaching incident: a half-damaged server cable (CRC errors, found in the NMS port view).
import { cableAt, cablePeer, linkUp, powered } from '../../sim/network';
import type { PlayContext, World } from '../../sim/types';
import type { DaySpec } from '../types';
import { emptyHealth } from '../worlds';
import { BASE_INTERACTIONS, ROOMS, WEEKDAY_CLOCK } from './common';

/** The three servers this day installs (rack 1, cabled to TOR-01 Gi1/0/1–3 in the D-Day plan). */
export const D5_SERVERS = ['web', 'web2', 'db'];

const label = (w: World, id: string) => w.devices[id]?.label ?? id;
const names = (w: World, ids: string[]) => ids.map((id) => label(w, id)).join(', ');

const mounted = (w: World) => D5_SERVERS.filter((id) => w.devices[id]?.installed);
const dualFed = (w: World) => D5_SERVERS.filter((id) => w.devices[id]?.installed && ['A', 'B'].every((f) => w.devices[id].feeds.includes(f as 'A' | 'B')));
/** Every new server is mounted and plugged into power line `f`. */
const allFed = (w: World, f: 'A' | 'B') => D5_SERVERS.every((id) => w.devices[id]?.installed && w.devices[id].feeds.includes(f));
/** This server is cabled to some TOR-01 port with the link up. */
const cabledOne = (w: World, id: string) => cablePeer(w, id, 'eth0')?.[0] === 'TOR-01' && linkUp(w, id, 'eth0');
/** Cabled to some TOR-01 port (the plan says Gi1/0/1–3; any port works) with the link up. */
const cabled = (w: World) => D5_SERVERS.filter((id) => cabledOne(w, id));
const ev = (c: PlayContext, e: string) => c.events.includes(e);

function serverState(w: World, id: string): 'up' | 'degraded' | 'down' {
  if (!w.devices[id]?.installed || !powered(w, id) || !linkUp(w, id, 'eth0')) return 'down';
  return cableAt(w, `${id}:eth0`)?.degraded ? 'degraded' : 'up';
}

export const day0: DaySpec = {
  id: 0,
  label: 'D-5',
  date: '02-05',
  clock: WEEKDAY_CLOCK,
  fixed: [{ template: 'd5-crc', trigger: { type: 'gate', objectives: ['leds'] } }],
  extras: [0, 0],
  mapSwitch: 'TOR-01',
  mapDevices: [...D5_SERVERS],
  title: '물리 구축',
  subtitle: '랙 · 전원 A/B · 배선',
  topics: ['데이터센터 둘러보기', '랙과 U', '전원 A/B · PDU · UPS', '케이블과 포트 LED', '시설 감시(FMS)'],
  intro: [
    { who: 'boss', text: '어서 와! 오늘부터 KHU 데이터센터 신입 엔지니어야. 수강신청까지 딱 5일 남았다. D-5!' },
    {
      who: 'boss',
      text: '오늘은 새로 온 서버 3대(WEB-01·WEB-02·DB-01)를 1번 랙에 달고, 전원 A·B를 꽂고, 랙 위 스위치 TOR-01에 케이블까지 잇는 날이야.',
    },
    {
      who: 'boss',
      text: '서버는 24시간 켜 두고 학생 요청을 처리하는 컴퓨터야. WEB 서버는 학생한테 수강신청 화면을 보내 주고, DB 서버는 신청 기록을 쌓아 두는 창고지.',
    },
    { who: 'mentor', text: '나는 네 사수 쿠사수야. 막히면 힌트는 줄 수 있지만, 답은 못 줘. 아직 학생 접속이 없으니까 천천히, 손에 잡히는 것부터 하자.' },
    { who: 'lion', text: '(꿀꺽) 랙, 전원, 케이블… 순서대로 해볼게요!', mood: 'worried' },
    { who: 'system', text: 'WASD/방향키로 이동, 장비 앞에서 E. 관제실 모니터에서 관제 화면(NOC)을 열 수 있어요. 먼저 방 5개를 둘러보세요!' },
  ],
  outro: [
    { who: 'mentor', text: '이걸로 7층 중 맨 아래, 1층(물리)은 끝! 랙은 서버 책장, 전원 A·B 두 줄은 고장 대비 보험, 케이블은 데이터가 다니는 길이야. 포트 불빛은 그 길의 신호등이고.' },
    { who: 'boss', text: '좋아. 내일(D-4)은 이 서버들이 서로 통하게 만든다. VLAN으로 네트워크를 나누고, 그 사이를 잇는 길을 낼 거야.' },
  ],
  objectives: [
    {
      id: 'tour',
      text: '방 5개 둘러보기 (서버실·네트워크실·전기실·냉각실·관제실)',
      why: '데이터센터는 서버(24시간 일하는 컴퓨터)를 모아 두고 전기·냉방·네트워크를 대신 챙겨 주는 건물이에요. 서버실 말고도 전기를 대는 전기실, 열을 식히는 냉각실, 서버를 서로·바깥과 잇는 네트워크실, 모두를 지켜보는 관제실이 함께 돌아가야 서비스가 살아 있어요. 방마다 무엇이 있는지 둘러보세요.',
      done: (_w, c) => ROOMS.every((r) => c.visited.includes(r)),
      progress: (_w, c) => `${ROOMS.filter((r) => c.visited.includes(r)).length}/${ROOMS.length}`,
      concept: 'datacenter',
      lesson: '서버실은 서버가 일하는 곳, 전기실은 전기를, 냉각실은 시원한 바람을 대 주는 곳, 네트워크실은 서버를 서로·바깥과 잇는 곳, 관제실은 이 모두를 지켜보는 곳이에요. 다섯 방이 함께 돌아가야 서비스가 살아 있어요.',
    },
    {
      id: 'quiz',
      text: '관제실 설계 보드에서 퀴즈 풀기',
      why: '학생이 누르는 수강신청 버튼 뒤에는 이 건물의 서버가 있어요. 캠퍼스 건물에는 층마다 전기 통로(EPS실)와 통신선 통로(TPS실)가 있어서, 그 선들이 여기까지 이어져요. 요청이 어디로 가서 누가 답하는지 관제실 설계 보드의 퀴즈로 확인해 봐요.',
      spot: 'board',
      done: (_w, c) => c.events.includes('quiz:correct'),
      after: ['tour'],
      concept: 'epstps',
      lesson: '학생 노트북의 요청은 건물 층마다 있는 통신선 통로(TPS실)의 선을 타고 나와, 인터넷과 캠퍼스 네트워크를 지나 데이터센터의 서버로 와요. 서버가 처리해서 답을 돌려보내요.',
    },
    {
      id: 'mount',
      text: '서버실 1번 랙에 서버 3대 장착하기 (랙 앞에서 E)',
      why: '랙은 서버를 층층이 끼워 넣는 철제 책장이에요(한 칸 높이 = 1U). 서버를 랙에 모아야 전기와 케이블을 한곳에서 관리할 수 있어요. 1번 랙 맨 위에는 이 서버들을 네트워크에 이어 줄 스위치 TOR-01이 미리 달려 있어요.',
      spot: 'rack1',
      done: (w) => mounted(w).length === D5_SERVERS.length,
      progress: (w) => `${mounted(w).length}/${D5_SERVERS.length}`,
      after: ['quiz'],
      concept: 'rack',
      lesson: '서버는 랙(서버 책장)의 칸(U)에 끼워요. 랙 맨 위에는 그 랙 서버들을 묶어 주는 스위치(TOR-01)가 있어요.',
      steps: [
        { text: '서버실 1번 랙 앞에서 E: 랙 열기', done: (w, c) => ev(c, 'open:rack') || mounted(w).length > 0 },
        { text: 'WEB-01 장착', why: '웹 서버: 학생 브라우저에 수강신청 화면을 만들어 보내 주는 서버예요', done: (w) => !!w.devices.web?.installed },
        { text: 'WEB-02 장착', why: '예비 웹 서버: WEB-01과 같은 일을 할 수 있게 준비해 두는 두 번째 웹 서버예요', done: (w) => !!w.devices.web2?.installed },
        {
          text: 'DB-01 장착',
          why: 'DB(데이터베이스) 서버: 누가 어떤 과목을 신청했는지 기록을 보관하는 창고 서버예요',
          done: (w) => !!w.devices.db?.installed,
        },
      ],
    },
    {
      id: 'power',
      text: '전기실 PDU에서 서버 3대에 전원 A·B 두 줄 모두 꽂기',
      why: 'PDU는 장비마다 전기를 나눠 주는 데이터센터용 멀티탭이에요. 서버에는 전원 꽂는 곳이 두 개라, 서로 다른 길로 오는 A줄·B줄에 하나씩 꽂아요. 그래야 한 줄이 끊겨도 서버가 꺼지지 않아요.',
      spot: 'pdu',
      done: (w) => dualFed(w).length === D5_SERVERS.length,
      progress: (w) => `${dualFed(w).length}/${D5_SERVERS.length}`,
      after: ['mount'],
      concept: 'pdu',
      lesson: '서버마다 전원부가 두 개라 A줄·B줄에 하나씩 꽂았어요. 이제 한 줄(PDU 하나)이 끊겨도 서버는 꺼지지 않아요.',
      steps: [
        { text: '전기실 PDU 앞에서 E: 전원판 열기', done: (w, c) => ev(c, 'open:power') || D5_SERVERS.some((id) => (w.devices[id]?.feeds.length ?? 0) > 0) },
        { text: '서버 3대 모두 A줄 꽂기', why: 'A줄은 UPS(정전 때 잠시 버텨 주는 큰 배터리)를 거쳐 오는 전기예요', done: (w) => allFed(w, 'A') },
        { text: '서버 3대 모두 B줄 꽂기', why: 'B줄은 따로 들어오는 두 번째 전기예요. A줄 쪽이 고장 나도 B줄로 계속 켜져 있어요', done: (w) => allFed(w, 'B') },
      ],
    },
    {
      id: 'cable',
      text: '네트워크실 TOR 배선판에서 서버 3대의 케이블을 TOR-01 포트에 꽂기 (배선표: WEB-01 → 1번, WEB-02 → 2번, DB-01 → 3번 포트)',
      why: '스위치는 여러 컴퓨터를 케이블로 이어 서로 데이터를 주고받게 해 주는 장비이고, 포트는 그 케이블을 꽂는 구멍이에요. 서버 케이블이 1번 랙 위 스위치 TOR-01의 포트에 꽂혀야 서버가 네트워크에 연결돼요.',
      spot: 'switch',
      done: (w) => cabled(w).length === D5_SERVERS.length,
      progress: (w) => `${cabled(w).length}/${D5_SERVERS.length}`,
      after: ['power'],
      steps: [
        {
          text: '네트워크실 TOR 배선판 앞에서 E: 케이블 창 열기',
          why: '배선판은 케이블을 정리해 TOR-01 포트로 이어 주는 작업대예요. TOR-01은 서버실 1번 랙 위에 있지만 케이블 작업은 여기서 해요',
          done: (w, c) => ev(c, 'open:cable') || cabled(w).length > 0,
        },
        {
          text: 'WEB-01 → TOR-01 1번 포트 (Gi1/0/1)',
          why: '배선표(어느 서버를 몇 번 포트에 꽂을지 정한 표)대로 꽂아야 나중에 찾기 쉬워요. Gi1/0/1이 1번 포트의 정식 이름이에요',
          done: (w) => cabledOne(w, 'web'),
        },
        { text: 'WEB-02 → 2번 포트 (Gi1/0/2)', done: (w) => cabledOne(w, 'web2') },
        { text: 'DB-01 → 3번 포트 (Gi1/0/3)', why: '양쪽 포트 불빛(LED)이 켜지면 링크가 올라온 거예요: 케이블로 이어져 신호가 오가는 상태', done: (w) => cabledOne(w, 'db') },
      ],
    },
    {
      id: 'leds',
      text: '관제 화면(NMS)에서 TOR-01을 열어 포트 불빛 확인하기',
      why: '케이블이 제대로 이어졌는지는 포트 옆 불빛(LED)으로 알 수 있어요. 관제 화면의 NMS 탭(네트워크 관리 시스템)은 장비마다 포트 불빛과 오류 숫자를 멀리서도 모아 보여 줘요. 배선판까지 가지 않아도 여기서 먼저 확인해요.',
      spot: 'monitor',
      done: (_w, c) => c.events.includes('noc:device:TOR-01'),
      after: ['cable'],
      concept: 'portled',
      lesson: '초록 불 = 케이블 양쪽이 연결돼 신호가 오가는 상태. 꺼져 있으면 연결이 없거나 끊긴 거예요. 관제 화면에서는 포트마다 오류 숫자도 볼 수 있어요.',
      steps: [
        { text: '관제실 모니터 앞에서 E: 관제 화면(NOC) 열기', done: (_w, c) => ev(c, 'open:noc') || ev(c, 'noc:nms') || ev(c, 'noc:device:TOR-01') },
        { text: 'NMS 탭: 네트워크 구성도 보기', why: '장비들이 어떻게 이어져 있는지 선으로 그린 그림이에요', done: (_w, c) => ev(c, 'noc:nms') || ev(c, 'noc:device:TOR-01') },
        {
          text: '구성도에서 TOR-01 누르기',
          why: '포트 표의 Gi1/0/1~3은 오늘 꽂은 서버, Te1/1/1~4는 코어 스위치로 올라가는 굵은 길(업링크)이에요. 계속 주황인 업링크는 일부러 쉬게 둔 예비 길이라 괜찮아요',
          done: (_w, c) => ev(c, 'noc:device:TOR-01'),
        },
      ],
    },
    {
      id: 'fms',
      text: '관제 화면 FMS 탭에서 전기·냉방 상태 둘러보기',
      why: 'FMS 탭은 전기·냉방 같은 시설을 지켜보는 화면이에요. 서버는 전기가 끊기거나 너무 뜨거워지면 멈추기 때문에, 정전에 버티는 UPS(큰 배터리)·발전기와 서버실 전용 에어컨(항온항습기)이 정상인지 늘 봐야 해요. 고치는 건 시설팀 몫이고, 우리는 지켜보다 이상하면 알려요.',
      spot: 'monitor',
      done: (_w, c) => c.events.includes('noc:fms'),
      after: ['leds'],
      concept: 'ups',
      lesson: '정전되면 UPS(비상 배터리)가 버티는 사이 발전기가 돌고, ATS가 전기 길을 자동으로 바꿔요. 시설은 시설팀 담당이라 우리는 FMS로 지켜보고 이상하면 알려요.',
    },
  ],
  interactions: {
    ...BASE_INTERACTIONS,
    rack1: { kind: 'rack' },
    rack2: { kind: 'inspect', text: '2번 랙: 선배들이 먼저 설치해 둔 서버들(APP-01·DB-02·K8S 서버·NS2 예비 DNS 서버). 오늘 작업은 1번 랙이에요.' },
    rack3: { kind: 'inspect', text: '3번 랙: 두 번째 랙 스위치(TOR-02)와 K8S 서버들. 이미 설치돼 있어요.' },
    rack4: { kind: 'inspect', text: '4번 랙: 주소를 나눠주는 DHCP 서버와 이름을 알려주는 DNS 서버. 이미 설치돼 있어요.' },
    switch: { kind: 'cable', mode: 'build' },
    patch: { kind: 'cable', mode: 'repair' },
    router: {
      kind: 'inspect',
      text: '코어 스위치(CORE-01·02): 데이터센터 네트워크의 중심. 방화벽: 허락하지 않은 접속을 막는 장비. 보더 라우터(경계 라우터): 인터넷으로 나가는 문. 모두 선배들이 이미 연결해 뒀어요.',
    },
    pdu: { kind: 'power' },
    desk: { kind: 'inspect', text: '관리 PC. 내일(D-4)부터 여기서 터미널(글자로 명령을 내리는 창)로 장비에 접속해요.' },
    board: { kind: 'quiz' },
  },
  health: (w) => {
    const services = Object.fromEntries(D5_SERVERS.map((id) => [label(w, id), serverState(w, id)]));
    const states = D5_SERVERS.map((id) => serverState(w, id));
    const ok = states.reduce((a, s) => a + (s === 'up' ? 1 : s === 'degraded' ? 0.8 : 0), 0) / states.length;
    const notes: string[] = [];
    const inRack = mounted(w);
    const dark = inRack.filter((id) => !powered(w, id));
    if (dark.length) notes.push(`전원이 안 들어온 서버: ${names(w, dark)}`);
    const single = inRack.filter((id) => w.devices[id].feeds.length === 1);
    if (single.length) notes.push(`전원을 한 줄로만 받는 서버: ${names(w, single)}`);
    const unlinked = inRack.filter((id) => powered(w, id) && !linkUp(w, id, 'eth0'));
    if (unlinked.length) notes.push(`링크(케이블 연결)가 없는 서버: ${names(w, unlinked)}`);
    if (D5_SERVERS.some((id) => cableAt(w, `${id}:eth0`)?.degraded)) notes.push('TOR-01 포트 하나에서 깨진 데이터(CRC 오류)가 늘고 있음');
    return emptyHealth(w, { availability: ok, errorRate: 1 - ok, services, notes });
  },
  panels: ['power', 'links'],
  quiz: {
    pool: [
      {
        question: '학생이 수강신청 버튼을 누르면, 그 요청은 어디로 갈까요?',
        choices: ['학생 노트북 안에서 처리된다', '인터넷을 거쳐 데이터센터의 서버로 간다', '근처 와이파이 공유기 안에서 처리된다'],
        answer: 1,
        explain: '학생 노트북(클라이언트)이 요청을 보내면 데이터센터의 서버가 처리해서 답을 돌려줘. 이게 클라이언트-서버 구조야.',
        concept: 'datacenter',
      },
    ],
    draw: 1,
  },
  /** Three new servers come off the truck: not mounted, no power, no cable. */
  unbuild: (w) => {
    for (const id of D5_SERVERS) {
      const d = w.devices[id];
      if (!d) continue;
      d.installed = false;
      d.feeds = [];
      const c = cableAt(w, `${id}:eth0`);
      if (c) delete w.cables[c.id];
    }
  },
  /** Nobody uses the service yet. */
  setup: (w) => {
    w.traffic.rps = 0;
  },
};
