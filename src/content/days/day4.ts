// D-1: 점검 · 이중화 (v1 stage 6 + HSRP). The app moves onto the Kubernetes cluster (desired state on the
// board, then look at the pods), CORE-02 joins the VLAN 10/40 gateways as HSRP standby, and the
// redundancy checklist (show standby brief, show etherchannel summary, PSU A/B in the FMS).
// Teaching incidents: the CRAC stops (drain the hot nodes, tell facilities); fire in network rack 1
// (HSRP fails over to CORE-02, and a trunk missing the K8S VLAN cuts K8S-03/04 off).
import { snapshot } from '../../sim/ios/config';
import { readyPods } from '../../sim/k8s';
import { campusDelivery, studentDelivery, sviUp } from '../../sim/network';
import type { Device, Health, PlayContext, World } from '../../sim/types';
import { RACK_RESTORE } from '../incidents/d1';
import { k8sHealth, k8sLayer } from '../k8sWorld';
import { ADDR } from '../topology';
import type { DaySpec, GuideStep } from '../types';
import { emptyHealth } from '../worlds';
import { BASE_INTERACTIONS, WEEKDAY_CLOCK } from './common';

/** Rehearsal traffic: requests per second all day. */
const REHEARSAL_RPS = 1500;
/** The VLANs whose gateway CORE-02 joins today (선배 did the others). */
const STANDBY_VLANS = [10, 40];
/** The hidden single point of failure: TOR-02's uplink to CORE-02 doesn't carry the K8S VLAN yet. */
const SPOF = { tor: 'TOR-02', port: 'Te1/1/3', vlan: 40 };

type Status = 'up' | 'degraded' | 'down';
const status = (ok: number): Status => (ok >= 0.99 ? 'up' : ok > 0 ? 'degraded' : 'down');

const nd = (w: World, id: string) => w.devices[id]?.nd;

/** A fresh startup-config snapshot, so the day starts with nothing unsaved. */
function resave(d: Device | undefined): void {
  const n = d?.nd;
  if (!n) return;
  n.startup = snapshot(n);
  n.dirty = false;
}

/**
 * CORE-02's `interface vlan N`: its own address .3/24, `standby 1 ip .1` (CORE-01's group), a lower
 * priority than CORE-01 (so CORE-01 stays Active), preempt on, not shut down, and up.
 */
function standbyReady(w: World, v: number): boolean {
  const s = nd(w, 'CORE-02')?.svis[v];
  const active = nd(w, 'CORE-01')?.svis[v]?.hsrp;
  const h = s?.hsrp;
  if (!s || !h || s.shutdown || s.ip !== ADDR.core(v, 2) || s.mask !== 24) return false;
  if (h.vip !== ADDR.gw(v) || !h.preempt || h.group !== (active?.group ?? 1) || h.priority >= (active?.priority ?? 110)) return false;
  return sviUp(w, 'CORE-02', v);
}
const standbys = (w: World) => STANDBY_VLANS.filter((v) => standbyReady(w, v));

/** The redundancy checklist: HSRP on a core, the TOR-01 bundle, the PSU A/B readings in the FMS. */
const CHECKS: [string, (e: string) => boolean][] = [
  ['hsrp', (e) => /^ios:CORE-0[12]:show standby brief$/.test(e)],
  ['lacp', (e) => e === 'ios:TOR-01:show etherchannel summary'],
  ['psu', (e) => e === 'noc:fms'],
];
/** World time the checklist opened (stamped when the mission before it completes). */
const CHECKLIST_AT = 'checklist:openedAt';
/** Checklist items looked at since the checklist opened (a look during an earlier mission doesn't count). */
function checked(w: World, c: PlayContext) {
  const since = Number(w.flags[CHECKLIST_AT] ?? Infinity);
  return CHECKS.filter(([, ok]) => c.events.some((e) => ok(e) && (c.eventTimes[e] ?? -1) >= since));
}

// ---------- first-time guides (each step ticks from what the player really did) ----------

const svi = (w: World, v: number) => nd(w, 'CORE-02')?.svis[v];
const standbyDone = (w: World) => standbys(w).length === STANDBY_VLANS.length;

