// Traffic on links: student flows (internet → L4 VIP → members), macro bots, campus users.
// Each flow that `reach`es adds its Mbps to every logical link it crosses. WP1 owns this file.
import type { NetState, World } from '../types';

/** Megabits per second of traffic per request per second (a 수강신청 page with its assets ≈ 200 KB). */
export const MBPS_PER_RPS = 1.6;

export function computeLoad(_w: World): NetState['load'] {
  // TODO(WP1)
  return {};
}

/** Share of traffic that gets through these links: Π min(1, cap/load) × 0.8 per degraded cable. */
export function delivery(w: World, links: string[]): number {
  let d = 1;
  for (const k of links) {
    const l = w.net?.load[k];
    if (l && l.mbps > 0) d *= Math.min(1, l.cap / l.mbps);
  }
  return d;
}

/** Utilization 0..∞ of one logical link (load / capacity). */
export function utilization(w: World, key: string): number {
  const l = w.net?.load[key];
  return l && l.cap > 0 ? l.mbps / l.cap : 0;
}
