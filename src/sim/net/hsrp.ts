// SVIs and HSRP. WP1 owns this file.
import type { Device, World } from '../types';
import { own } from '../util';
import { ipToInt, powered } from './basics';
import { stpView } from './stp';
import { carries, memoGet, operState, withNetMemo } from './topo';

/** IOS autostate: the SVI is up when not shut, it has an address, the VLAN exists, and some port on the switch carries it, is up and isn't STP-blocked. */
export function sviUp(w: World, dev: string, vlan: number): boolean {
  return withNetMemo(w, () =>
    memoGet(w, `svi:${dev}:${vlan}`, () => {
      const nd = own(w.devices, dev)?.nd;
      const svi = nd?.svis[vlan];
      if (!nd || !svi || svi.shutdown || !svi.ip || !(vlan in nd.vlans) || !powered(w, dev)) return false;
      const stp = stpView(w, vlan);
      return Object.entries(nd.ifs).some(
        ([ifn, f]) => f.group === undefined && carries(w, { dev, ifn }, vlan) && operState(w, dev, ifn) === 'up' && !stp.blocked.has(`${dev}:${ifn}`),
      );
    }),
  );
}

const hsrpOf = (d: Device, vlan: number) => d.nd?.svis[vlan]?.hsrp;

/** Which core answers for the VLAN's virtual IP: highest priority (then higher IP) among cores with the SVI up; keeps `prev` unless the best one preempts. */
export function electHsrp(w: World, vlan: number, prev: string | null): string | null {
  return withNetMemo(w, () => {
    const cands = Object.values(w.devices).filter((d) => hsrpOf(d, vlan) && sviUp(w, d.id, vlan));
    if (!cands.length) return null;
    const ip = (d: Device) => ipToInt(d.nd!.svis[vlan].ip!);
    const best = [...cands].sort((a, b) => hsrpOf(b, vlan)!.priority - hsrpOf(a, vlan)!.priority || ip(b) - ip(a))[0];
    const keep = prev ? cands.find((d) => d.id === prev) : undefined;
    if (!keep) return best.id;
    const pb = hsrpOf(best, vlan)!;
    // Preempt takes over only with a strictly higher priority (equal priority never preempts).
    if (best.id !== keep.id && pb.preempt && pb.priority > hsrpOf(keep, vlan)!.priority) return best.id;
    return keep.id;
  });
}

/** The active HSRP router for the VLAN right now (what syncNet would elect from the cached previous winner). */
export function hsrpActiveFor(w: World, vlan: number): string | null {
  return electHsrp(w, vlan, w.net?.hsrpActive[vlan] ?? null);
}
