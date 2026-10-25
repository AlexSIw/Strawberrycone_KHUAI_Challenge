import { tickApp } from './app';
import { reconcile, updateNodes } from './k8s';
import { powered } from './net/basics';
import { nodeOnline } from './net/reach';
import { withNetMemo } from './net/topo';
import { syncNet } from './net/sync';
import type { World } from './types';

export const clone = (w: World): World => structuredClone(w);

function tickCooling(w: World, dt: number): void {
  const c = w.cooling;
  if (!c) return;
  for (const rack of Object.keys(c.temps)) {
    const cooled = c.cracOk || !c.cracRacks.includes(rack);
    const t = c.temps[rack];
    c.temps[rack] = cooled ? Math.max(24, t - 2 * dt) : Math.min(60, t + 1.5 * dt);
  }
}

/** Advance the world by dt seconds. Pure: returns a new world. */
export function step(prev: World, dt = 1): World {
  const w = clone(prev);
  w.t += dt;
  tickCooling(w, dt);
  if (w.k8s) {
    // A node is online when it has power, its NIC is up at the TOR and (with a network) it reaches its gateway.
    // (One memo scope for all nodes: readiness changes don't touch the network views.)
    withNetMemo(w, () => updateNodes(w, (id) => nodeOnline(w, id)));
    reconcile(w.k8s);
  }
  tickApp(w, dt);
  // Last: links, HSRP, STP, load and syslog follow from everything above.
  if (w.net) syncNet(w, dt);
  return w;
}

export function powerKw(w: World): number {
  return Object.values(w.devices).filter((d) => d.kind !== 'internet' && powered(w, d.id)).length * 0.45;
}
