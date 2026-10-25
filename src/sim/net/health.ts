// End-to-end measures the days build their health and incident checks from. WP1 owns this file.
import type { World } from '../types';

export interface PathReport {
  /** Share of requests that get through, 0..1 */
  ok: number;
  /** Symptom notes in plain Korean for the SMS / dashboard (never the cause) */
  notes: string[];
}

/**
 * Students on the internet → 수강신청: public VIP → firewall → L4 (active unit) → a healthy pool member
 * that is listening, with link loads and degraded cables priced in.
 */
export function studentDelivery(_w: World): PathReport {
  // TODO(WP1)
  return { ok: 1, notes: [] };
}

/** Campus client groups: share that got a DHCP address and can reach the internet. */
export function campusDelivery(_w: World): PathReport {
  // TODO(WP1)
  return { ok: 1, notes: [] };
}

/** One host → another by name (DNS included), e.g. web → db. */
export function hostDelivery(_w: World, _from: string, _to: string): PathReport {
  // TODO(WP1)
  return { ok: 1, notes: [] };
}
