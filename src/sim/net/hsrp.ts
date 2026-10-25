// SVIs and HSRP. WP1 owns this file.
import type { World } from '../types';
import { own } from '../util';
import { powered } from './basics';

/** IOS autostate: the SVI is up when not shut, the VLAN exists, and some port on the switch carries it, is up and isn't STP-blocked. */
export function sviUp(w: World, dev: string, vlan: number): boolean {
  // TODO(WP1): port/STP check.
  const nd = own(w.devices, dev)?.nd;
  const svi = nd?.svis[vlan];
  return !!svi && !svi.shutdown && !!svi.ip && vlan in nd!.vlans && powered(w, dev);
}

/** Which core answers for the VLAN's virtual IP: highest priority (then higher IP) among cores with the SVI up; keeps `prev` unless the best one preempts. */
export function electHsrp(w: World, vlan: number, prev: string | null): string | null {
  // TODO(WP1): priority/preempt.
  const cands = Object.values(w.devices).filter((d) => d.nd?.svis[vlan]?.hsrp && sviUp(w, d.id, vlan));
  if (prev && cands.some((d) => d.id === prev)) return prev;
  return cands[0]?.id ?? null;
}
