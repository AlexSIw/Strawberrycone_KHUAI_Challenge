// Incident templates first taught on D-1. See IncidentTemplate in src/sim/scenario.ts.
// Checks read what the cluster and the network actually do (pods, nodes, reach, delivery), never a flag
// the solution sets.
import { repairCrac } from '../../sim/actions';
import { endpointReaches, podsOf, readyPods, serviceAt, setImage } from '../../sim/k8s';
import type { IncidentTemplate } from '../../sim/scenario';
import type { World } from '../../sim/types';
import { POD_RPS } from '../k8sWorld';
import { studentsServed } from './d3';
import { ifPhrases, reachesHost } from './d4';

/** A node comes back to Ready once its rack is cooler than this (sim/k8s.ts updateNodes). */
const NODE_SAFE_TEMP = 35;

/** World flag prefix (+ rack id): world time facilities bring that rack's power back after a fire. */
export const RACK_RESTORE = 'power:restoreAt:';
/** Seconds after the fire's fix until facilities restore the rack (time to verify the fix on the backup path). */
const RACK_RESTORE_AFTER = 30;

/** k8s nodes in the racks the CRAC cools (rack 2: K8S-01 · K8S-02). */
export const cracNodes = (w: World): string[] =>
  Object.entries(w.k8s?.nodes ?? {})
    .filter(([, n]) => w.cooling?.cracRacks.includes(n.rack))
    .map(([id]) => id);

/** Enough enroll pods are Running for today's traffic, and students get through. */
export function enrollServing(w: World): boolean {
  const k = w.k8s;
  if (!k) return false;
  return readyPods(k, 'enroll').length * POD_RPS >= Math.max(1, w.traffic.rps) && studentsServed(w);
}

/** The hot nodes are emptied and closed to new pods (`kubectl drain`). */
export function hotNodesDrained(w: World): boolean {
  const k = w.k8s;
  const hot = cracNodes(w);
  return !!k && hot.length > 0 && hot.every((id) => k.nodes[id].cordoned && !k.pods.some((p) => p.node === id));
}

/** Cooling is back: the CRAC runs, its racks are below the safe temperature and their nodes are Ready. */
export function coolingBack(w: World): boolean {
  const k = w.k8s;
  const c = w.cooling;
  if (!k || !c?.cracOk) return false;
  return cracNodes(w).every((id) => (c.temps[k.nodes[id].rack] ?? 24) < NODE_SAFE_TEMP && k.nodes[id].ready);
}

