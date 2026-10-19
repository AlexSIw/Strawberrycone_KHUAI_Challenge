import { replaceCable, repairCrac } from '../../sim/actions';
import { readyPods } from '../../sim/k8s';
import type { Scenario } from '../../sim/scenario';
import type { World } from '../../sim/types';
import { cracNodesBack, k8sHealth, k8sWorld, POD_RPS } from '../k8sWorld';
import type { StageDef } from '../types';

export const SURVIVE_SECONDS = 150;

/** The three root-cause incidents the postmortem is about. */
const MAIN_INCIDENTS = ['s7-traffic', 's7-cable', 's7-cooling'];

/** Below this share of students served, with nothing left that the cluster can heal by itself, the service has collapsed. */
const COLLAPSE_AVAILABILITY = 0.3;
/** No collapse alarm in the first seconds: the player needs time to read the dashboard. */
const COLLAPSE_GRACE = 30;

/**
 * Students mostly can't enroll, and it isn't a short dip while new pods start up:
 * nothing is starting on a node, so the cluster can't fix it without the player.
 */
function collapsed(w: World): boolean {
  const k = w.k8s!;
  if (k.pods.some((p) => p.node !== '' && p.status !== 'Running')) return false;
  return k8sHealth(w).availability < COLLAPSE_AVAILABILITY;
}

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
      '접속자(rps)가 아까보다 얼마나 늘었어? 그동안 신청 pod 수는 그대로야?',
      'pod 하나가 1000 rps쯤 처리해. Stage 6에서 2차 대란을 어떻게 버텼지?',
      '원하는 개수를 접속자에 맞게 늘려봐. 노드에 자리가 없으면 pod가 Pending(NODE <none>)에 머무를 수도 있어.',
    ],
    bannedPhrases: ['scale enroll 12', '12개', '--replicas', 'deploy/enroll'],
    solution: 'scale enroll 12 (노드에 자리가 없어 pod가 Pending에 머물면, 먼저 쓰러진 노드를 살린다)',
    solutionSteps: [{ cmd: 'scale enroll 12', host: 'ops' }],
    concept: 'scaleOut',
    lesson: '트래픽에 맞춰 바로 늘렸어요!',
    courseRef: ['마서프 Lec20'],
  },
  {
    id: 's7-cable',
    stage: 7,
    title: '노드 n3 NotReady',
    // Symptom only: telling apart "too hot" from "can't reach it" is the player's job (hint 1).
    alert: '노드 n3가 갑자기 NotReady! 그 위에 있던 pod들이 사라졌어요…',
    severity: 'critical',
    // Where the symptom shows (rack3's node), not where the fix is.
    room: 'server',
    trigger: { type: 'stageStart', delay: 20 },
    inject: (w) => {
      w.cables.c_n3.broken = true;
    },
    check: (w) => !w.cables.c_n3.broken && w.k8s!.nodes.n3.ready,
    hints: [
      '쓰러진 건 n3 하나뿐이야. n3랑 멀쩡한 n1·n2·n4는 뭐가 달라?',
      '"nodes" 명령으로 n3 온도부터 확인해봐. 온도가 멀쩡하다면 n3로 가는 "길"을 의심해봐. Stage 1에서 배운 L1!',
      '네트워크실 스위치에서 n3 케이블 상태를 확인해봐.',
    ],
    bannedPhrases: ['케이블을 교체', '케이블 교체', '케이블로 교체', '케이블로 바꿔', '새 케이블'],
    solution: '네트워크실 스위치에서 n3 케이블을 교체한다.',
    solutionSteps: [{ label: 'n3 케이블 교체', action: (w) => replaceCable(w, 'c_n3') }],
    concept: 'osi',
    lesson: '쿠버네티스 시대에도 케이블 한 줄이 노드를 쓰러뜨려요. 문제는 L1부터!',
    courseRef: ['풀서네 Lec01–02'],
  },
  {
    id: 's7-cooling',
    stage: 7,
    title: '1·2번 랙 온도 상승',
    // Symptom only: the CRAC behind it is for the player to find (dashboard temp panel).
    alert: '1·2번 랙 온도가 계속 오르고 있어요! 이대로면 노드가 쓰러져요.',
    severity: 'critical',
    room: 'server',
    trigger: { type: 'stageStart', delay: 40 },
    inject: (w) => {
      w.cooling!.cracOk = false;
    },
    // Only the racks the CRAC cools: n3 being down for its cable is s7-cable's business.
    check: (w) => cracNodesBack(w),
    hints: [
      '뜨거워지는 건 1·2번 랙뿐이야. 3·4번 랙이랑 뭐가 다를까? 대시보드 온도 패널을 자세히 봐.',
      '노드가 쓰러지기 전에 막을 수 있으면 제일 좋아. 냉각은 누가 고쳐야 했지?',
      '냉각실 항온항습기로 가서 수리해봐.',
    ],
    bannedPhrases: ['CRAC 수리', '항온항습기를 수리', '항온항습기 수리'],
    solution: '냉각실 항온항습기(CRAC)를 수리한다.',
    solutionSteps: [{ label: 'CRAC 수리', action: repairCrac }],
    concept: 'reschedule',
    lesson: '자동화가 버텨주는 동안 사람은 근본 원인(냉각)을 고쳤어요. 이게 운영!',
    courseRef: ['마서프 Lec13–14'],
  },
  {
    // Feedback, not a game over: it only fires when the other incidents have been left to pile up,
    // and it closes by itself once they are fixed and students can enroll again.
    id: 's7-outage',
    stage: 7,
    title: '학생 민원 폭주',
    alert: '신청 성공률이 바닥이에요… 학교 커뮤니티에 "수강신청 또 터졌냐"는 글이 쏟아지고 있어요!',
    severity: 'warning',
    room: 'noc',
    optional: true,
    trigger: { type: 'condition', when: (w, ctx) => ctx.stageTime >= COLLAPSE_GRACE && collapsed(w) },
    inject: (w) => {
      w.flags.outage = 'active';
    },
    onResolve: (w) => {
      w.flags.outage = 'resolved';
    },
    check: (_w, _ctx, h) => h.availability >= 0.9,
    hints: [
      '대시보드 메모(notes)를 위에서부터 읽어봐. 학생들이 왜 신청을 못 하고 있어?',
      '장애가 여러 개 쌓였어. pod를 다시 띄우려면 살아 있는 노드에 자리가 있어야 해. 쓰러진 노드와 신청 pod 개수, 둘 다 챙겨.',
      '"nodes" 명령으로 NotReady 노드와 그 이유(온도? 연결?)를, "deploys" 명령으로 신청 pod가 원하는 개수만큼 준비됐는지 봐. 남은 장애를 하나씩 끝내면 성공률이 돌아와.',
    ],
    // The answers of the incidents it piles up on, in every wording those incidents ban.
    bannedPhrases: [
      'scale enroll 12', '12개', '--replicas', 'deploy/enroll',
      'CRAC 수리', '항온항습기를 수리', '항온항습기 수리',
      '케이블을 교체', '케이블 교체', '케이블로 교체', '케이블로 바꿔', '새 케이블',
    ],
    solution: '다른 장애가 쌓인 결과다. 남은 장애를 모두 끝낸다: 신청 pod를 접속자에 맞게 늘리고(scale enroll 12), 네트워크실에서 n3 케이블 교체, 냉각실 CRAC 수리. 성공률이 90%를 넘으면 해결.',
    solutionSteps: [
      { cmd: 'scale enroll 12', host: 'ops' },
      { label: 'n3 케이블 교체', action: (w) => replaceCable(w, 'c_n3') },
      { label: 'CRAC 수리', action: repairCrac },
    ],
    concept: 'reschedule',
    lesson: '쿠버네티스도 살아 있는 노드와 넉넉한 pod가 있어야 버텨요. 장애를 쌓아두면 학생 피해가 커져요. 피해가 큰 것부터 빨리 끊는 게 triage!',
    courseRef: ['마서프 Lec13–14, 20'],
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
    { who: 'boss', text: '수강신청 종료! 끝까지 버텼다. 수고했다!' },
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
      text: `수강신청 ${Math.floor(SURVIVE_SECONDS / 60)}분${SURVIVE_SECONDS % 60 ? ` ${SURVIVE_SECONDS % 60}초` : ''} 버티기 + 모든 장애 해결`,
      done: (w, c) => c.stageTime >= SURVIVE_SECONDS && MAIN_INCIDENTS.every((id) => c.resolved.includes(id)) && w.flags.outage !== 'active',
    },
    {
      id: 'postmortem',
      text: '관제실 설계 보드에서 장애 보고서 작성',
      // Only a report filed after the rush counts (the board opens once 'survive' is done).
      done: (_w, c) => (c.eventTimes['board:postmortem'] ?? -1) >= SURVIVE_SECONDS,
      after: ['survive'],
      spot: 'board',
      concept: 'postmortem',
      lesson: '장애 보고서까지 썼어요. 같은 장애가 다시 안 나게 막는 것까지가 운영이에요.',
    },
  ],
  scenarios,
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
