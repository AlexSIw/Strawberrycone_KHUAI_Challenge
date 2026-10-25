// D-5: 물리 구축 (v1 stage 0 + 1). Tour the rooms, mount three new servers in rack 1, feed them from
// PDU A and B, cable them to TOR-01, then look at the port LEDs (NMS) and the facilities (FMS).
// Teaching incident: a half-damaged server cable (CRC errors, found in the NMS port view).
import { cableAt, cablePeer, linkUp, powered } from '../../sim/network';
import type { World } from '../../sim/types';
import type { DaySpec } from '../types';
import { emptyHealth } from '../worlds';
import { BASE_INTERACTIONS, ROOMS, WEEKDAY_CLOCK } from './common';

/** The three servers this day installs (rack 1, cabled to TOR-01 Gi1/0/1–3 in the D-Day plan). */
export const D5_SERVERS = ['web', 'web2', 'db'];

const label = (w: World, id: string) => w.devices[id]?.label ?? id;
const names = (w: World, ids: string[]) => ids.map((id) => label(w, id)).join(', ');

const mounted = (w: World) => D5_SERVERS.filter((id) => w.devices[id]?.installed);
const dualFed = (w: World) => D5_SERVERS.filter((id) => w.devices[id]?.installed && ['A', 'B'].every((f) => w.devices[id].feeds.includes(f as 'A' | 'B')));
/** Cabled to some TOR-01 port (the plan says Gi1/0/1–3; any port works) with the link up. */
const cabled = (w: World) => D5_SERVERS.filter((id) => cablePeer(w, id, 'eth0')?.[0] === 'TOR-01' && linkUp(w, id, 'eth0'));

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
    { who: 'boss', text: '오늘은 새로 온 서버 3대(WEB-01·WEB-02·DB-01)를 1번 랙에 달고, 전원 A·B를 꽂고, 랙 위 스위치(TOR-01)에 케이블까지 연결하는 날이야.' },
    { who: 'mentor', text: '나는 사수 쿠사수. 답은 안 알려주지만 막히면 힌트는 줄게. 아직 학생 접속은 하나도 없으니까 천천히, 손에 잡히는 것부터 하자.' },
    { who: 'lion', text: '(꿀꺽) 랙, 전원, 케이블… 순서대로 해볼게요!', mood: 'worried' },
    { who: 'system', text: 'WASD/방향키로 이동, 장비 앞에서 E. 관제실 모니터에서 관제 화면(NOC)을 열 수 있어요. 먼저 방 5개를 둘러보세요!' },
  ],
  outro: [
    { who: 'mentor', text: '1층(물리) 끝! 랙은 서버 책장, A·B 두 줄 전원은 고장 보험, 케이블과 포트 불빛은 데이터가 다니는 도로야.' },
    { who: 'boss', text: '좋아. 내일(D-4)은 이 서버들이 서로 대화하게 만든다. 주소와 VLAN!' },
  ],
  objectives: [
    {
      id: 'tour',
      text: '방 5개 둘러보기 (서버실·네트워크실·전기실·냉각실·관제실)',
      done: (_w, c) => ROOMS.every((r) => c.visited.includes(r)),
      progress: (_w, c) => `${ROOMS.filter((r) => c.visited.includes(r)).length}/${ROOMS.length}`,
      concept: 'epstps',
      lesson: '전기실·냉각실·네트워크실이 서버를 받쳐 줘요. 캠퍼스 건물에도 층마다 전기 통로(EPS실)와 통신선 통로(TPS실)가 있어서, 거기서 나온 선이 여기까지 이어져요.',
    },
    {
      id: 'quiz',
      text: '관제실 설계 보드에서 퀴즈 풀기',
      spot: 'board',
      done: (_w, c) => c.events.includes('quiz:correct'),
      after: ['tour'],
      concept: 'datacenter',
      lesson: '학생의 요청은 인터넷을 지나 데이터센터의 서버로 와요. 서버·네트워크·전기·냉각·관제가 함께 돌아가야 서비스가 살아 있어요.',
    },
    {
      id: 'mount',
      text: '서버실 1번 랙에 서버 3대 장착하기 (랙 앞에서 E)',
      spot: 'rack1',
      done: (w) => mounted(w).length === D5_SERVERS.length,
      progress: (w) => `${mounted(w).length}/${D5_SERVERS.length}`,
      after: ['quiz'],
      concept: 'rack',
      lesson: '서버는 랙(서버 책장)의 칸(U)에 끼워요. 랙 맨 위에는 그 랙 서버들을 묶어 주는 스위치(TOR-01)가 있어요.',
    },
    {
      id: 'power',
      text: '전기실 PDU에서 서버 3대에 전원 A·B 두 줄 모두 꽂기',
      spot: 'pdu',
      done: (w) => dualFed(w).length === D5_SERVERS.length,
      progress: (w) => `${dualFed(w).length}/${D5_SERVERS.length}`,
      after: ['mount'],
      concept: 'pdu',
      lesson: '서버마다 전원부가 두 개라 A줄·B줄에 하나씩 꽂았어요. 이제 한 줄(PDU 하나)이 끊겨도 서버는 꺼지지 않아요.',
    },
    {
      id: 'cable',
      text: '네트워크실 TOR 배선판에서 서버 케이블을 TOR-01 포트에 연결하기 (배선표: 1·2·3번 포트)',
      spot: 'switch',
      done: (w) => cabled(w).length === D5_SERVERS.length,
      progress: (w) => `${cabled(w).length}/${D5_SERVERS.length}`,
      after: ['power'],
    },
    {
      id: 'leds',
      text: '관제 화면(NMS)에서 TOR-01을 열어 포트 불빛 확인하기',
      spot: 'monitor',
      done: (_w, c) => c.events.includes('noc:device:TOR-01'),
      after: ['cable'],
      concept: 'portled',
      lesson: '초록 불 = 케이블 양쪽이 연결돼 신호가 오가는 상태. 꺼져 있으면 연결이 없거나 끊긴 거예요. 관제 화면에서는 포트마다 오류 숫자도 볼 수 있어요.',
    },
    {
      id: 'fms',
      text: '관제 화면 FMS 탭에서 전기·냉방 상태 둘러보기',
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
    rack2: { kind: 'inspect', text: '2번 랙: 선배들이 먼저 설치해 둔 서버들(APP-01·DB-02·K8S·NS2). 오늘 작업은 1번 랙이에요.' },
    rack3: { kind: 'inspect', text: '3번 랙: 두 번째 랙 스위치(TOR-02)와 K8S 서버들. 이미 설치돼 있어요.' },
    rack4: { kind: 'inspect', text: '4번 랙: 주소를 나눠주는 DHCP 서버와 이름을 알려주는 DNS 서버. 이미 설치돼 있어요.' },
    switch: { kind: 'cable', mode: 'build' },
    patch: { kind: 'cable', mode: 'repair' },
    router: { kind: 'inspect', text: '코어 스위치(CORE-01·02)·방화벽·경계 라우터: 데이터센터 네트워크의 중심과 바깥으로 나가는 문. 선배들이 이미 연결해 뒀어요.' },
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
    question: '학생이 수강신청 버튼을 누르면, 그 요청은 어디로 갈까?',
    choices: ['학생 노트북 안에서 처리된다', '인터넷을 거쳐 데이터센터의 서버로 간다', '근처 와이파이 공유기 안에서 처리된다'],
    answer: 1,
    explain: '요청하는 쪽(클라이언트, 여기선 학생 노트북)이 요청을 보내면 데이터센터의 서버가 처리해서 응답(답장)을 돌려줘요. 이게 클라이언트-서버(client-server) 구조!',
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