export const templates: IncidentTemplate[] = [
  {
    // The CRAC that cools racks 1–2 stops. Rack 2 holds K8S-01/02 (n1, n2): past 45°C they go NotReady and
    // their pods are recreated elsewhere. Our part: drain them (no new pods there, the rest moved on
    // purpose) and tell facilities; facilities fix the CRAC (onResolve). D-1 only (the day's lesson).
    id: 'd1-heat',
    day: 4,
    until: 4,
    variants: [{ rack: 'rack2' }],
    make: () => ({
      title: '서버실 랙 온도 급상승',
      alert: '서버실 1·2번 랙 쪽이 후끈해요! 온도가 계속 오르고 있어요. 이대로 두면 위험하지 않을까요?',
      severity: 'critical',
      alarm: { source: 'poll', device: 'rack2', text: '랙 온도 급상승 (랙 1·2)' },
      room: 'server',
      inject: (w) => {
        if (w.cooling) w.cooling.cracOk = false;
      },
      check: (w) => enrollServing(w) && (hotNodesDrained(w) || coolingBack(w)),
      // Facilities (they got the same FMS alarm) finish the CRAC repair once our workloads are safe.
      onResolve: repairCrac,
      hints: [
        'FMS(시설 관제) 화면과 노드 목록을 같이 봐. 어느 랙이 뜨겁고, 그 랙에 있는 노드는 어떤 상태야? 거기 있던 pod들은 지금 어디서 돌고 있어?',
        '방을 식히는 건 시설팀 몫이야. FMS에서 시설팀에 알려. 우리 몫은 뜨거운 노드에서 일을 빼고, 다시는 거기로 pod가 안 가게 막아 두는 거야.',
        '노드에 "점검 중" 팻말을 걸어서 새 pod를 막고, 있던 pod를 다른 노드로 내보내는 kubectl 명령이 있어. 뜨거운 랙의 노드마다 해 줘.',
      ],
      // Naming the hot nodes next to the verb gives the whole command away too ('n1, n2를 drain 해').
      bannedPhrases: ['kubectl drain', 'drain n1', 'drain n2', 'cordon n1', 'cordon n2', 'n1, n2', 'n1·n2', 'n1과 n2', 'k8s-01·02', 'k8s-01, k8s-02', '를 drain'],
      solution:
        '항온항습기(CRAC)가 멈춰 랙 1·2 온도가 오르고 있다. 랙 2의 K8S-01·02(n1·n2)는 45°C를 넘으면 NotReady가 되고, 쿠버네티스가 그 위 pod를 다른 노드에 새로 띄운다(nodes 의 TEMP·STATUS, pods 의 NODE·AGE, FMS 랙 온도로 확인. 보통 경보를 볼 즈음엔 이미 옮겨져 있다). 우리 몫: kubectl drain n1 → kubectl drain n2 로 "점검 중" 팻말을 걸어 냉각이 불안한 동안 새 pod가 그 노드로 다시 가지 않게 막고(남은 pod가 있으면 다른 노드로 내보냄), FMS에서 "시설팀 통보". 시설팀이 냉각을 고치면 온도가 내려가고, 다 식으면 uncordon 으로 다시 연다.',
      solutionSteps: [
        { cmd: 'kubectl drain n1', host: 'ops' },
        { cmd: 'kubectl drain n2', host: 'ops' },
      ],
      concept: 'reschedule',
      lesson: '노드가 쓰러지거나(NotReady) 비워지면(drain) 그 위 pod는 사라지고 다른 노드에 새 pod(새 이름·새 IP)가 떠요(재스케줄링). drain의 "점검 중" 팻말은 냉각이 불안한 동안 새 pod가 그 노드로 다시 가지 않게 막아 줘요. 하지만 쿠버네티스는 방을 식혀 주진 못해요. 냉각은 시설팀 몫!',
    }),
  },
  {
    // Fire in network rack 1: suppression cuts the rack's power (CORE-01, BR-01, FW-01, L4-01). HSRP moves
    // every gateway to CORE-02 (built this morning) — but TOR-02's uplink to CORE-02 never carried the K8S
    // VLAN (a hidden single point of failure left by D-1's starting world), so K8S-03/04 drop off.
    // Facilities restore the rack once the service holds without it (onResolve). D-1 only.
    id: 'd1-fire',
    day: 4,
    until: 4,
    variants: [{ rack: 'net1', tor: 'TOR-02', port: 'Te1/1/3', vlan: 40 }],
    make: (v) => {
      const rack = String(v.rack);
      const tor = String(v.tor);
      const port = String(v.port);
      const vlan = Number(v.vlan);
      return {
        title: '네트워크실 1번 랙 화재 · 전원 차단',
        alert: '네트워크실 1번 랙에서 연기가 나서 자동 소화 설비가 작동했어요! 불은 꺼졌는데 랙 전원이 내려갔대요. 서비스는 괜찮은 거죠…?',
        severity: 'critical',
        alarm: { source: 'syslog', device: 'CORE-02', text: 'CORE-02 HSRP 상태 변경 (Standby → Active)' },
        room: 'network',
        inject: (w) => {
          const p = w.power ?? (w.power = { mains: true, ups: true });
          p.racksDown = [...new Set([...(p.racksDown ?? []), rack])];
        },
        check: (w) => reachesHost(w, 'ops', 'n3') && reachesHost(w, 'ops', 'n4') && enrollServing(w),
        // The fire is out; facilities bring the rack's power back a little later (D-1's onTick), so a
        // `show interfaces trunk` right after the fix still shows the backup trunk at work. Then CORE-01
        // takes Active back (preempt).
        onResolve: (w) => {
          w.flags[`${RACK_RESTORE}${rack}`] = w.t + RACK_RESTORE_AFTER;
        },
        hints: [
          '불난 랙에 있던 장비들은 NMS 지도에서 꺼져 있을 거야. 그 짝꿍들이 대신 일하고 있어? 그런데 왜 일부 노드만 연락이 끊겼을까? 끊긴 노드들의 공통점을 찾아봐.',
          '끊긴 노드들이 꽂힌 스위치에서 살아남은 코어까지 가는 길을 따라가 봐. 선 불빛은 초록인데, 그 길이 그 노드들의 VLAN을 실어 나르고 있어? trunk 포트가 실어 나르는 VLAN 목록을 보여주는 show 명령이 있어.',
          '빠진 VLAN이 있으면 그 trunk 포트 설정 모드에서 허용 VLAN 목록에 더해(add) 줘. 다른 VLAN이 지워지지 않게 조심! 그다음 저장.',
        ],
        bannedPhrases: [
          ...ifPhrases(port),
          'allowed vlan add',
          `vlan add ${vlan}`,
          `VLAN ${vlan}`,
          `vlan ${vlan}`,
          `vlan${vlan}`,
          `Vlan${vlan}`,
          // The number-first Korean order and the VLAN's name give the same value away.
          `${vlan}번 vlan`,
          `${vlan}번 브이랜`,
          'k8s vlan',
        ],
        solution: `네트워크실 1번 랙(CORE-01·BR-01·FW-01·L4-01)이 꺼지자 HSRP로 CORE-02가 게이트웨이를 이어받았다(오늘 만든 짝 덕분). 그런데 ${tor} → CORE-02 업링크(${port}) trunk에 K8S VLAN ${vlan}이 빠져 있어서, ${tor}에 꽂힌 K8S-03·04(n3·n4)는 살아남은 코어로 가는 길이 없었다(숨은 단일 장애점). ${tor}에서 show interfaces trunk 로 확인 → enable → configure terminal → interface ${port} → switchport trunk allowed vlan add ${vlan} → end → write memory`,
        solutionSteps: [{ ios: ['enable', 'configure terminal', `interface ${port}`, `switchport trunk allowed vlan add ${vlan}`, 'end', 'write memory'], host: tor }],
        concept: 'failover',
        lesson: '예비(CORE-02)가 있어도 그 길이 끝까지 이어져 있어야 이중화예요. trunk에 VLAN 하나 빠진 게 숨은 단일 장애점이었어요. 이중화는 하나를 실제로 꺼 봐야(failover 훈련) 진짜인지 알 수 있어요.',
      };
    },
  },
  {
    // v1 s6-rollout: a buggy enroll release starts rolling out; pods turn into 500-error pods one by one.
    id: 'd1-rollout',
    day: 4,
    variants: [{ bad: 'enroll:v2' }],
    make: (v) => ({
      title: '신청 에러 급증',
      alert: '신청 버튼을 누르면 500 에러(서버 안에서 처리하다 터졌다는 표시)가 뜬다는 제보가 들어오기 시작했어요! 방금 전까지 멀쩡했는데…',
      severity: 'critical',
      alarm: { source: 'poll', device: 'L4-01', text: '수강신청 HTTP 500 응답 증가' },
      room: 'noc',
      inject: (w) => {
        if (w.k8s) setImage(w.k8s, 'enroll', String(v.bad));
      },
      check: (w) => {
        const k = w.k8s;
        if (!k) return false;
        const d = k.deployments.enroll;
        return !d.rolling && !k.badVersions.includes(d.image) && podsOf(k, 'enroll').every((p) => !k.badVersions.includes(p.version));
      },
      hints: [
        '에러가 언제부터 났지? 그 무렵 클러스터에서 뭐가 바뀌었을까?',
        '배포(새 버전을 올리는 일) 상태와 pod 버전을 봐. 새 버전이 문제라면, 고치는 동안 학생들은 기다려야 할까? 예전 버전으로 돌아갈 수는 없을까?',
        '배포 진행(rollout) 관련 명령어 중에 이전 버전으로 되돌리는 게 있어.',
      ],
      bannedPhrases: ['rollout undo', 'set image enroll'],
      solution: 'enroll:v2 에 버그가 있다 (deploys, pods 의 VERSION, logs 의 500 에러). rollout undo enroll 로 v1으로 되돌린다. (set image enroll enroll:v1 로 다시 배포해도 된다)',
      solutionSteps: [{ cmd: 'rollout undo enroll', host: 'ops' }],
      concept: 'rollback',
      lesson: '쿠버네티스가 이전 버전(:v1)을 기록해 둬서 명령 한 줄로 되돌렸어요(rollback). 새 버전은 pod 하나씩 차례로 바뀌니까(rolling update), 일찍 알아챌수록 덜 망가진 상태에서 되돌릴 수 있어요.',
    }),
  },
  {
    // v1 s6-ip: someone pointed enroll at one course pod's IP, then course was redeployed (new IPs).
    id: 'd1-ip',
    day: 4,
    variants: [{ fallback: '10.244.1.12' }],
    make: (v) => ({
      title: '과목조회 재배포 후 신청 실패',
      alert: '과목조회(course) pod들이 재배포(전부 새로 다시 띄움)된 직후부터 신청이 전부 실패해요!',
      severity: 'critical',
      alarm: { source: 'poll', device: 'L4-01', text: '수강신청 응답 실패율 증가' },
      room: 'noc',
      inject: (w) => {
        const k = w.k8s;
        if (!k) return;
        const old = readyPods(k, 'course')[0];
        // A teammate "optimized" by calling a course pod's IP directly…
        k.deployments.enroll.env.COURSE_URL = old?.ip || String(v.fallback);
        // …then course was redeployed: every course pod comes back with a new IP.
        k.pods = k.pods.filter((p) => p.app !== 'course');
      },
      check: (w) => {
        const k = w.k8s;
        if (!k) return false;
        // Any way of naming the Service works; a pod IP may answer for now but breaks on the next redeploy.
        const url = k.deployments.enroll.env.COURSE_URL ?? '';
        return !!serviceAt(k, url) && endpointReaches(k, url, 'course');
      },
      hints: [
        '신청 pod 로그(앱이 남긴 기록)를 봐. 누구한테 연락하다가 실패하고 있어?',
        'pod는 언젠가 죽고, 새로 태어나면 주소(IP)가 바뀌어. 바뀌는 주소 말고, 절대 안 바뀌는 "대표 번호"로 부를 수는 없을까?',
        '신청 앱의 설정(환경변수)에서 과목조회를 부르는 주소를 대표 번호(Service 이름)로 바꿔봐. Service 목록도 확인해보고.',
      ],
      bannedPhrases: ['COURSE_URL=course-svc', 'env set enroll', 'course-svc'],
      solution: 'enroll이 과목조회 pod IP를 직접 부르고 있다 (logs, env enroll 로 확인). env set enroll COURSE_URL=course-svc (course-svc:8000, http://course-svc 처럼 써도 된다)',
      solutionSteps: [{ cmd: 'env set enroll COURSE_URL=course-svc', host: 'ops' }],
      concept: 'service',
      lesson: 'pod IP는 계속 바뀌어요. Service 이름(대표 번호)으로 부르면 살아 있는 pod로 알아서 연결돼요. D-4에 db를 숫자 대신 이름(DNS)으로 찾았던 것과 같은 원리예요.',
    }),
  },
];
