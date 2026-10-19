import { tickApp } from './app';
import { reconcile, updateNodes } from './k8s';
import { applyDhcp, powered } from './network';
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
  applyDhcp(w);
  tickCooling(w, dt);
  if (w.k8s) {
    updateNodes(w);
    reconcile(w.k8s);
  }
  tickApp(w, dt);
  return w;
}

export function powerKw(w: World): number {
  return Object.values(w.devices).filter((d) => d.kind !== 'internet' && powered(w, d.id)).length * 0.45;
}