/** CORE-02 as the standby gateway: VLAN 10 step by step, then VLAN 40 the same way, then save. */
const HSRP_STEPS: GuideStep[] = [
  {
    text: 'CORE-02에 접속하기',
    cmd: 'ssh CORE-02',
    why: '관리 PC에서 ssh로 들어가요. 네트워크실의 콘솔로 들어가도 돼요.',
    done: (_w, c) => c.events.some((e) => e === 'ssh:CORE-02' || e.startsWith('ios:CORE-02:')),
  },
  {
    text: '설정 모드로 들어가기 (enable 다음)',
    cmd: 'configure terminal',
    why: 'CORE-02> 는 보기만 하는 곳이에요. enable 하면 CORE-02#, configure terminal 하면 설정을 바꾸는 (config)# 가 돼요.',
    done: (w, c) => c.events.includes('ios:CORE-02:configure terminal') || !!svi(w, 10) || !!svi(w, 40),
  },
  {
    text: 'VLAN 10의 게이트웨이 칸 열기',
    cmd: 'interface vlan 10',
    why: '코어에는 VLAN마다 "그 VLAN의 문" 칸(VLAN 인터페이스)이 하나씩 있어요. 여기에 CORE-02의 주소와 짝 설정을 넣어요.',
    done: (w) => !!svi(w, 10),
  },
  {
    text: 'CORE-02 자기 주소 정하기 (.3)',
    cmd: `ip address ${ADDR.core(10, 2)} 255.255.255.0`,
    why: '주소는 10.10.<VLAN>.x 모양이에요. .1 = 두 코어가 같이 쓰는 가상 게이트웨이, .2 = CORE-01, .3 = CORE-02. 255.255.255.0 은 /24: 앞 세 칸이 같은 주소끼리 한 동네라는 뜻이에요.',
    done: (w) => svi(w, 10)?.ip === ADDR.core(10, 2) && svi(w, 10)?.mask === 24,
  },
  {
    text: '가상 게이트웨이 .1을 CORE-01과 함께 맡기',
    cmd: `standby 1 ip ${ADDR.gw(10)}`,
    why: 'CORE-01과 같은 그룹 번호(1)와 같은 가상 주소(.1)를 적어야 둘이 한 짝이 돼요. 서버들은 계속 .1만 보고 나가요.',
    done: (w) => svi(w, 10)?.hsrp?.vip === ADDR.gw(10),
  },
  {
    text: '평소엔 짝(Standby)으로 기다리게 하기: 우선순위 100 · preempt',
    cmd: 'standby 1 preempt',
    why: '우선순위(priority)는 누가 Active를 맡을지 정하는 숫자예요. CORE-01이 110이라 CORE-02는 그보다 낮은 100(기본값, standby 1 priority 100)으로 둬요. preempt는 "내 우선순위가 더 높으면 Active를 되찾는다"는 규칙이라, 양쪽에 똑같이 켜 둬요.',
    done: (w) => !!svi(w, 10)?.hsrp?.preempt && (svi(w, 10)?.hsrp?.priority ?? 100) < 110,
  },
  {
    text: 'VLAN 40(K8S)도 똑같이 하기',
    cmd: 'interface vlan 40',
    why: `주소만 바뀌어요: ip address ${ADDR.core(40, 2)} 255.255.255.0 · standby 1 ip ${ADDR.gw(40)} · standby 1 preempt`,
    done: (w) => standbyReady(w, 40),
  },
  {
    text: '설정 저장하기 (end 로 나온 다음)',
    cmd: 'write memory',
    why: '저장해야 재부팅해도 남아요.',
    done: (w) => standbyDone(w) && nd(w, 'CORE-02')?.dirty === false,
  },
];

const nodesAll = (w: World, ok: (n: { ready: boolean; cordoned?: boolean }) => boolean) => !!w.k8s && Object.values(w.k8s.nodes).every(ok);

/** Looking at the pods: the brief says only "Running"; the other columns are explained as the player looks at them. */
const OBSERVE_STEPS: GuideStep[] = [
  {
    text: '관리 PC 터미널에서 pod 목록 보기',
    cmd: 'pods',
    why: 'NODE 칸 = 그 pod가 도는 노드(서버). IP 칸 = pod 주소인데 새로 뜨면 바뀌어서, 학생 요청은 바뀌지 않는 대표 이름(Service, enroll-svc)을 거쳐 살아 있는 pod로 가요.',
    done: (_w, c) => c.events.includes('k8s_get_pods'),
  },
  {
    text: '신청 pod 2개가 모두 Running일 때 한 번 더 보기',
    cmd: 'pods',
    why: '노드 쪽 사정(Ready = 일할 수 있음 · NotReady = 일 못 함, 랙 RACK, 온도 TEMP)은 nodes 로 봐요.',
    done: (w, c) => podsSeen(w, c),
  },
];

