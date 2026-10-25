import { tickApp } from './app';
import { reconcile, updateNodes } from './k8s';
import { powered } from './net/basics';
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
    updateNodes(w);
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
