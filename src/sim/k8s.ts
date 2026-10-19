import { cableAt } from './network';
import type { Deployment, K8sState, Pod, World } from './types';
import { own } from './util';

const PENDING_SECONDS = 2;

/** Port every app listens on; a COURSE_URL without a port means this one. */
export const APP_PORT = 8000;

export function podsOf(k: K8sState, app: string): Pod[] {
  return k.pods.filter((p) => p.app === app);
}

export function readyPods(k: K8sState, app: string): Pod[] {
  return podsOf(k, app).filter((p) => p.status === 'Running');
}

/** A pod the scheduler has not placed on any node yet (no node had room). It stays Pending. */
export const unscheduled = (p: Pod): boolean => p.node === '';

function pickNode(k: K8sState): string | null {
  const ready = Object.entries(k.nodes).filter(([, n]) => n.ready).map(([id]) => id);
  let best: string | null = null;
  let bestCount = Infinity;
  for (const id of ready) {
    const count = k.pods.filter((p) => p.node === id).length;
    if (count < k.maxPodsPerNode && count < bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

/** Place a waiting pod on the least busy Ready node. It gets its IP there and starts up. */
function schedule(k: K8sState, p: Pod): boolean {
  const node = pickNode(k);
  if (!node) return false;
  k.ipSeq += 1;
  p.node = node;
  p.ip = `10.244.${1 + (k.ipSeq % 4)}.${10 + k.ipSeq}`;
  p.pendingFor = PENDING_SECONDS;
  return true;
}

/** A brand-new pod object (new name; a new IP once it lands on a node). */
function newPod(k: K8sState, app: string, version: string): Pod {
  k.podSeq += 1;
  const suffix = (k.podSeq * 7919).toString(36).slice(-5).padStart(5, 'x');
  const p: Pod = {
    name: `${app}-${suffix}`,
    app,
    node: '',
    ip: '',
    version,
    status: 'Pending',
    pendingFor: PENDING_SECONDS,
    restarts: 0,
    born: k.clock ?? 0,
  };
  schedule(k, p);
  return p;
}

/**
 * Which pods to delete first when there are too many (like a ReplicaSet): pods with no node,
 * then pods that aren't Running yet, then (during a rollout) old-version pods, newest first.
 */
function deletionOrder(pods: Pod[], keepVersion: string | null): Pod[] {
  const rank = (p: Pod) => (unscheduled(p) ? 0 : p.status !== 'Running' ? 1 : keepVersion !== null && p.version !== keepVersion ? 2 : 3);
  return pods
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || b.i - a.i)
    .map((x) => x.p);
}

function remove(k: K8sState, gone: Pod[]): void {
  if (gone.length) k.pods = k.pods.filter((p) => !gone.includes(p));
}

/**
 * One rolling-update step (maxSurge 1, maxUnavailable 0): start one new-version pod, and retire an
 * old pod only after that new pod is Running. So capacity never dips, and a bad version spreads one
 * pod at a time. When the cluster is full, an old pod gives up its slot first (like maxUnavailable 1).
 */
function rollStep(k: K8sState, app: string, dep: Deployment): void {
  const target = dep.rolling!.target;
  // Old-version pods that never got a node serve nothing: drop them now (the refill makes new-version pods).
  remove(k, podsOf(k, app).filter((p) => p.version !== target && unscheduled(p)));
  const pods = podsOf(k, app);
  const old = deletionOrder(
    pods.filter((p) => p.version !== target),
    null,
  );
  // New pods starting up on a node are waited for; new pods with no node yet are waiting for room.
  const booting = pods.some((p) => p.version === target && p.status !== 'Running' && !unscheduled(p));
  const waiting = pods.find((p) => p.version === target && unscheduled(p));
  if (old.length === 0) {
    if (!booting) {
      dep.image = target;
      dep.rolling = null;
    }
    return;
  }
  if (booting) return; // wait until the new pod is ready
  let count = pods.length;
  if (count > dep.replicas) {
    remove(k, [old.shift()!]); // the surge pod is ready → one old pod can go
    count -= 1;
  }
  if (old.length === 0 || count !== dep.replicas) return; // missing pods are refilled below with the new version
  if (waiting) {
    // A new pod has no node because the cluster is full: an old pod that holds a slot makes way for it.
    // (Without this the rollout would wait forever on a pod that can never be placed.)
    if (!schedule(k, waiting)) {
      const holder = old.find((p) => !unscheduled(p));
      if (holder) {
        remove(k, [holder]);
        schedule(k, waiting);
      }
    }
    return;
  }
  if (pickNode(k)) k.pods.push(newPod(k, app, target));
  else remove(k, [old[0]]); // no room for an extra pod: free a slot instead, the refill below takes it
}

/** Node health: its rack uplink cable must work and the rack must not be overheating. */
export function updateNodes(w: World): void {
  const k = w.k8s;
  if (!k) return;
  // The cluster keeps the world clock (runs once per step, right before reconcile) so pods know their AGE.
  k.clock = w.t;
  for (const n of Object.values(k.nodes)) {
    const temp = w.cooling?.temps[n.rack] ?? 24;
    const uplinkOk = n.uplink ? !(cableAt(w, n.uplink)?.broken ?? false) : true;
    if (n.ready && (temp >= 45 || !uplinkOk)) n.ready = false;
    else if (!n.ready && temp < 35 && uplinkOk) n.ready = true;
  }
}

/** One reconcile pass: make the actual pods match each deployment's desired state. */
export function reconcile(k: K8sState): void {
  // Pods on broken nodes are gone. Pods still waiting for a node stay in the queue.
  k.pods = k.pods.filter((p) => unscheduled(p) || k.nodes[p.node]?.ready);

  for (const p of k.pods) {
    if (unscheduled(p)) continue; // nothing starts until the pod has a node
    if (p.status === 'Pending' || p.status === 'CrashLoopBackOff') {
      p.pendingFor -= 1;
      if (p.pendingFor <= 0) {
        // The kubelet restarts crashed containers by itself.
        if (p.status === 'CrashLoopBackOff') p.restarts += 1;
        p.status = 'Running';
      }
    }
  }

  // Scheduler: waiting pods (oldest first) take any node that has room again.
  for (const p of k.pods) if (unscheduled(p) && !schedule(k, p)) break;

  for (const [app, dep] of Object.entries(k.deployments)) {
    if (dep.rolling) rollStep(k, app, dep);
    const version = dep.rolling?.target ?? dep.image;
    const pods = podsOf(k, app);
    // A rollout may run one extra pod (the surge pod).
    const limit = dep.replicas + (dep.rolling ? 1 : 0);
    if (pods.length < dep.replicas) {
      // Always create the pod object; with no room anywhere it waits as Pending (NODE <none>).
      for (let i = pods.length; i < dep.replicas; i++) k.pods.push(newPod(k, app, version));
    } else if (pods.length > limit) {
      remove(k, deletionOrder(pods, dep.rolling ? version : null).slice(0, pods.length - limit));
    }
  }
}

/**
 * Start a rolling update to a new image version. Compares against the version the deployment is
 * heading to, so changing the image mid-rollout (even back to the running one) retargets it.
 * Returns false when nothing changes.
 */
export function setImage(k: K8sState, app: string, image: string): boolean {
  const dep = own(k.deployments, app);
  if (!dep) return false;
  const current = dep.rolling?.target ?? dep.image;
  if (current === image) return false;
  dep.history.push(current); // the abandoned target stays a revision, like kubectl
  dep.rolling = { target: image };
  return true;
}

/** Roll back to the previous version. */
export function rollback(k: K8sState, app: string): string | null {
  const dep = own(k.deployments, app);
  if (!dep) return null;
  const prev = dep.history.pop();
  if (!prev) return null;
  dep.rolling = { target: prev };
  return prev;
}

/**
 * Split an address the way an HTTP client would: "http://course-svc:8000/x" → course-svc, 8000.
 * No port means the app port. Cluster DNS suffixes ("course-svc.default.svc.cluster.local") are dropped.
 */
export function parseEndpoint(url: string): { host: string; port: number } {
  const bare = url.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  // host[:port] must be followed by a path or nothing: "course-svc:8000:8000" is not an address.
  const m = bare.match(/^([^/:?#]*)(?::(\d+))?(?=[/?#]|$)/);
  if (!m) return { host: bare.toLowerCase(), port: APP_PORT };
  let host = m[1].toLowerCase();
  const dns = host.match(/^([a-z0-9-]+)\.default(\.svc(\.cluster\.local)?)?$/);
  if (dns) host = dns[1];
  return { host, port: m?.[2] ? Number(m[2]) : APP_PORT };
}

/** The Service an address names, if any. */
export function serviceAt(k: K8sState, url: string): { selector: string } | undefined {
  return own(k.services, parseEndpoint(url).host);
}

/** Does `url` (a Service name or a pod IP, optionally with http:// and :port) currently reach a running pod of `app`? */
export function endpointReaches(k: K8sState, url: string, app: string): boolean {
  const { host, port } = parseEndpoint(url);
  if (port !== APP_PORT) return false;
  const svc = own(k.services, host);
  if (svc) return svc.selector === app && readyPods(k, app).length > 0;
  return readyPods(k, app).some((p) => p.ip === host);
}

/** kubectl-style AGE: 45s, 12m, 3h. */
export function podAge(p: Pod, now: number): string {
  const s = Math.max(0, Math.floor(now - p.born));
  if (s < 120) return `${s}s`;
  if (s < 2 * 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}
