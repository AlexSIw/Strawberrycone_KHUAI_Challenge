import { repairCrac } from '../../sim/actions';
import { endpointReaches, podsOf, readyPods, serviceAt, setImage } from '../../sim/k8s';
import type { Scenario } from '../../sim/scenario';
import type { PlayContext } from '../../sim/types';
import { cracNodesBack, k8sHealth, k8sWorld, POD_RPS } from '../k8sWorld';
import type { StageDef } from '../types';

/** Ways of looking at the cluster that show the replaced pod: terminal lists, pod logs, the dashboard. */
const CRASH_LOOKS = ['k8s_get_pods', 'k8s_get_deploy', 'k8s_get_svc', 'k8s_logs:enroll', 'open:dashboard'];
/** Seconds after the crash when the self-healing incident closes even if nobody looked. */
const CRASH_SELF_CLOSE = 25;

const lookedSince = (ctx: PlayContext, t: number, events: string[]) => events.some((e) => (ctx.eventTimes[e] ?? -1) >= t);

const scenarios: Scenario[] = [
  {
    id: 's6-crash',
    stage: 6,
    title: 'pod 하나가 죽음',
    alert: '신청 pod 하나가 갑자기 죽었어요! 빨리 가서 살려야…',
    severity: 'warning',
    room: 'noc',
    trigger: { type: 'objective', objective: 'desired', delay: 6 },
    inject: (w) => {
      const k = w.k8s!;
      const victim = podsOf(k, 'enroll')[0];
      if (!victim) return;
      k.pods = k.pods.filter((p) => p !== victim);
      w.flags.crashedPod = victim.name;
      w.flags.crashAt = w.t;
    },
    // Nothing to fix: the cluster heals itself. The player only has to look (any of the ways
    // below), and even without looking the incident closes once the lesson has had time to play out.
    check: (w, ctx) => {
      const crashAt = Number(w.flags.crashAt ?? 0);
      const healed = readyPods(w.k8s!, 'enroll').length >= w.k8s!.deployments.enroll.replicas;
      return healed && (lookedSince(ctx, crashAt, CRASH_LOOKS) || w.t >= crashAt + CRASH_SELF_CLOSE);
    },
    hints: [
      '일단 지금 pod 목록을 확인해봐. 정말 죽어 있어?',
      '네가 적어둔 "원하는 상태"에는 신청 pod가 몇 개였지? 실제 개수와 비교해봐.',
      'pod 목록을 보는 명령어로 신청 pod들의 이름과 AGE(태어난 지 얼마나 됐는지)를 살펴봐. 유난히 어린 pod가 있어?',
    ],
    bannedPhrases: ['아무것도 안 해도', '자동으로 다시'],
    solution: '아무것도 고칠 필요 없다. pods(또는 deploys)로 확인하면 쿠버네티스가 이미 새 pod(처음 보는 이름, AGE 몇 초)를 띄워 원하는 개수를 맞춰 놓았다.',
    solutionSteps: [{ cmd: 'pods', host: 'ops' }],
    concept: 'selfHealing',
    lesson: '내가 손대기도 전에 새 pod가 떴어요! 죽은 pod가 되살아난 게 아니라, 이름도 IP도 새로 받은 새 pod예요. 적어둔 원하는 개수를 쿠버네티스가 계속 맞추거든요 (self-healing).',
  },
  {
    id: 's6-ip',
    stage: 6,
    title: '과목조회 재배포 후 신청 실패',
    alert: '과목조회 pod들이 재배포된 직후부터 신청이 전부 실패해요!',
    severity: 'critical',
    room: 'noc',
    trigger: { type: 'after', scenario: 's6-crash', delay: 6 },
    inject: (w) => {
      const k = w.k8s!;
      const old = readyPods(k, 'course')[0];
      // A teammate "optimized" by calling the course pod's IP directly…
      k.deployments.enroll.env.COURSE_URL = old?.ip ?? '10.244.1.12';
      // …then course was redeployed: every course pod comes back with a new IP.
      k.pods = k.pods.filter((p) => p.app !== 'course');
    },
    check: (w) => {
      const k = w.k8s!;
      // Any way of naming the Service works: course-svc, course-svc:8000, http://course-svc …
      // A pod IP may answer for now, but it is exactly the address that breaks on the next redeploy.
      const url = k.deployments.enroll.env.COURSE_URL ?? '';
      return !!serviceAt(k, url) && endpointReaches(k, url, 'course');
    },
    hints: [
      '신청 pod 로그를 봐. 누구한테 연락하다가 실패하고 있어?',
      'pod는 언젠가 죽고, 새로 태어나면 주소(IP)가 바뀌어. 바뀌는 주소 대신 절대 안 바뀌는 "대표 번호"가 있었지?',
      '신청 앱의 설정(환경변수)에서 과목조회를 부르는 주소를 대표 번호(Service 이름)로 바꿔봐. Service 목록도 확인해보고.',
    ],
    bannedPhrases: ['COURSE_URL=course-svc', 'env set enroll', 'course-svc'],
    solution: 'enroll이 과목조회 pod IP를 직접 부르고 있다. env set enroll COURSE_URL=course-svc (course-svc:8000, http://course-svc 처럼 써도 된다)',
    solutionSteps: [{ cmd: 'env set enroll COURSE_URL=course-svc', host: 'ops' }],
    concept: 'service',
    lesson: 'pod IP는 계속 바뀌어요. Service 이름(대표 번호)으로 부르면 살아 있는 pod로 알아서 연결돼요. Stage 2에서 db를 숫자 대신 이름(DNS)으로 찾았던 것과 같은 원리예요.',
  },
  {
    id: 's6-crac',
    stage: 6,
    title: '1·2번 랙 온도 급상승',
    // Symptom only: which machine is behind the hot racks is for the player to find (dashboard temp panel).
    alert: '서버실 1·2번 랙 온도가 빠르게 오르고 있어요!! 이대로면 노드가 쓰러져요!',
    severity: 'critical',
    room: 'server',
    trigger: { type: 'after', scenario: 's6-ip', delay: 6 },
    inject: (w) => {
      w.cooling!.cracOk = false;
    },
    check: (w) => cracNodesBack(w),
    hints: [
      '대시보드 온도 그래프와 "nodes" 명령 결과를 봐. 어떤 노드들이 아파? 그 노드에 있던 pod들은 어떻게 됐어?',
      '쿠버네티스는 쓰러진 노드 대신 살아 있는 노드에 pod를 새로 띄워줄 수는 있어도, 더운 방을 식혀주진 못해. 그건 사람 몫이야.',
      '냉각실로 직접 가서 항온항습기를 고쳐봐. 온도가 내려가면 노드가 돌아와.',
    ],
    bannedPhrases: ['냉각실로 가서 수리', 'CRAC 수리', '항온항습기를 수리', '항온항습기 수리'],
    solution: '냉각실 항온항습기(CRAC)를 수리한다. 온도가 35°C 아래로 내려가면 노드가 Ready로 돌아온다.',
    solutionSteps: [{ label: 'CRAC 수리', action: repairCrac }],
    concept: 'reschedule',
    lesson:
      '과열된 노드의 pod는 사라지고, 쿠버네티스가 살아 있는 노드에 새 pod를 대신 띄웠어요(재스케줄링 · 이름도 IP도 새로). 하지만 방을 식히는 건 사람 몫! 그리고 2022년 카카오 판교 데이터센터 화재처럼 건물 전체 전원이 끊기면 노드끼리 돕는 걸로는 못 버텨요. 그땐 다른 데이터센터로의 이중화(DR)가 필요해요.',
  },
  {
    id: 's6-traffic',
    stage: 6,
    title: '수강신청 2차 대란',
    alert: '2차 수강신청 시작! 접속자가 평소(2,500 rps)의 3배가 넘어요. 응답이 느려지고 있어요!',
    severity: 'critical',
    room: 'noc',
    trigger: { type: 'after', scenario: 's6-crac', delay: 5 },
    inject: (w) => {
      w.traffic.rps = 9000;
    },
    check: (w) => readyPods(w.k8s!, 'enroll').length * POD_RPS >= w.traffic.rps,
    hints: [
      '대시보드에서 접속 숫자가 평소랑 비교해서 얼마나 늘었는지 봐. 신청 pod 수는 그대로야?',
      '신청 pod 하나가 대략 1000 rps를 처리해. Stage 4에선 서버를 손으로 깔았지? 이제는 "원하는 개수"만 바꾸면 돼.',
      'pod 개수를 바꾸는 명령어를 help에서 찾아서, 필요한 만큼 늘려봐.',
    ],
    bannedPhrases: ['scale enroll 9', 'scale enroll 10', '--replicas', 'deploy/enroll', '9개', '10개'],
    solution: '신청 pod를 늘린다: scale enroll 10',
    solutionSteps: [{ cmd: 'scale enroll 10', host: 'ops' }],
    concept: 'scaleOut',
    lesson: '숫자 하나만 바꿨는데 몇 초 만에 pod가 늘어났어요. 손으로 서버를 깔던 Stage 4와 비교해보세요!',
  },
  {
    id: 's6-rollout',
    stage: 6,
    title: '신청 에러 급증',
    // Symptom only: the v1 → v2 change is for the player to find in the dashboard's rollout column.
    alert: '신청 버튼을 누르면 500 에러가 뜬다는 제보가 들어오기 시작했어요! 방금 전까지 멀쩡했는데…',
    severity: 'critical',
    room: 'noc',
    trigger: { type: 'after', scenario: 's6-traffic', delay: 6 },
    inject: (w) => {
      setImage(w.k8s!, 'enroll', 'enroll:v2');
    },
    check: (w) => {
      const k = w.k8s!;
      const d = k.deployments.enroll;
      return !d.rolling && !k.badVersions.includes(d.image) && podsOf(k, 'enroll').every((p) => !k.badVersions.includes(p.version));
    },
    hints: [
      '에러가 언제부터 났지? 그 무렵 클러스터에서 뭐가 바뀌었을까?',
      '배포 상태와 pod 버전을 봐. 새 버전이 문제라면, 고치는 동안 학생들은 기다려야 할까? 예전 버전으로 돌아갈 수는 없을까?',
      'rollout 관련 명령어 중에 이전 버전으로 되돌리는 게 있어.',
    ],
    bannedPhrases: ['rollout undo', 'set image enroll'],
    solution: 'v2에 버그가 있다. rollout undo enroll 로 v1으로 되돌린다. (set image enroll enroll:v1 로 다시 배포해도 된다)',
    solutionSteps: [{ cmd: 'rollout undo enroll', host: 'ops' }],
    concept: 'rollback',
    lesson:
      '쿠버네티스가 이전 버전(:v1)을 기록해 둬서 명령 한 줄로 되돌렸어요. 버전 태그(:v1, :v2) 덕분이에요. :latest였다면 어디로 돌아가야 할지 몰랐을 거예요! 그리고 rolling update는 새 pod가 준비돼야 옛 pod를 하나씩 내리니까, 일찍 알아챌수록 덜 망가진 상태에서 되돌릴 수 있어요.',
  },
];

