import { cableAt } from './network';
import type { K8sState, Pod, World } from './types';

const PENDING_SECONDS = 2;

export function podsOf(k: K8sState, app: string): Pod[] {
  return k.pods.filter((p) => p.app === app);
}

export function readyPods(k: K8sState, app: string): Pod[] {
  return podsOf(k, app).filter((p) => p.status === 'Running');
}

function newPod(k: K8sState, app: string, node: string, version: string): Pod {
  k.podSeq += 1;
  k.ipSeq += 1;
  const suffix = (k.podSeq * 7919).toString(36).slice(-5).padStart(5, 'x');
  return {
    name: `${app}-${suffix}`,
    app,
    node,
    ip: `10.244.${1 + (k.ipSeq % 4)}.${10 + k.ipSeq}`,
    version,
    status: 'Pending',
    pendingFor: PENDING_SECONDS,
    restarts: 0,
  };
}

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

/** Node health: its rack uplink cable must work and the rack must not be overheating. */
export function updateNodes(w: World): void {
  const k = w.k8s;
  if (!k) return;
  for (const n of Object.values(k.nodes)) {
    const temp = w.cooling?.temps[n.rack] ?? 24;
    const uplinkOk = n.uplink ? !(cableAt(w, n.uplink)?.broken ?? false) : true;
    if (n.ready && (temp >= 45 || !uplinkOk)) n.ready = false;
    else if (!n.ready && temp < 35 && uplinkOk) n.ready = true;
  }
}

/** One reconcile pass: make the actual pods match each deployment's desired state. */
export function reconcile(k: K8sState): void {
  // Pods on broken nodes are gone.
  k.pods = k.pods.filter((p) => k.nodes[p.node]?.ready);

  for (const p of k.pods) {
    if (p.status === 'Pending' || p.status === 'CrashLoopBackOff') {
      p.pendingFor -= 1;
      if (p.pendingFor <= 0) {
        // The kubelet restarts crashed containers by itself.
        if (p.status === 'CrashLoopBackOff') p.restarts += 1;
        p.status = 'Running';
      }
    }
  }

  for (const [app, dep] of Object.entries(k.deployments)) {
    // Rolling update: swap one old pod per pass.
    if (dep.rolling) {
      const target = dep.rolling.target;
      const old = podsOf(k, app).find((p) => p.version !== target);
      if (old) {
        k.pods = k.pods.filter((p) => p !== old);
      } else if (podsOf(k, app).every((p) => p.status === 'Running')) {
        dep.image = target;
        dep.rolling = null;
      }
    }
    const version = dep.rolling?.target ?? dep.image;
    const pods = podsOf(k, app);
    if (pods.length < dep.replicas) {
      for (let i = pods.length; i < dep.replicas; i++) {
        const node = pickNode(k);
        if (!node) break;
        k.pods.push(newPod(k, app, node, version));
      }
    } else if (pods.length > dep.replicas) {
      const extra = pods.slice(dep.replicas);
      k.pods = k.pods.filter((p) => !extra.includes(p));
    }
  }
}

/** Start a rolling update to a new image version. */
export function setImage(k: K8sState, app: string, image: string): void {
  const dep = k.deployments[app];
  if (!dep || dep.image === image) return;
  dep.history.push(dep.image);
  dep.rolling = { target: image };
}

/** Roll back to the previous version. */
export function rollback(k: K8sState, app: string): string | null {
  const dep = k.deployments[app];
  if (!dep) return null;
  const prev = dep.history.pop();
  if (!prev) return null;
  dep.rolling = { target: prev };
  return prev;
}

/** Does `url` (a Service name or a pod IP) currently reach a running pod of `app`? */
export function endpointReaches(k: K8sState, url: string, app: string): boolean {
  const svc = k.services[url];
  if (svc) return svc.selector === app && readyPods(k, app).length > 0;
  return readyPods(k, app).some((p) => p.ip === url);
}
