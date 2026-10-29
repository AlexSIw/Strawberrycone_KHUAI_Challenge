import { endpointReaches, readyPods, reconcile, serviceAt } from '../sim/k8s';
import type { Health, K8sState, World } from '../sim/types';
import { emptyHealth } from './worlds';

/** Requests per second one enroll pod can handle. */
export const POD_RPS = 1000;

/**
 * The Kubernetes cluster state for the given nodes (id → rack). Every pod starts already running —
 * for a few hours, so a freshly created pod stands out by its AGE.
 */
export function k8sLayer(nodes: Record<string, string>, opts: { enrollReplicas: number }): K8sState {
  const k: K8sState = {
    nodes: Object.fromEntries(Object.entries(nodes).map(([id, rack]) => [id, { ready: true, rack, uplink: `${id}:eth0` }])),
    deployments: {
      login: { replicas: 2, image: 'login:v1', history: [], env: {}, rolling: null },
      course: { replicas: 2, image: 'course:v1', history: [], env: {}, rolling: null },
      enroll: { replicas: opts.enrollReplicas, image: 'enroll:v1', history: [], env: { COURSE_URL: 'course-svc', DB_POOL: '20' }, rolling: null },
      notify: { replicas: 1, image: 'notify:v1', history: [], env: {}, rolling: null },
    },
    pods: [],
    services: {
      'login-svc': { selector: 'login' },
      'course-svc': { selector: 'course' },
      'enroll-svc': { selector: 'enroll' },
      'notify-svc': { selector: 'notify' },
    },
    podSeq: 0,
    ipSeq: 0,
    badVersions: ['enroll:v2'],
    maxPodsPerNode: 6,
    // Tags pushed to the registry; v2 is a buggy release.
    images: ['login:v1', 'course:v1', 'enroll:v1', 'enroll:v2', 'notify:v1'],
    clock: 0,
  };
  for (let i = 0; i < 4; i++) reconcile(k);
  for (const p of k.pods) p.born = -3 * 3600;
  return k;
}

/** The CRAC is fixed and the nodes it cools are back. Other racks' nodes are another incident's business. */
export function cracNodesBack(w: World): boolean {
  const c = w.cooling;
  if (!c?.cracOk) return false;
  return Object.values(w.k8s!.nodes)
    .filter((n) => c.cracRacks.includes(n.rack))
    .every((n) => n.ready);
}

export function k8sHealth(w: World): Health {
  const k = w.k8s!;
  const notes: string[] = [];
  const services: Record<string, 'up' | 'degraded' | 'down'> = {};
  for (const [name, d] of Object.entries(k.deployments)) {
    const ready = readyPods(k, name).length;
    // enroll with nothing running while students are waiting is "down", even if nobody asked for pods yet.
    const needed = d.replicas > 0 || (name === 'enroll' && w.traffic.rps > 0);
    services[name] = ready === 0 && needed ? 'down' : ready < d.replicas ? 'degraded' : 'up';
  }
  const enroll = readyPods(k, 'enroll');
  const cap = enroll.length * POD_RPS;
  const served = Math.min(1, cap / Math.max(1, w.traffic.rps));
  if (served < 1) notes.push(`신청 pod 부족: ${Math.round(served * 100)}%만 처리`);
  const courseUrl = k.deployments.enroll.env.COURSE_URL ?? '';
  const courseOk = endpointReaches(k, courseUrl, 'course');
  if (!courseOk) {
    notes.push('신청(enroll)이 과목조회(course)를 부르지 못함');
    services.enroll = 'down';
  } else if (!serviceAt(k, courseUrl)) {
    // Works right now, but only through one pod's IP: the next time that pod is replaced it breaks again.
    notes.push('신청(enroll)이 과목조회 pod 하나의 IP로 직접 연결 중 — 그 pod가 바뀌면 다시 끊겨요');
    if (services.enroll === 'up') services.enroll = 'degraded';
  }
  const bad = enroll.filter((p) => k.badVersions.includes(p.version)).length;
  const badShare = enroll.length ? bad / enroll.length : 0;
  if (bad) notes.push(`신청 pod ${bad}개가 500 에러(서버 안에서 처리 중 오류)를 냄`);
  const down = Object.entries(k.nodes).filter(([, n]) => !n.ready).map(([id]) => id);
  if (down.length) notes.push(`NotReady(일할 수 없는) 노드: ${down.join(', ')}`);
  const ok = served * (courseOk ? 1 : 0) * (1 - badShare * 0.6);
  // Near capacity is busier (180 ms) but still healthy; only real overload or a broken call path is slow.
  const latency = served < 1 || !courseOk ? 1600 : cap > 0 && w.traffic.rps / cap > 0.8 ? 180 : 45;
  return emptyHealth(w, { availability: ok, errorRate: 1 - ok, latencyMs: latency, services, notes });
}
