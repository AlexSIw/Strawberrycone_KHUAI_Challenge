// D-1: 점검 · 이중화 (v1 stage 6 + HSRP). The app moves onto the Kubernetes cluster (desired state on the
// board, then look at the pods), CORE-02 joins the VLAN 10/40 gateways as HSRP standby, and the
// redundancy checklist (show standby brief, show etherchannel summary, PSU A/B in the FMS).
// Teaching incidents: the CRAC stops (drain the hot nodes, tell facilities); fire in network rack 1
// (HSRP fails over to CORE-02, and a trunk missing the K8S VLAN cuts K8S-03/04 off).
import { snapshot } from '../../sim/ios/config';
import { readyPods } from '../../sim/k8s';
import { campusDelivery, studentDelivery, sviUp } from '../../sim/network';
import type { Device, Health, PlayContext, World } from '../../sim/types';
import { k8sHealth, k8sLayer } from '../k8sWorld';
import { ADDR } from '../topology';
import type { DaySpec } from '../types';
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
  extras: [1, 2],
  mapSwitch: 'TOR-01',
  mapDevices: ['web', 'web2', 'db', 'srv-new', 'srv-db', 'n1', 'n2'],
  title: '점검 · 이중화',
  subtitle: 'k8s · HSRP · 화재 훈련',
  topics: ['Cluster · Node · Pod', '원하는 상태와 Self-healing', 'HSRP 이중화(Active / Standby)', '냉각과 drain', '이중화는 직접 꺼 봐야 안다'],
  intro: [
    { who: 'boss', text: 'D-1! 내일이 수강신청이다. 오늘은 리허설: 학생 접속을 하루 종일 1초에 1,500건(1,500 rps) 흘려 볼 거야.' },
    { who: 'mentor', text: '오늘부터 신청 앱은 쿠버네티스(서버 여러 대를 대신 돌봐 주는 관리 프로그램)가 K8S-01~04(노드: 일하는 서버 n1~n4) 위에서 돌려. 우리는 "원하는 상태"만 적으면 돼. 지금은 신청 pod(앱이 실제로 도는 가장 작은 단위)가 0개라 사이트가 안 열려. 설계 보드부터!' },
    { who: 'mentor', text: 'D-4에 만든 게이트웨이 기억나? 그때는 CORE-01 혼자 맡아서 Standby가 unknown이었지. 그사이 선배가 DB(20) 같은 다른 VLAN은 CORE-02에 짝을 세워 뒀는데, WEB(10)·K8S(40) 두 개는 아직 CORE-01 혼자야. 오늘 우리가 CORE-02에 세우자.' },
    { who: 'boss', text: '마지막으로 이중화 점검표. 둘씩 있다고 끝이 아니야. 퇴근 전에 하나씩 눈으로 확인해.' },
    { who: 'lion', text: '원하는 상태 쓰고, 짝 세우고, 점검표! 내일을 위해!', mood: 'happy' },
  ],
  outro: [
    { who: 'mentor', text: '쿠버네티스는 pod를 다른 노드에 다시 띄워 주지만, 방을 식혀 주진 못해. 그건 시설팀이랑 같이 하는 일이야.' },
    { who: 'mentor', text: '그리고 오늘의 진짜 교훈. trunk에 VLAN 하나 빠진 게 숨은 단일 장애점이었어. 점검표가 다 초록이어도, 이중화는 하나를 꺼 봐야 진짜인지 알아.' },
    { who: 'boss', text: '내일 아침 9시 50분 집합. 10시 정각에 수강신청 문 연다. 오늘 고생했어!' },
  ],
  objectives: [
    {
      id: 'desired',
      text: '관제실 설계 보드에서 신청 서비스(enroll)의 "원하는 상태" 쓰기 (pod 2개 이상)',
      spot: 'board',
      done: (w) => (w.k8s?.deployments.enroll.replicas ?? 0) >= 2,
      concept: 'pod',
      lesson: '노드(서버) 4대를 한 팀으로 묶은 게 클러스터, 그 위에서 앱이 실제로 도는 가장 작은 단위가 pod예요. 우리는 개수와 버전만 적었어요.',
    },
    {
      id: 'observe',
      text: '관리 PC 터미널에서 pods 로 신청 pod가 Running인지 확인하기',
      spot: 'desk',
      done: podsSeen,
      after: ['desired'],
      concept: 'selfHealing',
      lesson: '적어 둔 개수만큼 pod가 떴어요. 쿠버네티스는 원하는 상태와 실제 상태를 계속 비교해서 맞춰요. pod가 죽으면 사람이 손대기 전에 새 pod를 띄워요(Self-healing).',
    },
    {
      id: 'hsrp',
      text: 'CORE-02에 VLAN 10·40 게이트웨이 짝 세우고 저장하기 (자기 주소 .3 · standby 1 ip .1 · priority 100 · preempt)',
      spot: 'desk',
      done: (w) => standbys(w).length === STANDBY_VLANS.length && nd(w, 'CORE-02')?.dirty === false,
      progress: (w) => `${standbys(w).length}/${STANDBY_VLANS.length}`,
      after: ['observe'],
      concept: 'hsrp',
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
    patch: { kind: 'inspect', text: '패치 패널: 랙 스위치(TOR-01·02)와 코어 두 대를 잇는 케이블이 모이는 곳. 랙 스위치마다 코어 두 대로 각각 길이 나 있어요.' },
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
  /** The cluster with no enroll pods yet (the desired-state mission), and the rehearsal traffic. */
  setup: (w) => {
    w.k8s = k8sLayer({ n1: 'rack2', n2: 'rack2', n3: 'rack3', n4: 'rack3' }, { enrollReplicas: 0 });
    w.traffic.rps = REHEARSAL_RPS;
    w.traffic.noticeShare = 0;
  },
};
