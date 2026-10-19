import { replaceCable, repairCrac } from '../../sim/actions';
import { readyPods } from '../../sim/k8s';
import type { Scenario } from '../../sim/scenario';
import { k8sHealth, k8sWorld, POD_RPS } from '../k8sWorld';
import type { StageDef } from '../types';

export const SURVIVE_SECONDS = 150;

const scenarios: Scenario[] = [
  {
    id: 's7-traffic',
    stage: 7,
    title: '본 수강신청 트래픽',
    alert: '10:00 본 수강신청 오픈!!! 접속자 12,000 rps!',
    severity: 'critical',
    room: 'noc',
    trigger: { type: 'stageStart', delay: 5 },
    inject: (w) => {
      w.traffic.rps = 12000;
    },
    check: (w) => readyPods(w.k8s!, 'enroll').length * POD_RPS >= w.traffic.rps,
    hints: [
      '접속자 대비 신청 pod가 충분해? pod 하나가 1000 rps야.',
      'Stage 6에서 2차 대란을 어떻게 버텼지?',
      '원하는 개수를 접속자에 맞게 늘려봐. 노드가 부족하면 pod가 Pending에 머무를 수도 있어.',
    ],
    bannedPhrases: ['scale enroll 12'],
    solution: 'scale enroll 12 (노드가 부족하면 먼저 노드를 살린다)',
    solutionSteps: [{ cmd: 'scale enroll 12', host: 'ops' }],
    concept: 'scaleOut',
    lesson: '트래픽에 맞춰 바로 늘렸어요!',
    courseRef: ['마서프 Lec20'],
  },
  {
    id: 's7-cable',
    stage: 7,
    title: '노드 n3 NotReady',
    alert: '노드 n3가 갑자기 NotReady! 누가 네트워크실에서 케이블을 건드렸대요…',
    severity: 'critical',
    room: 'network',
    trigger: { type: 'stageStart', delay: 20 },
    inject: (w) => {
      w.cables.c_n3.broken = true;
    },
    check: (w) => !w.cables.c_n3.broken && w.k8s!.nodes.n3.ready,
    hints: [
      'n3만 NotReady야. 온도 문제야, 연결 문제야? nodes 로 온도부터 봐.',
      '온도가 멀쩡하다면 n3로 가는 "길"을 의심해봐. Stage 1에서 배운 L1!',
      '네트워크실 스위치에서 n3 케이블 상태를 확인해봐.',
    ],
    bannedPhrases: ['케이블을 교체', '케이블 교체'],
    solution: '네트워크실 스위치에서 n3 케이블을 교체한다.',
    solutionSteps: [{ label: 'n3 케이블 교체', action: (w) => replaceCable(w, 'c_n3') }],
    concept: 'osi',
    lesson: '쿠버네티스 시대에도 케이블 한 줄이 노드를 쓰러뜨려요. 문제는 L1부터!',
    courseRef: ['풀서네 Lec01–02'],
  },
  {
    id: 's7-cooling',
    stage: 7,
    title: '냉각 경고',
    alert: '항온항습기 필터 막힘 경고! 1·2번 랙 온도가 오르고 있어요!',
    severity: 'critical',
    room: 'cooling',
    trigger: { type: 'stageStart', delay: 40 },
    inject: (w) => {
      w.cooling!.cracOk = false;
    },
    check: (w) => !!w.cooling?.cracOk && Object.values(w.k8s!.nodes).every((n) => n.ready),
    hints: [
      '온도 그래프를 봐. 어느 랙이 뜨거워지고 있어?',
      '노드가 쓰러지기 전에 막을 수 있으면 제일 좋아. 냉각은 누가 고쳐야 했지?',
      '냉각실 항온항습기로 가서 수리해봐.',
    ],
    bannedPhrases: ['CRAC 수리'],
    solution: '냉각실 항온항습기(CRAC)를 수리한다.',
    solutionSteps: [{ label: 'CRAC 수리', action: repairCrac }],
    concept: 'reschedule',
    lesson: '자동화가 버텨주는 동안 사람은 근본 원인(냉각)을 고쳤어요. 이게 운영!',
    courseRef: ['마서프 Lec13–14'],
  },
];

export const stage7: StageDef = {
  id: 7,
  title: '수강신청 본게임',
  subtitle: '복합 장애 + 엔딩',
  topics: ['우선순위 판단 (triage)', '전체 복습', '장애 보고서 (postmortem)'],
  intro: [
    { who: 'boss', text: '드디어 본 수강신청이다. 10시 정각에 열린다.' },
    { who: 'mentor', text: '2분 30초 동안 버티면 돼. 여러 문제가 한꺼번에 올 수 있어. 대시보드를 보고 뭐부터 고칠지 정해.' },
    { who: 'mentor', text: '이번엔 힌트를 최대한 아껴봐. 넌 할 수 있어.' },
    { who: 'lion', text: '…가보자!!', mood: 'happy' },
  ],
  outro: [
    { who: 'boss', text: '수강신청 무사 종료! 서버가 한 번도 완전히 죽지 않았어. 수고했다!' },
    { who: 'mentor', text: '처음엔 케이블 하나 꽂는 것도 몰랐는데, 이제 쿠버네티스 클러스터를 운영하네. 진짜 엔지니어가 됐어.' },
    { who: 'lion', text: '다음 학기도 맡겨주세요!', mood: 'happy' },
    { who: 'mentor', text: '…그런데 다음 학기엔 보안팀이 너를 찾고 있다던데?' },
  ],
  initialWorld: () => {
    const w = k8sWorld({ enrollReplicas: 4 });
    w.traffic.rps = 3500;
    return w;
  },
  objectives: [
    {
      id: 'survive',
      text: `수강신청 ${SURVIVE_SECONDS}초 버티기 + 모든 장애 해결`,
      done: (_w, c) => c.stageTime >= SURVIVE_SECONDS && ['s7-traffic', 's7-cable', 's7-cooling'].every((id) => c.resolved.includes(id)),
    },
    { id: 'postmortem', text: '관제실 설계 보드에서 장애 보고서 작성', done: (_w, c) => c.events.includes('board:postmortem'), after: ['survive'] },
  ],
  scenarios,
  cards: ['postmortem'],
  interactions: {
    rack1: { kind: 'inspect', text: '노드 n1 (rack1).' },
    rack2: { kind: 'inspect', text: '노드 n2 (rack2).' },
    rack3: { kind: 'inspect', text: '노드 n3 (rack3).' },
    rack4: { kind: 'inspect', text: '노드 n4 (rack4).' },
    switch: { kind: 'cable', mode: 'repair' },
    patch: { kind: 'cable', mode: 'repair' },
    router: { kind: 'inspect', text: '정상.' },
    pdu: { kind: 'inspect', text: '전원 정상.' },
    ups: { kind: 'inspect', text: 'UPS 정상.' },
    crac: { kind: 'repair', target: 'crac' },
    monitor: { kind: 'dashboard' },
    mentor: { kind: 'mentor' },
    desk: { kind: 'terminal' },
    board: { kind: 'board', board: 'postmortem' },
  },
  health: k8sHealth,
  panels: ['traffic', 'services', 'temp', 'pods'],
  survive: SURVIVE_SECONDS,
};