export const stage6: StageDef = {
  id: 6,
  title: '자동으로 버티는 데이터센터',
  subtitle: 'Kubernetes 개념 · 오케스트레이션',
  topics: ['Cluster · Node · Pod', '원하는 상태 · Self-healing', 'Service', 'Scale-out · Rolling update · Rollback'],
  intro: [
    { who: 'boss', text: '노드 4대, 컨테이너 수십 개. 이제 사람이 손으로 관리하는 건 불가능해.' },
    { who: 'mentor', text: '그래서 "항공 관제사"를 들였어. 쿠버네티스. 우리는 "원하는 상태"만 적어주면 돼.' },
    { who: 'mentor', text: '관제실 설계 보드에서 신청 서비스의 원하는 상태 카드를 써봐. 몇 개를 띄울지, 어떤 버전인지.' },
    { who: 'lion', text: '원하는 걸 적으면 알아서 맞춰준다… 마법 같은데요?', mood: 'happy' },
  ],
  outro: [
    { who: 'mentor', text: 'pod는 죽어도 다시 뜨고, Service가 대표 번호가 되고, 숫자만 바꾸면 늘어나고, 문제가 생기면 되돌린다.' },
    { who: 'mentor', text: '하지만 항온항습기는 사람이 고쳐야 했지? 자동화가 전부는 아니야.' },
    { who: 'boss', text: '좋아. 이제 진짜 본 수강신청이다. 모든 걸 걸고 버텨보자.' },
  ],
  initialWorld: () => k8sWorld({ enrollReplicas: 0 }),
  objectives: [
    {
      id: 'desired',
      text: '관제실 설계 보드에서 신청 서비스(enroll)의 "원하는 상태" 작성',
      done: (w) => w.k8s!.deployments.enroll.replicas >= 2,
      spot: 'board',
      concept: 'pod',
      lesson: '노드 4대가 모인 게 클러스터, 그 위에서 도는 가장 작은 실행 단위가 pod예요. 우리는 개수와 버전만 적었어요.',
    },
    { id: 'observe', text: '관리 PC 터미널에서 "pods" 명령으로 pod가 떴는지 확인', spot: 'desk', done: (_w, c) => c.events.includes('k8s_get_pods'), after: ['desired'] },
  ],
  scenarios,
  interactions: {
    rack1: { kind: 'inspect', text: '노드 n1 (rack1). 항온항습기가 식혀주는 랙이에요.' },
    rack2: { kind: 'inspect', text: '노드 n2 (rack2). 항온항습기가 식혀주는 랙이에요.' },
    rack3: { kind: 'inspect', text: '노드 n3 (rack3).' },
    rack4: { kind: 'inspect', text: '노드 n4 (rack4).' },
    switch: { kind: 'inspect', text: '노드 4대가 연결된 스위치. 링크 정상.' },
    router: { kind: 'inspect', text: '정상.' },
    patch: { kind: 'inspect', text: '정상.' },
    pdu: { kind: 'inspect', text: '전원 정상.' },
    ups: { kind: 'inspect', text: 'UPS 정상.' },
    crac: { kind: 'repair', target: 'crac' },
    monitor: { kind: 'dashboard' },
    mentor: { kind: 'mentor' },
    desk: { kind: 'terminal' },
    board: { kind: 'board', board: 'desired' },
  },
  health: k8sHealth,
  panels: ['traffic', 'services', 'temp', 'pods'],
};
