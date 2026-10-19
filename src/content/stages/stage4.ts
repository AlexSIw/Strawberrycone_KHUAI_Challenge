import { decompose } from '../../sim/actions';
import { capacity } from '../../sim/app';
import type { Scenario } from '../../sim/scenario';
import type { AppService, World } from '../../sim/types';
import type { StageDef } from '../types';
import { emptyHealth, networkedWorld } from '../worlds';

const RPS = 5000;

export function stage4World(): World {
  const w = networkedWorld();
  w.web = { host: 'web', running: true, port: 80, threads: 'multi', routes: ['/', '/enroll', '/courses'] };
  w.notice = { url: '/enroll' };
  const monolith: AppService = {
    name: 'monolith', label: '수강신청 앱 (모놀리스)', up: true, replicas: 1, capacityRps: 8000, share: 1,
    calls: [], dbAccess: ['main-db'], installing: [], crashLoop: false, restartTimer: 5,
  };
  w.app = { arch: 'monolith', services: { monolith }, courseDbSchema: 1, notifyBug: true };
  w.traffic.rps = 600;
  return w;
}

/** Demand on the course service (browsing spikes when everyone checks seats). */
const courseDemand = (w: World) => w.traffic.rps * 0.6 * (Number(w.flags.courseSurge) || 1);

export function appHealth(w: World) {
  const app = w.app!;
  const services: Record<string, 'up' | 'degraded' | 'down'> = {};
  const notes: string[] = [];
  if (app.arch === 'monolith') {
    const m = app.services.monolith;
    services.monolith = m.up ? 'up' : 'down';
    if (!m.up) notes.push('모놀리스 전체 다운 — 알림 기능 버그가 앱 전체를 멈춤');
    const ok = m.up ? Math.min(1, capacity(m) / Math.max(1, w.traffic.rps)) : 0;
    return { ok, latency: m.up ? 60 : 0, services, notes };
  }
  const s = app.services;
  for (const v of Object.values(s)) {
    const demand = v.name === 'course' ? courseDemand(w) : w.traffic.rps * v.share;
    services[v.name] = !v.up ? 'down' : capacity(v) < demand ? 'degraded' : 'up';
  }
  const courseServed = Math.min(1, capacity(s.course) / Math.max(1, courseDemand(w)));
  if (courseServed < 1) notes.push(`과목조회 과부하 (${Math.round(courseServed * 100)}%만 처리)`);
  let ok = (s.login.up ? 1 : 0) * (s.enroll.up ? Math.min(1, capacity(s.enroll) / Math.max(1, w.traffic.rps)) : 0) * courseServed;
  if (s.enroll.dbAccess.includes('course-db') && app.courseDbSchema > 1) {
    ok *= 0.1;
    services.enroll = 'down';
    notes.push('과목 DB 변경 직후부터 신청(enroll) 에러 급증');
  }
  if (!s.notify.up) notes.push('알림 서비스 다운 (신청은 계속 됨)');
  return { ok, latency: courseServed < 1 ? 1800 : 70, services, notes };
}

