import type { Scenario } from '../../sim/scenario';
import type { World } from '../../sim/types';
import type { StageDef } from '../types';
import { emptyHealth, networkedWorld, networkPath, SERVERS, serverStatus } from '../worlds';

const SINGLE_THREAD_RPS = 25;
const MULTI_THREAD_RPS = 2000;

function webHealth(w: World) {
  const path = networkPath(w);
  const s = w.web!;
  const notes = [...path.notes];
  if (!s.running) return { ok: 0, latency: 0, notes: [...notes, '웹 서버가 꺼져 있음'] };
  if (s.port !== 80) return { ok: 0, latency: 0, notes: [...notes, `학생은 80번으로 오는데 서버는 ${s.port}번에서 대기 중`] };
  const cap = s.threads === 'single' ? SINGLE_THREAD_RPS : MULTI_THREAD_RPS;
  const served = Math.min(1, cap / Math.max(1, w.traffic.rps));
  if (served < 1) notes.push('요청이 줄 서서 기다리는 중 (타임아웃)');
  const notFound = w.notice && !s.routes.includes(w.notice.url) ? w.traffic.noticeShare : 0;
  if (notFound) notes.push(`공지 링크(${w.notice!.url})로 온 학생은 404`);
  const latency = s.threads === 'single' ? Math.round(80 * (w.traffic.rps / SINGLE_THREAD_RPS)) : 35;
  return { ok: path.ok * served * (1 - notFound), latency, notes };
}

const scenarios: Scenario[] = [
  {
    id: 's3-port',
    stage: 3,
    title: '포트 불일치',
    alert: '서버 켰다면서요? 학생들 화면엔 "연결이 거부되었습니다"가 떠요!',
    severity: 'critical',
    room: 'server',
    trigger: { type: 'objective', objective: 'start', delay: 2 },
    inject: () => {},
    check: (w) => !!w.web?.running && w.web.port === 80,
    hints: [
      '서버는 분명 켜져 있어. 그런데 학생들은 어느 "호실 번호"로 찾아오고 있을까?',
      '웹은 보통 80번 문으로 들어와. 서버는 지금 몇 번 문 앞에서 기다리고 있는지 확인해봐.',
      'web 서버에서 열려 있는 포트를 보는 명령어와, 서버 설정을 바꾸는 명령어가 help에 있어.',
    ],
    bannedPhrases: ['server set port 80', '8080'],
    solution: '서버가 8080번 포트에서 듣고 있다. ssh web → server set port 80',
    solutionSteps: [{ cmd: 'server set port 80', host: 'web' }],
    concept: 'port',
    lesson: 'IP가 건물 주소라면 포트는 호실 번호. 학생(80)과 서버(8080)가 다른 문 앞에 있었어요.',
    courseRef: ['풀서네 Lec03', '마서프 Lec01'],
  },
  {
    id: 's3-thread',
    stage: 3,
    title: '한 명씩만 처리',
    alert: '베타 테스터가 300명으로 늘었어요. 페이지가 한참 걸리다 타임아웃이에요…',
    severity: 'critical',
    room: 'noc',
    trigger: { type: 'after', scenario: 's3-port', delay: 8 },
    inject: (w) => {
      w.traffic.rps = 300;
    },
    check: (w) => w.web?.threads === 'multi',
    hints: [
      '대시보드 응답시간을 봐. 서버가 죽은 건 아닌데 엄청 느려. 식당이라면 어떤 상황일까?',
      '손님 300명인데 카운터 직원이 몇 명인지 서버 설정에서 볼 수 있어.',
      '요청마다 도와줄 사람(스레드)을 따로 붙이는 설정이 있어.',
    ],
    bannedPhrases: ['server set threads multi', 'threads multi'],
    solution: '서버가 동기(single thread) 방식이라 한 번에 한 명만 처리한다. ssh web → server set threads multi',
    solutionSteps: [{ cmd: 'server set threads multi', host: 'web' }],
    concept: 'socket',
    lesson: '직원 한 명(동기 서버)은 손님이 몰리면 줄이 끝없이 길어져요. 연결마다 스레드를 붙이면 해결!',
    courseRef: ['풀서네 Lec04'],
  },
  {
    id: 's3-404',
    stage: 3,
    title: '404 Not Found',
    alert: '학생 커뮤니티: "공지 링크 누르면 Not Found 떠요ㅠ" (직접 주소 친 학생은 괜찮대요)',
    severity: 'warning',
    room: 'noc',
    trigger: { type: 'after', scenario: 's3-thread', delay: 6 },
    inject: () => {},
    check: (w) => !!w.notice && !!w.web?.routes.includes(w.notice.url),
    hints: [
      '서버는 잘 응답하고 있어. "공지 링크"로 온 학생만 문제라면 그 링크엔 뭐가 적혀 있을까?',
      '404는 "그런 메뉴는 없어요"라는 뜻이야. 서버가 가진 경로 목록과 공지의 경로를 비교해봐.',
      '공지를 보는 명령어와, 로봇 손님(curl)으로 경로를 직접 시험해보는 방법이 있어.',
    ],
    bannedPhrases: ['notice set /enroll', '/enrol '],
    solution: '공지에 오타 경로(/enrol)가 적혀 있다. notice set /enroll',
    solutionSteps: [{ cmd: 'notice set /enroll', host: 'ops' }],
    concept: 'http',
    lesson: '200은 "여기 있어요", 404는 "그런 메뉴 없어요". 상태 코드만 봐도 어디가 문제인지 보여요.',
    courseRef: ['풀서네 Lec06'],
  },
];

