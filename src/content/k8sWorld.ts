import { endpointReaches, readyPods, reconcile } from '../sim/k8s';
import type { Device, Health, World } from '../sim/types';
import { emptyHealth } from './worlds';

/** Requests per second one enroll pod can handle. */
export const POD_RPS = 1000;

const node = (id: string, rack: string): Device => ({ id, kind: 'server', label: `노드 ${id}`, rack, installed: true, feeds: ['A', 'B'], ports: ['eth0'] });

/** A small Kubernetes cluster: 4 nodes in 4 racks; racks 1–2 are cooled by the CRAC unit. */
export function k8sWorld(opts: { enrollReplicas: number }): World {
  const w: World = {
    t: 0,
    devices: {
      internet: { id: 'internet', kind: 'internet', label: '학생들 (인터넷)', installed: true, feeds: [], ports: ['wan'] },
      r1: { id: 'r1', kind: 'router', label: '라우터', installed: true, feeds: ['A', 'B'], ports: ['wan', 'lan'] },
      sw1: { id: 'sw1', kind: 'switch', label: '스위치', installed: true, feeds: ['A', 'B'], ports: ['p0', 'p1', 'p2', 'p3', 'p4', 'p9'] },
      ops: { id: 'ops', kind: 'server', label: '관리 PC', installed: true, feeds: ['A', 'B'], ports: ['eth0'] },
      n1: node('n1', 'rack1'),
      n2: node('n2', 'rack2'),
      n3: node('n3', 'rack3'),
      n4: node('n4', 'rack4'),
    },
    cables: {
      wan: { id: 'wan', a: 'internet:wan', b: 'r1:wan', broken: false },
      uplink: { id: 'uplink', a: 'r1:lan', b: 'sw1:p0', broken: false },
      c_n1: { id: 'c_n1', a: 'n1:eth0', b: 'sw1:p1', broken: false },
      c_n2: { id: 'c_n2', a: 'n2:eth0', b: 'sw1:p2', broken: false },
      c_n3: { id: 'c_n3', a: 'n3:eth0', b: 'sw1:p3', broken: false },
      c_n4: { id: 'c_n4', a: 'n4:eth0', b: 'sw1:p4', broken: false },
      c_ops: { id: 'c_ops', a: 'ops:eth0', b: 'sw1:p9', broken: false },
    },
    power: { mains: true, ups: true },
    k8s: {
      nodes: {
        n1: { ready: true, rack: 'rack1', uplink: 'n1:eth0' },
        n2: { ready: true, rack: 'rack2', uplink: 'n2:eth0' },
        n3: { ready: true, rack: 'rack3', uplink: 'n3:eth0' },
        n4: { ready: true, rack: 'rack4', uplink: 'n4:eth0' },
      },
      deployments: {
        login: { replicas: 2, image: 'login:v1', history: [], env: {}, rolling: null },
        course: { replicas: 2, image: 'course:v1', history: [], env: {}, rolling: null },
        enroll: { replicas: opts.enrollReplicas, image: 'enroll:v1', history: [], env: { COURSE_URL: 'course-svc' }, rolling: null },
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
    },
    cooling: { cracOk: true, temps: { rack1: 24, rack2: 24, rack3: 24, rack4: 24 }, cracRacks: ['rack1', 'rack2'] },
    traffic: { rps: 2500, noticeShare: 0 },
    flags: {},
  };
  // Start with every pod already running.
  for (let i = 0; i < 4; i++) reconcile(w.k8s!);
  return w;
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
  const courseOk = endpointReaches(k, k.deployments.enroll.env.COURSE_URL, 'course');
  if (!courseOk) {
    notes.push('신청(enroll)이 과목조회(course)를 부르지 못함');
    services.enroll = 'down';
  }
  const bad = enroll.filter((p) => k.badVersions.includes(p.version)).length;
  const badShare = enroll.length ? bad / enroll.length : 0;
  if (bad) notes.push(`신청 pod ${bad}개가 500 에러를 냄`);
  const down = Object.entries(k.nodes).filter(([, n]) => !n.ready).map(([id]) => id);
  if (down.length) notes.push(`NotReady 노드: ${down.join(', ')}`);
  const ok = served * (courseOk ? 1 : 0) * (1 - badShare * 0.6);
  const latency = served < 1 ? 1600 : cap > 0 && w.traffic.rps / cap > 0.8 ? 400 : 45;
  return emptyHealth(w, { availability: ok, errorRate: 1 - ok, latencyMs: latency, services, notes });
}
