import { replaceCable, setFeeds, setUps } from '../../sim/actions';
import { cableAt, linkUp, powered } from '../../sim/network';
import type { Scenario } from '../../sim/scenario';
import type { World } from '../../sim/types';
import type { StageDef } from '../types';
import { emptyHealth, physicalWorld, SERVERS, serverStatus } from '../worlds';

/** Everything that needs electricity for the service to run: the three servers plus the switch and router. */
const GEAR = [...SERVERS, 'sw1', 'r1'];
const allLinked = (w: World) => SERVERS.every((id) => linkUp(w, id, 'eth0'));
const allPowered = (w: World) => GEAR.every((id) => powered(w, id));
/** How many devices hang on this one PDU line only. */
const singleFedOn = (w: World, f: 'A' | 'B') => GEAR.filter((id) => w.devices[id].feeds.join('') === f).length;

const scenarios: Scenario[] = [
  {
    id: 's1-cable',
    stage: 1,
    title: 'DB 서버 불이 안 켜짐',
    alert: 'DB 서버 불이 안 들어와요! 다른 서버는 초록불인데…',
    severity: 'critical',
    // The symptom (a dark LED) is on the rack; the player traces the cable from there to the switch.
    room: 'server',
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
  },
  {
    id: 's1-blackout',
    stage: 1,
    title: '정전',
    // True even for a player who prepared: the outage happens either way, the damage depends on them.
    alert: '앗, 정전! 건물 전체에 전기가 나갔어요!! 서버들 괜찮아요?',
    severity: 'critical',
    room: 'power',
    trigger: { type: 'after', scenario: 's1-cable', delay: 6 },
    inject: (w) => {
      w.power!.mains = false;
    },
    // Only the UPS can carry a blackout; every device must be on the line behind it (A).
    check: (w) => !!w.power?.ups && allPowered(w),
    onResolve: (w) => {
      w.power!.mains = true;
    },
    hints: [
      '전원실 그림에서 전기가 흐르는 길을 따라가 봐. 지금 어디서 끊겼고, 아직 불이 들어와 있는 건 뭐야?',
      '바깥 전기가 끊겨도 잠깐 버틸 수 있는 장치가 전원실에 있지 않았어? PDU A와 B 중에 그 장치 뒤에 있는 쪽은 어디야?',
      '전원실에서 배터리 장치를 PDU에 이어봐. 그리고 서버마다 그 배터리 뒤에 있는 줄을 받고 있는지도 확인해.',
    ],
    bannedPhrases: ['UPS를 연결', 'UPS를 켜', 'UPS를 이어', 'UPS를 꽂', 'UPS 스위치를 켜', 'UPS를 ON', 'A에 꽂', 'A줄에 꽂', 'A 줄에 꽂'],
    solution: '전원실에서 UPS를 PDU A에 연결한다 (UPS → PDU A 스위치 ON). 정전 때는 UPS 뒤에 있는 A줄만 전기가 오므로, 서버가 A줄을 받고 있어야 한다.',
    solutionSteps: [{
      label: 'UPS 연결 (+A줄 확인)',
      action: (w) => {
        setUps(w, true);
        for (const id of GEAR) {
          const feeds = w.devices[id].feeds;
          if (!feeds.includes('A')) setFeeds(w, id, [...feeds, 'A']);
        }
      },
    }],
    concept: 'spof',
    lesson: '바깥 전기 하나에만 기대면 그게 단일 장애점! UPS(비상 배터리)가 정전 동안 버텨줘요. 단, 배터리 뒤의 줄(A)을 받는 장비만요.',
  },
  {
    id: 's1-pdu',
    stage: 1,
    title: '정전도 아닌데 장비가 꺼짐',
    alert: '전원실에서 "딱!" 하고 뭔가 내려가는 소리가 났어요! 정전은 아니라는데… 장비들 괜찮아요?',
    severity: 'critical',
    room: 'power',
    trigger: { type: 'after', scenario: 's1-blackout', delay: 6 },
    inject: (w) => {
      // A PDU breaker trips: the line that the most single-fed devices depend on.
      w.power!.pduDown = singleFedOn(w, 'B') > singleFedOn(w, 'A') ? 'B' : 'A';
    },
    check: (w) => allPowered(w),
    onResolve: (w) => {
      // The electricians reset the breaker.
      delete w.power!.pduDown;
    },
    hints: [
      '어떤 장비가 꺼졌고 어떤 장비는 아직 살아 있어? 둘을 나란히 놓고 비교해볼래?',
      '꺼진 장비랑 멀쩡한 스위치·라우터는 전기를 받는 줄이 뭐가 다를까? 한 줄로만 받으면 그 줄이 끊기는 순간 끝이야.',
      '전원실 표에서 장비마다 "받는 줄"을 봐. 지금 살아 있는 줄로도 전기를 받게 해봐.',
    ],
    bannedPhrases: ['A와 B 둘 다', 'A/B 모두', 'A·B 모두', 'A, B 둘 다', '두 줄 다', '두 줄 모두', 'B에 꽂', 'B줄에 꽂', 'B 줄에 꽂', 'B도 꽂', 'B에도 꽂', 'A에도 꽂', 'A도 꽂'],
    solution: '한쪽 PDU 차단기가 내려가서 그 줄만 받던 장비가 꺼졌다. 전원실에서 장비마다 플러그 A·B를 모두 꽂아 이중 전원으로 받게 한다.',
    solutionSteps: [{ label: 'A·B 이중 전원', action: (w) => { for (const id of GEAR) setFeeds(w, id, ['A', 'B']); } }],
    concept: 'spof',
    lesson: '전원이 한 줄뿐이면 그 줄이 단일 장애점(SPOF)! A·B 두 줄로 받으면 PDU 하나가 고장 나도 버텨요.',
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
    { who: 'mentor', text: '물리 계층 끝! 케이블은 데이터가 다니는 도로, UPS는 정전 보험, A·B 이중 전원은 고장 보험이야.' },
    { who: 'boss', text: '이제 서버들이 서로 대화할 수 있게 만들 차례다.' },
  ],
  initialWorld: physicalWorld,
  objectives: [
    { id: 'mount', text: '서버실 랙에 서버 3대 장착 (랙 앞에서 E)', spot: 'rack1', done: (w) => SERVERS.every((id) => w.devices[id].installed) },
    { id: 'power', text: '전원실 PDU에서 서버 전원 연결', spot: 'pdu', done: (w) => SERVERS.every((id) => w.devices[id].feeds.length > 0), after: ['mount'] },
    // After power, as the board says (① 랙 ② 전원 ③ 케이블): cabling early is fine, it just counts once power is in.
    { id: 'cable', text: '네트워크실 스위치에 서버 케이블 연결', spot: 'switch', done: (w) => SERVERS.every((id) => !!cableAt(w, `${id}:eth0`)), after: ['power'] },
  ],
  scenarios,
  interactions: {
    rack1: { kind: 'rack' },
    rack2: { kind: 'rack' },
    rack3: { kind: 'inspect', text: '빈 랙. 이번엔 1·2번 랙만 써요.' },
    rack4: { kind: 'inspect', text: '빈 랙.' },
    switch: { kind: 'cable', mode: 'build' },
    patch: { kind: 'inspect', text: '패치 패널: 케이블이 모이는 곳. 서버 케이블은 바로 위의 스위치에 꽂아요.' },
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
    if (w.power && !w.power.mains) notes.push('정전 발생 (한전 전기 끊김)');
    else if (w.power?.pduDown && GEAR.some((id) => w.devices[id].installed && !powered(w, id))) notes.push('정전은 아닌데 꺼진 장비가 있음');
    return emptyHealth(w, { availability: up / 2, services, notes, errorRate: 1 - up / 2 });
  },
  panels: ['power', 'links'],
};