export const stage3: StageDef = {
  id: 3,
  title: '서비스 오픈',
  subtitle: 'L4 · 소켓 · HTTP',
  topics: ['포트', 'TCP vs UDP · 3-way handshake', '소켓 · 멀티스레드', 'HTTP · 상태 코드 · curl'],
  intro: [
    { who: 'boss', text: '드디어 수강신청 앱이 왔다! 기능이 전부 한 프로그램에 들어 있는 "모놀리식" 앱이야.' },
    { who: 'mentor', text: 'web 서버에 접속해서 앱을 켜고, 로봇 손님(curl)으로 직접 주문해봐. 주문서(요청)와 번호표(응답)를 보게 될 거야.' },
    { who: 'lion', text: '베타 테스터 학생들도 기다리고 있대요. 가보자!', mood: 'happy' },
  ],
  outro: [
    { who: 'mentor', text: '포트는 호실 번호, TCP는 번호 매긴 등기우편, 소켓은 프로그램의 전화기. HTTP는 주문서와 번호표!' },
    { who: 'boss', text: '좋아… 그런데 다음 주가 진짜 수강신청이야. 접속자가 50배는 될 텐데…' },
    { who: 'lion', text: '…설마 괜찮겠죠?', mood: 'worried' },
  ],
  initialWorld: networkedWorld,
  objectives: [
    { id: 'start', text: 'web 서버에 접속해 수강신청 앱 실행하기 (ssh web → server start)', done: (w) => !!w.web?.running },
    { id: 'curl', text: 'curl 로 /enroll 페이지 직접 요청해보기 (200 OK 받기)', done: (_w, c) => c.events.includes('curl:200:/enroll'), after: ['start'] },
  ],
  scenarios,
  interactions: {
    rack1: { kind: 'consolePick', hosts: ['web', 'db'] },
    rack2: { kind: 'console', host: 'spare' },
    rack3: { kind: 'inspect', text: '빈 랙.' },
    rack4: { kind: 'inspect', text: '빈 랙.' },
    switch: { kind: 'inspect', text: '링크 정상.' },
    router: { kind: 'console', host: 'r1' },
    patch: { kind: 'inspect', text: '케이블 정상.' },
    pdu: { kind: 'power' },
    ups: { kind: 'inspect', text: 'UPS 정상.' },
    crac: { kind: 'inspect', text: '냉각 정상.' },
    monitor: { kind: 'dashboard' },
    mentor: { kind: 'mentor' },
    desk: { kind: 'terminal' },
    board: { kind: 'inspect', text: 'TCP 3-way handshake: SYN("얘기할래?") → SYN-ACK("응, 너도?") → ACK("응!")' },
  },
  health: (w) => {
    const r = webHealth(w);
    const services = { ...Object.fromEntries(SERVERS.map((id) => [id, serverStatus(w, id)])), app: r.ok >= 0.99 ? 'up' : r.ok > 0 ? 'degraded' : 'down' } as Record<string, 'up' | 'degraded' | 'down'>;
    return emptyHealth(w, { availability: r.ok, errorRate: 1 - r.ok, latencyMs: r.latency, notes: r.notes, services });
  },
  panels: ['traffic', 'services'],
};