/** Reopening the nodes drained during the heat incident. */
const UNCORDON_STEPS: GuideStep[] = [
  {
    text: '노드 상태 보기: 모두 다시 Ready가 될 때까지',
    cmd: 'nodes',
    why: 'STATUS가 Ready면 일할 수 있음, NotReady면 쓰러짐, SchedulingDisabled는 drain으로 건 "점검 중" 팻말이에요. 냉각이 돌아와 랙이 35°C 아래로 식으면 Ready로 돌아와요.',
    done: (w, c) => nodesAll(w, (n) => n.ready) && (c.events.includes('k8s_get_nodes') || nodesAll(w, (n) => !n.cordoned)),
  },
  {
    text: '비웠던 노드마다 팻말 떼기',
    cmd: 'uncordon n1',
    why: 'Ready가 돼도 팻말은 그대로라, uncordon 해야 다시 pod를 받아요. drain 했던 노드마다 해요.',
    done: (w) => nodesAll(w, (n) => n.ready && !n.cordoned),
  },
];

/** The redundancy checklist, one look each (looks from before the checklist opened don't count). */
const CHECKLIST_STEPS: GuideStep[] = [
  {
    text: '코어의 게이트웨이 짝 보기 (CORE-01이나 CORE-02에서)',
    cmd: 'show standby brief',
    why: 'VLAN(Interface)마다 State가 Active나 Standby로, Active·Standby 칸에 짝의 주소가 보이면 둘 다 살아 있는 거예요(local = 이 장비 자신). unknown이면 짝이 없어요.',
    done: (w, c) => checked(w, c).some(([id]) => id === 'hsrp'),
  },
  {
    text: 'TOR-01 업링크 묶음 보기 (TOR-01에서)',
    cmd: 'show etherchannel summary',
    why: 'Po1(SU) = 묶음이 일하는 중, 멤버 두 포트가 다 (P)면 두 줄 다 묶여서 일하는 중이에요.',
    done: (w, c) => checked(w, c).some(([id]) => id === 'lacp'),
  },
  {
    text: 'FMS에서 전원 A/B 보기',
    why: '관제 화면(NOC)의 FMS 탭이에요. PDU A·B 두 줄이 다 들어오는지 봐요. 장비 하나하나의 전원 줄은 NMS에서 장비를 누르면 보여요.',
    done: (w, c) => checked(w, c).some(([id]) => id === 'psu'),
  },
];

/** `pods` was run once (at least) two enroll pods existed (not an earlier look at an empty list), and they are Running. */
function podsSeen(w: World, c: PlayContext): boolean {
  const ready = w.k8s ? readyPods(w.k8s, 'enroll') : [];
  const at = c.eventTimes['k8s_get_pods'];
  if (ready.length < 2 || at === undefined) return false;
  const born = ready.map((p) => p.born).sort((a, b) => a - b);
  return at >= born[1];
}

function health(w: World): Health {
  if (!w.k8s) return emptyHealth(w);
  const path = studentDelivery(w);
  const k = k8sHealth(w);
  const campus = campusDelivery(w);
  const ok = path.ok * k.availability;
  const services: Record<string, Status> = { 수강신청: status(ok), ...k.services, '캠퍼스 인터넷': status(campus.ok) };
  const notes = [...path.notes, ...k.notes, ...campus.notes];
  return emptyHealth(w, { availability: ok, errorRate: 1 - ok, latencyMs: ok === 0 ? 0 : k.latencyMs, services, notes });
}

