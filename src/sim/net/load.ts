// Traffic on links: student flows (internet → L4 VIP → members), macro bots, campus users.
// Each flow that `reach`es adds its Mbps to every logical link it crosses. WP1 owns this file.
import type { NetState, World } from '../types';
import { own } from '../util';
import { addressOf } from './basics';
import { reach, reachFromClients, STUDENT_IP } from './reach';
import { lbShares, lbView } from './services';
import { allVlans, stpView, vlanGraph } from './stp';
import { linkByKey, logicalLinks, withNetMemo } from './topo';

/** Megabits per second of traffic per request per second (a 수강신청 page with its assets ≈ 200 KB). */
export const MBPS_PER_RPS = 1.6;
/** Campus users browsing (portal, mail): light pages. */
export const CAMPUS_MBPS_PER_RPS = 0.2;
/** A storming VLAN fills every link it crosses to this multiple of the link's capacity. */
export const STORM_LOAD = 1.5;
/** Share of frames a degraded cable loses. */
export const DEGRADED_LOSS = 0.2;

/** First address of a CIDR ('198.51.100.77/32' → '198.51.100.77'): where a macro source's traffic comes from. */
export const cidrSource = (cidr: string): string => cidr.split('/')[0];

/** Offered load on every logical link (Mbps) and its capacity. */
export function computeLoad(w: World): NetState['load'] {
  return withNetMemo(w, () => {
    const load: NetState['load'] = {};
    // Links between network devices (and the ISP links) only: server NICs are not a capacity limit here
    // (the server side's limit is the app's: pods × POD_RPS).
    const gearEnd = (dev: string) => !!own(w.devices, dev)?.nd || own(w.devices, dev)?.kind === 'internet';
    for (const l of logicalLinks(w)) if (gearEnd(l.a.dev) && gearEnd(l.b.dev)) load[l.key] = { mbps: 0, cap: l.capMbps };
    const add = (links: string[], mbps: number) => {
      for (const k of new Set(links)) if (load[k]) load[k].mbps += mbps;
    };
    const lb = w.net?.lb;
    // Students and macro bots: internet → firewall → a core → the active L4 → the pool members.
    const inbound = (src: string, mbps: number) => {
      if (!lb || mbps <= 0) return;
      const r = reach(w, 'internet', lb.publicIp, { srcIp: src, port: lb.port });
      if (r.failure === 'fw_deny') add(r.links, mbps); // dropped at the firewall: the links up to it still carry it
      if (!r.ok) return;
      // Each request crosses the inbound path and one member's path once (the one-armed L4's link is
      // crossed in and out, but in opposite directions of a full-duplex link: counted once).
      const view = lbView(w);
      let served = 0;
      for (const { member, share } of lbShares(w, view)) {
        const ip = addressOf(w, member.host).ip;
        const m = ip && view.active ? reach(w, view.active, ip, { port: member.port }) : null;
        if (!m?.ok) continue;
        add([...r.links, ...m.links], mbps * share);
        served += share;
      }
      if (served < 1) add(r.links, mbps * (1 - served));
    };
    inbound(STUDENT_IP, w.traffic.rps * MBPS_PER_RPS);
    for (const s of w.traffic.sources ?? []) {
      if (s.kind === 'macro') inbound(cidrSource(s.cidr), s.rps * MBPS_PER_RPS);
      else if (own(w.net?.clients, s.cidr)) {
        const r = reachFromClients(w, s.cidr);
        if (r.ok || r.failure === 'fw_deny') add(r.links, s.rps * CAMPUS_MBPS_PER_RPS);
      }
    }
    // A broadcast storm fills every link of the looping VLAN.
    for (const v of allVlans(w)) {
      if (!stpView(w, v).storm) continue;
      for (const hops of vlanGraph(w, v).adj.values()) {
        for (const h of hops) {
          const l = load[h.link.key];
          if (l) l.mbps = Math.max(l.mbps, l.cap * STORM_LOAD);
        }
      }
    }
    return load;
  });
}

/**
 * Share of traffic that gets through these links: Π min(1, cap/load) over the links, and each degraded
 * cable loses 20% (a port-channel loses 20% × degraded members / members).
 */
export function delivery(w: World, links: string[]): number {
  return withNetMemo(w, () => {
    let d = 1;
    for (const k of new Set(links)) {
      const l = w.net?.load[k];
      if (l && l.mbps > 0) d *= Math.min(1, l.cap / l.mbps);
      const ll = linkByKey(w, k);
      if (ll?.cables.length) {
        const bad = ll.cables.filter((id) => own(w.cables, id)?.degraded).length;
        d *= 1 - (DEGRADED_LOSS * bad) / ll.cables.length;
      }
    }
    return d;
  });
}

/** Utilization 0..∞ of one logical link (load / capacity). */
export function utilization(w: World, key: string): number {
  const l = w.net?.load[key];
  return l && l.cap > 0 ? l.mbps / l.cap : 0;
}
