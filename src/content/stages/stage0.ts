import type { StageDef } from '../types';
import { emptyHealth, networkedWorld } from '../worlds';

const ROOMS = ['server', 'network', 'power', 'cooling', 'noc'];

export const stage0: StageDef = {
  id: 0,
  title: '입사 첫날',
  subtitle: '튜토리얼 · 데이터센터 둘러보기',
  topics: ['데이터센터란?', '서버와 클라이언트', '조작법'],
  intro: [
    { who: 'boss', text: '어서 와! 오늘부터 KHU 데이터센터 신입 엔지니어야.' },
    { who: 'boss', text: '한 달 뒤가 수강신청이야. 그날 서버가 죽으면… 우리 다 끝이다.' },
    { who: 'lion', text: '(꿀꺽) 열심히 하겠습니다!', mood: 'worried' },
    { who: 'mentor', text: '나는 사수 쿠사수. 답은 안 알려주지만, 막히면 힌트는 줄게. 관제실에서 나한테 말 걸어.' },
    { who: 'system', text: 'WASD/방향키로 이동, 장비 앞에서 E로 상호작용. 먼저 방 5개를 둘러보자!' },
  ],
  outro: [
    { who: 'mentor', text: '데이터센터는 서버들이 사는 아파트야. 전기, 냉방, 인터넷을 대신 챙겨주지.' },
    { who: 'lion', text: '이제 감 잡았어요! 바로 서버 설치하러 가요!', mood: 'happy' },
  ],
  initialWorld: () => {
    const w = networkedWorld();
    w.web!.running = true;
    w.web!.port = 80;
    w.web!.threads = 'multi';
    w.notice = { url: '/enroll' };
    w.traffic.rps = 100;
    w.cooling = { cracOk: true, temps: { rack1: 24, rack2: 24, rack3: 24, rack4: 24 }, cracRacks: ['rack1', 'rack2'] };
    return w;
  },
  objectives: [
    { id: 'visit', text: '방 5개 둘러보기 (서버실·네트워크실·전원실·냉각실·관제실)', done: (_w, c) => ROOMS.every((r) => c.visited.includes(r)) },
    { id: 'dashboard', text: '관제실 모니터(대시보드) 켜보기', done: (_w, c) => c.events.includes('open:dashboard') },
    { id: 'mentor', text: '쿠사수에게 말 걸기', done: (_w, c) => c.events.includes('open:mentor') },
    {
      id: 'quiz',
      text: '퀴즈 풀기: 관제실 화이트보드',
      done: (_w, c) => c.events.includes('quiz:correct'),
      after: ['visit'],
      concept: 'datacenter',
      lesson: '학생의 요청은 인터넷을 지나 데이터센터의 서버로 가요. 서버·네트워크·전원·냉각·관제가 함께 돌아가야 서비스가 살아 있어요.',
    },
  ],
  scenarios: [],
  interactions: {
    rack1: { kind: 'inspect', text: '서버 랙. 서버들이 층층이 꽂혀 있어요. 이게 "컴퓨터 아파트"의 한 동!' },
    rack2: { kind: 'inspect', text: '서버마다 초록 LED가 깜빡여요. 네트워크 케이블이 잘 연결됐다는 뜻이에요.' },
    rack3: { kind: 'inspect', text: '빈 랙이에요. 서비스가 커지면 여기에 서버를 더 넣어요.' },
    rack4: { kind: 'inspect', text: '빈 랙이에요.' },
    switch: { kind: 'inspect', text: '스위치: 같은 건물(네트워크) 안에서 데이터를 배달해요.' },
    router: { kind: 'inspect', text: '라우터: 건물 밖(인터넷)으로 나가는 길을 골라주는 우편 분류소.' },
    patch: { kind: 'inspect', text: '패치 패널: 케이블들이 모이는 곳.' },
    pdu: { kind: 'inspect', text: 'PDU: 서버들에 전기를 나눠주는 멀티탭. A/B 두 줄이 있어요.' },
    ups: { kind: 'inspect', text: 'UPS: 정전되면 배터리로 잠깐 버텨주는 장치.' },
    crac: { kind: 'inspect', text: '항온항습기(CRAC): 서버실을 시원하게. 서버는 더위에 약해요!' },
    monitor: { kind: 'dashboard' },
    mentor: { kind: 'mentor' },
    desk: { kind: 'inspect', text: '관리 PC. Stage 2부터 여기서 터미널을 쓸 수 있어요.' },
    board: { kind: 'quiz' },
  },
  health: (w) => emptyHealth(w, { services: { web: 'up', db: 'up' } }),
  panels: ['power', 'traffic'],
  quiz: {
    question: '학생이 수강신청 버튼을 누르면, 그 요청은 어디로 갈까?',
    choices: ['학생 노트북 안에서 처리된다', '인터넷을 거쳐 데이터센터의 서버로 간다', '교수님 컴퓨터로 간다'],
    answer: 1,
    explain: '학생(클라이언트)이 요청을 보내면 데이터센터의 서버가 처리해서 응답해요. 이게 client-server 구조!',
  },
};