const scenarios: Scenario[] = [
  {
    id: 's4-monolith',
    stage: 4,
    title: '수강신청 대란 · 전체 다운',
    alert: '10:01 수강신청 시작 1분 만에 서버 전체 다운!! 알림 메일 기능에서 에러가 났대요. 아무도 신청을 못 해요!',
    severity: 'critical',
    room: 'noc',
    trigger: { type: 'stageStart', delay: 5 },
    inject: (w) => {
      w.traffic.rps = RPS;
      const m = w.app!.services.monolith;
      if (m) m.restartTimer = 0;
    },
    check: (w) => w.app?.arch === 'msa' && !!w.app.services.enroll?.up,
    hints: [
      '재시작해도 또 죽지? 알림 메일 기능 하나 때문에 왜 로그인, 과목조회, 신청까지 다 멈출까?',
      '지금 앱은 주방 하나·창고 하나인 큰 식당이야. 한 코너에서 불이 나면 식당 전체가 문을 닫아. 푸드코트라면?',
      '관제실 설계 보드에서 기능들을 "하는 일(업무)" 단위로 나눠봐. 화면(UI)·로직(처리 규칙)·DB(데이터 창고)처럼 기술 층으로 자르면 안 돼.',
    ],
    bannedPhrases: ['로그인 · 과목조회 · 장바구니 · 신청 · 알림', '5개로 나눠'],
    solution: '관제실 설계 보드에서 모놀리스를 기능별 서비스(로그인·과목조회·장바구니·신청·알림)로 분리한다.',
    solutionSteps: [{ label: '서비스 분해', action: decompose }],
    concept: 'monolith',
    lesson: '한 덩어리(모놀리스)는 알림 버그 하나에도 전체가 멈춰요. 기능별 작은 서비스로 나누면(마이크로서비스, MSA) 푸드코트처럼 탈 난 매장만 문을 닫아요.',
  },
  {
    id: 's4-notify',
    stage: 4,
    title: '알림 서비스 다운',
    alert: '알림 서비스가 또 죽었어요! …어? 그런데 수강신청은 계속 되고 있어요?',
    severity: 'warning',
    room: 'noc',
    trigger: { type: 'after', scenario: 's4-monolith', delay: 5 },
    inject: (w) => {
      const n = w.app!.services.notify;
      if (n) n.up = false;
    },
    check: (w) => !!w.app?.services.notify?.up && !w.app.notifyBug,
    hints: [
      '대시보드의 가용성(신청이 성공하는 비율)을 봐. 알림이 죽었는데 그 숫자는 어때? 아까랑 뭐가 달라졌지?',
      '이제 알림은 독립된 매장이야. 그 매장만 손보면 돼. 서비스 상태를 보는 명령어부터!',
      '알림팀이 버그를 급히 고친 새 버전(핫픽스)을 올렸대. 알림 서비스만 다시 시작하면 반영돼.',
    ],
    bannedPhrases: ['svc restart notify'],
    solution: '알림 서비스만 재시작한다: svc restart notify (급히 고친 새 버전, 핫픽스가 반영됨)',
    solutionSteps: [{ cmd: 'svc restart notify', host: 'ops' }],
    concept: 'isolation',
    lesson: '알림이 죽어도 신청은 됐어요! 서비스를 나눈 덕분에 장애가 번지지 않았어요 (장애 격리).',
  },
  {
    id: 's4-course',
    stage: 4,
    title: '과목조회 폭주',
    alert: '모두가 빈자리 새로고침 중! 과목조회가 느려지면서 신청까지 버벅여요.',
    severity: 'critical',
    room: 'noc',
    trigger: { type: 'after', scenario: 's4-notify', delay: 6 },
    inject: (w) => {
      w.flags.courseSurge = 2;
    },
    check: (w) => capacity(w.app!.services.course) >= courseDemand(w),
    hints: [
      '모든 서비스가 바쁜 게 아니야. 대시보드 서비스 맵에서 노란불(과부하)인 매장은 어디야?',
      '붐비는 매장만 직원을 늘릴 수 있는 게 서비스를 나눈 장점이야. 서버 수를 바꾸는 명령어가 있어.',
      '과목조회 서버를 2~3대로 늘려봐. 손으로 설치하는 거라 시간이 좀 걸릴 거야.',
    ],
    bannedPhrases: ['svc scale course'],
    solution: '과목조회만 늘린다: svc scale course 3 (서버당 설치에 몇 초씩 걸림)',
    solutionSteps: [{ cmd: 'svc scale course 3', host: 'ops' }],
    concept: 'scaling',
    lesson: '바쁜 과목조회만 골라 늘렸어요(독립 확장). 근데 서버를 손으로 깔다 보니 너무 느리죠? → 다음 Stage에서 더 빠른 방법을 만나요!',
  },
  {
    id: 's4-shared-db',
    stage: 4,
    title: '신청 서비스 에러 급증',
    alert: '과목팀이 과목 DB 구조를 바꿨는데… 왜 신청 서비스가 터져요?!',
    severity: 'critical',
    room: 'noc',
    trigger: { type: 'after', scenario: 's4-course', delay: 6 },
    inject: (w) => {
      const e = w.app!.services.enroll;
      if (e && !e.dbAccess.includes('course-db')) e.dbAccess.push('course-db');
      w.app!.courseDbSchema = 2;
    },
    check: (w) => !w.app!.services.enroll.dbAccess.includes('course-db'),
    hints: [
      '과목팀이 바꾼 건 과목 DB뿐인데, 왜 하필 신청 서비스가 아플까?',
      '신청 서비스가 과목 정보를 어디서 가져오는지 확인해봐. 남의 매장 창고에 몰래 들어가서 재료를 가져오고 있다면, 그 창고 배치가 바뀌면 어떻게 될까?',
      '창고에 직접 들어가는 대신 과목조회 매장 카운터(API: 정해진 방식으로 주문을 받는 창구)에 주문하도록 설정을 바꿔봐.',
    ],
    bannedPhrases: ['svc config enroll course-source api', 'course-source api'],
    solution: '신청 서비스가 course-db를 직접 읽고 있다. svc config enroll course-source api',
    solutionSteps: [{ cmd: 'svc config enroll course-source api', host: 'ops' }],
    concept: 'dbPerService',
    lesson: '남의 DB를 직접 읽으면 나눠놓고도 다시 한 덩어리(분산 모놀리스)! 서비스끼리는 API(카운터 주문)로만 대화해요.',
  },
];

