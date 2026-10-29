import { powerKw } from '../sim/step';
import type { Health, World } from '../sim/types';

/** Health with nothing wrong; days pass what they measure in `extra`. */
export function emptyHealth(w: World, extra: Partial<Health> = {}): Health {
  return {
    availability: 1,
    latencyMs: 20,
    errorRate: 0,
    rps: w.traffic.rps,
    maxTemp: Math.max(24, ...Object.values(w.cooling?.temps ?? {})),
    powerKw: powerKw(w),
    services: {},
    notes: [],
    ...extra,
  };
}
