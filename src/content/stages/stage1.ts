import { replaceCable, setFeeds, setUps } from '../../sim/actions';
import { cableAt, linkUp, powered } from '../../sim/network';
import type { Scenario } from '../../sim/scenario';
import type { World } from '../../sim/types';
import type { StageDef } from '../types';
import { emptyHealth, physicalWorld, SERVERS, serverStatus } from '../worlds';

const allLinked = (w: World) => SERVERS.every((id) => linkUp(w, id, 'eth0'));
const dualFed = (w: World) => ['web', 'db', 'spare', 'sw1', 'r1'].every((id) => w.devices[id].feeds.includes('A') && w.devices[id].feeds.includes('B'));

const scenarios: Scenario[] = [
  {
    id: 's1-cable',
    stage: 1,
    title: '링크 다운',
    alert: 'DB 서버 불이 안 들어와요! 다른 서버는 초록불인데…',
    severity: 'critical',
    room: 'network',
    trigger: { type: 'objective', objective: 'cable', delay: 2 },
    inject: (w) => {
      const c = cableAt(w, 'db:eth0');
      if (c) c.broken = true;
    },
    check: (w) => allLinked(w),
    hints: [
      '불이 켜진 포트와 꺼진 포트, 뭐가 다를까? 양쪽 끝을 다 봐볼래?',
      '전기는 들어오는데 신호가 안 간다면… 데이터가 지나가는 "길" 자체를 의심해볼까?',
      '같은 자리에 다른 케이블을 꽂아보면 범인이 케이블인지 포트인지 좁힐 수 있어.',
    ],
    bannedPhrases: ['케이블을 교체', '케이블 교체', '케이블이 끊어', '단선'],
    solution: '네트워크실 스위치에서 DB 서버 케이블을 새 케이블로 교체한다 (케이블 내부 단선).',
    solutionSteps: [{ label: 'DB 케이블 교체', action: (w) => { const c = cableAt(w, 'db:eth0'); if (c) replaceCable(w, c.id); } }],
    concept: 'osi',
    lesson: '케이블 속이 끊어지면 전기는 들어와도 데이터는 못 지나가요. 문제 찾기는 L1(물리)부터!',
    courseRef: ['풀서네 Lec01–02'],
  },
  {
    id: 's1-blackout',
    stage: 1,
    title: '정전',
    alert: '앗, 정전! 서버가 전부 꺼졌어요!!',
    severity: 'critical',
    room: 'power',
    trigger: { type: 'after', scenario: 's1-cable', delay: 6 },
    inject: (w) => {
      w.power!.mains = false;
    },
    check: (w) => !!w.power?.ups && dualFed(w) && SERVERS.every((id) => powered(w, id)),
    onResolve: (w) => {
      w.power!.mains = true;
    },
    hints: [
      '전기가 끊겼을 때도 잠깐 버틸 수 있는 장치가 전원실에 있지 않았어?',
      '지금 서버들은 전기를 한 줄로만 받고 있어. 한 줄이 끊기면? 하나가 고장 나면 다 멈추는 곳을 찾아봐.',
      '전원실 PDU에서 배터리 장치를 연결하고, 서버마다 전원을 A·B 두 줄로 받게 해봐.',
    ],
    bannedPhrases: ['UPS를 연결', 'A와 B 둘 다', 'A/B 모두'],
    solution: '전원실에서 UPS를 PDU A에 연결하고, 모든 장비의 전원을 A·B 이중으로 연결한다.',
    solutionSteps: [{
      label: 'UPS 연결 + 이중 전원',
      action: (w) => {
        setUps(w, true);
        for (const id of ['web', 'db', 'spare', 'sw1', 'r1']) setFeeds(w, id, ['A', 'B']);
      },
    }],
    concept: 'spof',
    lesson: '전원이 한 줄뿐이면 그게 단일 장애점(SPOF)! UPS와 이중 전원으로 정전에도 버텨요.',
    courseRef: ['마서프 Lec03'],
  },
];

export const stage1: StageDef = {
  id: 1,
  title: '랙과 전원, 케이블',
  subtitle: 'L1 물리 계층 · 서버 설치하기',
  topics: ['랙 · 서버 장착', '전원(PDU · UPS)', '케이블 · link LED', 'OSI 7계층 · L1'],
  intro: [
    { who: 'boss', text: '서버 3대가 도착했어! 웹 서버, DB 서버, 예비 서버. 오늘 안에 설치 끝내자.' },
    { who: 'mentor', text: '순서는 랙에 끼우기 → 전원 꽂기 → 스위치에 케이블 연결. 물리적인 게 먼저야. 이게 OSI 7계층의 1층(L1).' },
    { who: 'lion', text: '7층짜리 우체국의 1층… 도로부터 깔기! 해볼게요!', mood: 'happy' },
  ],
  outro: [
    { who: 'mentor', text: '물리 계층 끝! 케이블은 데이터가 다니는 도로, 전원 이중화는 정전 보험이야.' },
    { who: 'boss', text: '이제 서버들이 서로 대화할 수 있게 만들 차례다.' },
  ],
  initialWorld: physicalWorld,
  objectives: [
    { id: 'mount', text: '서버실 랙에 서버 3대 장착 (랙 앞에서 E)', done: (w) => SERVERS.every((id) => w.devices[id].installed) },
    { id: 'power', text: '전원실 PDU에서 서버 전원 연결', done: (w) => SERVERS.every((id) => w.devices[id].feeds.length > 0), after: ['mount'] },
    { id: 'cable', text: '네트워크실 스위치에 서버 케이블 연결', done: (w) => SERVERS.every((id) => !!cableAt(w, `${id}:eth0`)), after: ['mount'] },
  ],
  scenarios,
  interactions: {
    rack1: { kind: 'rack' },
    rack2: { kind: 'rack' },
    rack3: { kind: 'inspect', text: '빈 랙. 이번엔 1·2번 랙만 써요.' },
    rack4: { kind: 'inspect', text: '빈 랙.' },
    switch: { kind: 'cable', mode: 'build' },
    patch: { kind: 'cable', mode: 'build' },
    router: { kind: 'inspect', text: '라우터는 이미 연결돼 있어요. 스위치 쪽을 보세요.' },
    pdu: { kind: 'power' },
    ups: { kind: 'power' },
    crac: { kind: 'inspect', text: '냉각은 정상이에요.' },
    monitor: { kind: 'dashboard' },
    mentor: { kind: 'mentor' },
    desk: { kind: 'inspect', text: '아직 서버에 IP가 없어서 원격 접속은 못 해요. 직접 가서 손으로!' },
    board: { kind: 'inspect', text: '설치 순서: ① 랙 장착 ② 전원 ③ 케이블' },
  },
  health: (w) => {
    const services = Object.fromEntries(SERVERS.map((id) => [id, serverStatus(w, id)]));
    const up = ['web', 'db'].filter((id) => services[id] === 'up').length;
    const notes = [];
    if (w.power && !w.power.mains) notes.push('정전 발생 (mains OFF)');
    return emptyHealth(w, { availability: up / 2, services, notes, errorRate: 1 - up / 2 });
  },
  panels: ['power', 'links'],
};