export const stage4: StageDef = {
  id: 4,
  title: '1차 수강신청 대란',
  subtitle: '한 덩어리 앱을 기능별 서비스로 나누기',
  topics: ['모놀리스 vs MSA', '기능별로 나누기', '장애 격리 · 독립 확장', '서비스마다 DB 따로 · API로 대화'],
  intro: [
    { who: 'boss', text: '오늘이 1차 수강신청이다. 9시 59분… 접속자가 평소의 50배로 몰릴 거야.' },
    { who: 'lion', text: '서버 상태 좋아요! 이번엔 문제없겠죠?', mood: 'happy' },
    { who: 'mentor', text: '…글쎄. 관리 PC에서 svc list로 서비스 상태를 계속 지켜봐.' },
  ],
  outro: [
    { who: 'mentor', text: '"공짜 점심은 없다." 나누면 장애 격리·독립 확장을 얻어. 대신 서비스끼리 네트워크로 주고받는 일과 돌볼 게 늘어나.' },
    { who: 'mentor', text: '그리고 모놀리스가 나쁜 건 아니야. 상황에 맞게 고르는 거지. 작고 단순한 서비스라면 한 덩어리가 오히려 편할 때도 있어.' },
    { who: 'boss', text: '근데 서버 하나 늘리는 데 이렇게 오래 걸려서야… 더 빠른 방법이 필요해.' },
  ],
  initialWorld: stage4World,
  objectives: [
    { id: 'watch', text: '관리 PC 터미널에서 svc list로 서비스 상태 확인', spot: 'desk', done: (_w, c) => c.commands.some((x) => x.startsWith('svc')) },
  ],
  scenarios,
  interactions: {
    rack1: { kind: 'inspect', text: '수강신청 앱(모놀리스)이 돌아가는 서버.' },
    rack2: { kind: 'inspect', text: '예비 서버. 서비스를 늘릴 때 여기에 손으로 설치해요.' },
    rack3: { kind: 'inspect', text: '빈 랙.' },
    rack4: { kind: 'inspect', text: '빈 랙.' },
    switch: { kind: 'inspect', text: '링크 정상.' },
    router: { kind: 'inspect', text: '트래픽이 엄청나요!' },
    patch: { kind: 'inspect', text: '케이블 정상.' },
    pdu: { kind: 'inspect', text: '전원 정상.' },
    ups: { kind: 'inspect', text: 'UPS(비상 배터리) 정상.' },
    crac: { kind: 'inspect', text: '냉각 정상.' },
    monitor: { kind: 'dashboard' },
    mentor: { kind: 'mentor' },
    desk: { kind: 'terminal' },
    board: { kind: 'board', board: 'decompose' },
  },
  health: (w) => {
    const r = appHealth(w);
    return emptyHealth(w, { availability: r.ok, errorRate: 1 - r.ok, latencyMs: r.latency, services: r.services, notes: r.notes });
  },
  panels: ['traffic', 'services'],
};