export const day4: DaySpec = {
  id: 4,
  label: 'D-1',
  date: '02-09',
  clock: WEEKDAY_CLOCK,
  fixed: [
    { template: 'd1-heat', trigger: { type: 'gate', objectives: ['hsrp'] } },
    { template: 'd1-fire', trigger: { type: 'gate', objectives: ['checklist'] } },
  ],
  extras: [0, 1],
  mapSwitch: 'TOR-01',
  mapDevices: ['web', 'web2', 'db', 'srv-new', 'srv-db', 'n1', 'n2'],
  title: '점검 · 이중화',
  subtitle: 'k8s · HSRP · 화재 훈련',
  topics: ['Cluster · Node · Pod', '원하는 상태와 Self-healing', 'HSRP 이중화(Active / Standby)', '냉각과 drain', '이중화는 직접 꺼 봐야 안다'],
  intro: [
    { who: 'boss', text: 'D-1! 내일이 수강신청이다. 오늘은 리허설이야. 하루 종일 1초에 1,500건씩 요청을 넣어 보면서 버티는지 본다.' },
    { who: 'mentor', text: '오늘부터 신청 앱은 쿠버네티스가 돌려. 서버 여러 대를 한 팀으로 묶어 앱을 돌봐 주는 프로그램이야. 그 서버 하나하나가 노드고, 우리 노드는 K8S-01~04, 터미널에선 n1~n4야.' },
    { who: 'mentor', text: '노드 위에서 신청 앱이 실제로 도는 단위가 pod야. pod가 2개면 앱이 두 개 도는 거지. 우리는 "pod 몇 개, 어떤 버전"이라는 원하는 상태만 적으면 돼. 지금은 0개라 사이트가 안 열려. 설계 보드부터!' },
    { who: 'mentor', text: 'D-4에 만든 게이트웨이 기억나? 서버들이 다른 VLAN으로 갈 때 거치는 문, .1 말이야. 그때는 CORE-01 혼자 맡아서 Standby가 unknown이었지.' },
    { who: 'mentor', text: '그사이 선배가 DB용 VLAN 20 같은 다른 VLAN에는 CORE-02를 짝으로 붙여 뒀어. 아직 혼자인 건 WEB용 10과 K8S용 40이야. 오늘 이 둘에 CORE-02를 붙이자.' },
    { who: 'boss', text: '마지막으로 이중화 점검표. 둘씩 있다고 끝이 아니야. 퇴근 전에 하나씩 눈으로 확인해.' },
    { who: 'lion', text: '원하는 상태 쓰고, 짝 붙이고, 점검표까지! 내일을 위해!', mood: 'happy' },
  ],
  outro: [
    { who: 'mentor', text: '쿠버네티스는 pod를 다른 노드에 다시 띄워 주지만, 방을 식혀 주진 못해. 그건 시설팀이랑 같이 하는 일이야.' },
    { who: 'mentor', text: '그리고 오늘의 진짜 교훈. 스위치 사이 trunk에서 VLAN 하나가 빠진 작은 설정이 숨은 단일 장애점이었어. 점검표가 다 초록이어도, 이중화가 진짜인지는 하나를 직접 꺼 봐야 알아.' },
    { who: 'boss', text: '내일 아침 9시 50분 집합. 10시 정각에 수강신청 문 연다. 오늘 고생했어!' },
  ],
  recap: {
    built: [
      'D-5: 서버들을 랙에 설치하고, 전원 두 줄(A/B)과 케이블을 꽂았어요. 랙마다 맨 위 스위치(TOR-01·TOR-02)가 그 랙 서버들을 묶어요.',
      'D-4: VLAN(10 WEB · 20 DB · 40 K8S · 50 INFRA)과 코어 CORE-01의 게이트웨이를 만들었어요. 주소는 10.10.<VLAN>.x: 게이트웨이(가상 주소) = .1, CORE-01 자기 주소 = .2. 그때는 CORE-01 혼자라 show standby brief 에 짝(Standby)이 unknown이었어요.',
      'D-4: 장비 설정은 관리 PC에서 ssh로 들어가 enable → configure terminal → … → end → write memory(저장) 순서로 바꿔요.',
      'D-3: 학생 요청은 L4(대표 주소 하나로 받아 서버들에 나눠 주는 장비)를 거쳐 앱으로 가고, 관제 화면(NOC)의 NMS·SMS·FMS로 지켜봐요.',
      'D-2: 앱을 컨테이너 이미지로 포장해 레지스트리에 올렸고, TOR-01 → CORE-01 업링크 두 줄을 LACP로 묶었어요(Po1).',
      '랙 스위치와 코어 사이 업링크는 trunk예요: 여러 VLAN을 한 줄로 함께 실어 나르고, 포트마다 실어 나를 VLAN 목록이 정해져 있어요.',
    ],
    concepts: ['vlan', 'gateway', 'hsrp', 'ios', 'l4', 'container', 'lacp'],
  },
  objectives: [
    {
      id: 'desired',
      text: '관제실 설계 보드에서 신청 서비스(enroll)의 "원하는 상태" 쓰기 (pod 2개 이상)',
      spot: 'board',
      done: (w) => (w.k8s?.deployments.enroll.replicas ?? 0) >= 2,
      concept: 'pod',
      alsoConcepts: ['rollback'],
      why: '쿠버네티스에는 "신청 앱(enroll)을 이 버전으로 몇 벌 돌려라" 하는 원하는 상태(Deployment)만 적어요. 그러면 노드들 위에 그만큼 pod를 띄우고, 하나가 죽어도 다시 띄워 개수를 지켜요. pod 하나가 1초에 1000건쯤 처리하니 오늘 리허설(1,500 rps)엔 2개 이상, 버전은 :v1 같은 번호표(태그)로 골라야 문제가 생겼을 때 이전 버전으로 되돌릴 수 있어요.',
      lesson: '노드(서버) 4대를 한 팀으로 묶은 게 클러스터, 그 위에서 앱이 실제로 도는 가장 작은 단위가 pod예요. 우리는 개수와 버전만 적었어요.',
    },
    {
      id: 'observe',
      text: '관리 PC 터미널에서 pods 로 신청 pod가 Running인지 확인하기',
      spot: 'desk',
      done: podsSeen,
      after: ['desired'],
      concept: 'selfHealing',
      alsoConcepts: ['service'],
      steps: OBSERVE_STEPS,
      why: 'pods 는 지금 떠 있는 pod 목록이에요. STATUS가 Running이면 일하는 중이고, 아직 준비 중이면 잠시 뒤 다시 쳐 봐요.',
      lesson: '적어 둔 개수만큼 pod가 떴어요. 쿠버네티스는 원하는 상태와 실제 상태를 계속 비교해서 맞춰요. pod가 죽으면 사람이 손대기 전에 새 pod를 띄워요(Self-healing).',
    },
    {
      id: 'hsrp',
      text: 'CORE-02에 VLAN 10·40 게이트웨이 짝 세우고 저장하기 (자기 주소 .3 · standby 1 ip .1 · priority 100 · preempt)',
      spot: 'desk',
      done: (w) => standbyDone(w) && nd(w, 'CORE-02')?.dirty === false,
      progress: (w) => `${standbys(w).length}/${STANDBY_VLANS.length}`,
      after: ['observe'],
      concept: 'hsrp',
      why: 'HSRP는 코어 스위치 두 대가 가상 게이트웨이 주소(.1) 하나를 함께 맡는 설정이에요. 평소엔 우선순위가 높은 CORE-01이 Active로 일하고, CORE-01이 멈추면 Standby인 CORE-02가 바로 이어받아서 서버들은 문이 바뀐 줄도 몰라요. 지금 WEB(10)·K8S(40)는 CORE-01 혼자라, 오늘 CORE-02를 그 짝으로 세워요.',
      steps: HSRP_STEPS,
      lesson: '이제 가상 게이트웨이(.1)를 두 코어가 같이 맡아요. 평소엔 우선순위가 높은 CORE-01(110)이 Active, CORE-02(100)는 Standby. preempt는 "내 우선순위가 더 높으면 Active를 되찾기"라서, 돌아오는 CORE-01에 켜져 있어야(show standby brief 의 P) 의미가 있어요. CORE-02에도 똑같이 켜 두면 나중에 우선순위를 바꿔도 짝이 같은 규칙으로 움직여요.',
    },
    {
      id: 'uncordon',
      text: '냉각이 돌아오면 비웠던 노드를 다시 열기 (nodes 로 확인 → uncordon)',
      spot: 'desk',
      done: (w) => {
        const ok = !!w.k8s && Object.values(w.k8s.nodes).every((n) => n.ready && !n.cordoned);
        // The checklist opens now: only looks from here on count for it.
        if (ok && w.flags[CHECKLIST_AT] === undefined) w.flags[CHECKLIST_AT] = w.t;
        return ok;
      },
      after: ['hsrp'],
      afterIncidents: ['d1-heat:0'],
      concept: 'drain',
      why: 'drain 한 노드에는 "점검 중" 팻말(cordon)이 걸려 있어서, 냉각이 돌아와 노드가 다시 Ready가 돼도 새 pod를 받지 않아요. 노드가 Ready로 돌아온 걸 확인하고 팻말을 떼야(uncordon) 다시 일을 나눠 받아요.',
      steps: UNCORDON_STEPS,
      lesson: 'drain은 노드에 "점검 중" 팻말을 거는 일이에요. 새 pod를 막고, 남아 있던 pod는 다른 노드에 새로 띄워요. 노드가 다시 Ready가 돼도 팻말은 그대로라, 점검이 끝나면 uncordon으로 떼야 다시 일을 받아요.',
    },
    {
      id: 'checklist',
      text: '이중화 점검표: 코어 HSRP(show standby brief) · TOR-01 묶음(show etherchannel summary) · FMS 전원 A/B',
      spot: 'desk',
      done: (w, c) => checked(w, c).length === CHECKS.length,
      progress: (w, c) => `${checked(w, c).length}/${CHECKS.length}`,
      after: ['uncordon'],
      concept: 'spof',
      why: '이중화는 같은 일을 하는 것을 둘씩 두어, 하나가 고장 나도 나머지가 이어받게 하는 거예요. 이 점검표는 오늘 데이터센터의 세 쌍, 게이트웨이 짝(HSRP)·업링크 두 줄(LACP 묶음)·전원 두 줄(A/B)이 지금 정말 둘 다 살아 있는지 눈으로 보는 일이에요. 점검표가 열린 뒤에 본 것만 쳐요. 짝끼리는 네트워크실의 서로 다른 랙에 나눠 두었어요: 1번 랙에 CORE-01·FW-01·L4-01, 2번 랙에 CORE-02·FW-02·L4-02.',
      steps: CHECKLIST_STEPS,
      lesson: '게이트웨이 둘(HSRP), 업링크 두 줄(LACP), 전원 두 줄(A/B). 점검표로는 "둘 다 있다"까지 확인했어요. 하지만 "하나가 죽어도 된다"는 다른 얘기예요.',
    },
  ],
  interactions: {
    ...BASE_INTERACTIONS,
    rack1: { kind: 'consolePick', hosts: ['TOR-01', 'web', 'db'] },
    rack2: { kind: 'consolePick', hosts: ['n1', 'n2', 'srv-new', 'srv-db'] },
    rack3: { kind: 'consolePick', hosts: ['TOR-02', 'n3', 'n4'] },
    rack4: { kind: 'consolePick', hosts: ['ns1', 'dhcp01'] },
    switch: { kind: 'cable', mode: 'repair' },
    router: { kind: 'consolePick', hosts: ['CORE-01', 'CORE-02'] },
    patch: {
      kind: 'inspect',
      text: '패치 패널: 랙 스위치(TOR-01·02)와 코어 두 대를 잇는 케이블이 모이는 곳. 랙 스위치마다 코어 두 대로 각각 길이 나 있어요. 이 길들은 trunk(여러 VLAN을 한 줄로 함께 실어 나르는 포트)라서, 포트마다 실어 나를 VLAN 목록이 정해져 있어요. 네트워크실 1번 랙에는 CORE-01·BR-01·FW-01·L4-01이, 2번 랙에는 그 짝인 CORE-02·BR-02·FW-02·L4-02가 있어요. 케이블 검사·교체는 바로 위 TOR 배선판(E · 케이블 점검)에서 해요.',
    },
    board: { kind: 'board', board: 'desired' },
  },
  health,
  panels: ['traffic', 'services', 'links', 'temp', 'pods'],
  /**
   * What D-1 builds or fixes, taken back out: CORE-02's VLAN 10/40 gateways (the other CORE-02 SVIs are
   * 선배's), the K8S VLAN on TOR-02's uplink to CORE-02 (fixed during today's fire), and the cluster.
   */
  unbuild: (w) => {
    const c2 = nd(w, 'CORE-02');
    if (c2) for (const v of STANDBY_VLANS) delete c2.svis[v];
    resave(w.devices['CORE-02']);
    const f = nd(w, SPOF.tor)?.ifs[SPOF.port];
    if (f && Array.isArray(f.allowed)) f.allowed = f.allowed.filter((v) => v !== SPOF.vlan);
    resave(w.devices[SPOF.tor]);
    delete w.k8s;
  },
  /** Facilities bring a rack's power back once its restore time (set when the fire is put out) has come. */
  onTick: (w) => {
    const p = w.power;
    if (!p?.racksDown?.length) return;
    for (const rack of p.racksDown) {
      const at = w.flags[`${RACK_RESTORE}${rack}`];
      if (typeof at === 'number' && w.t >= at) {
        p.racksDown = p.racksDown.filter((r) => r !== rack);
        delete w.flags[`${RACK_RESTORE}${rack}`];
      }
    }
  },
  /** The cluster with no enroll pods yet (the desired-state mission), and the rehearsal traffic. */
  setup: (w) => {
    w.k8s = k8sLayer({ n1: 'rack2', n2: 'rack2', n3: 'rack3', n4: 'rack3' }, { enrollReplicas: 0 });
    w.traffic.rps = REHEARSAL_RPS;
    w.traffic.noticeShare = 0;
  },
};
