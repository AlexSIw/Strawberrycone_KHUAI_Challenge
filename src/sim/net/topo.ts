// L1/L2 topology: interface state, who is plugged into whom, port-channels, VLAN membership.
// WP1 owns this file. Everything here is DERIVED from config + cables + power; nothing is cached.
import type { IfOper, World } from '../types';
import { own } from '../util';
import { cablePeer, powered } from './basics';

export interface Port {
  dev: string;
  ifn: string;
}

/** One logical link: a single cable, or a bundle of cables forming a port-channel (Po↔Po). */
export interface LLink {
  /** Stable key, e.g. 'CORE-01:Te1/0/3~TOR-01:Te1/1/1' or 'CORE-01:Po1~TOR-01:Po1' (endpoints sorted) */
  key: string;
  a: Port;
  b: Port;
  /** Cable ids carried by this link */
  cables: string[];
  kind: 'cable' | 'po';
  /** Sum of the speeds of the members that are up (Mbps) */
  capMbps: number;
  up: boolean;
}

/** Operational state: power → err-disabled → admin-down → cable/peer. Hosts' ports (no nd) are up when cabled to a live peer. */
export function operState(w: World, dev: string, ifn: string): IfOper {
  // TODO(WP1): port-channels (up iff a member is bundled), peer shutdown / err-disabled.
  const d = own(w.devices, dev);
  if (!d || !powered(w, dev)) return 'down';
  const f = d.nd?.ifs[ifn];
  if (f?.errDisabled) return 'err-disabled';
  if (f?.shutdown) return 'admin-down';
  const peer = cablePeer(w, dev, ifn);
  if (!peer) return 'down';
  const c = Object.values(w.cables).find((x) => x.a === `${dev}:${ifn}` || x.b === `${dev}:${ifn}`);
  if (!c || c.broken || !powered(w, peer[0])) return 'down';
  return 'up';
}

/** The port at the other end of the cable. */
export function peerOf(w: World, p: Port): Port | null {
  const peer = cablePeer(w, p.dev, p.ifn);
  return peer ? { dev: peer[0], ifn: peer[1] } : null;
}

/** Every logical link in the world (Po members folded into one link). */
export function logicalLinks(w: World): LLink[] {
  // TODO(WP1): fold Po members; one-sided members are suspended ('s') and excluded.
  return Object.values(w.cables).map((c) => {
    const [ad, ai] = [c.a.slice(0, c.a.indexOf(':')), c.a.slice(c.a.indexOf(':') + 1)];
    const [bd, bi] = [c.b.slice(0, c.b.indexOf(':')), c.b.slice(c.b.indexOf(':') + 1)];
    const up = operState(w, ad, ai) === 'up' && operState(w, bd, bi) === 'up';
    const speed = Math.min(own(w.devices, ad)?.nd?.ifs[ai]?.speed ?? 1000, own(w.devices, bd)?.nd?.ifs[bi]?.speed ?? 1000);
    const [x, y] = [c.a, c.b].sort();
    return { key: `${x}~${y}`, a: { dev: ad, ifn: ai }, b: { dev: bd, ifn: bi }, cables: [c.id], kind: 'cable' as const, capMbps: up ? speed : 0, up };
  });
}

/** `show etherchannel summary` view of Port-channel N on a device. Flags: P bundled, s suspended, D down, I stand-alone. */
export function poState(_w: World, _dev: string, _n: number): { up: boolean; members: { ifn: string; flag: 'P' | 's' | 'D' | 'I' }[] } {
  // TODO(WP1)
  return { up: false, members: [] };
}

/** Does this switch port carry `vlan`? access → accessVlan === vlan; trunk → allowed and the VLAN exists on that switch. */
export function carries(w: World, p: Port, vlan: number): boolean {
  // TODO(WP1): use the Po's config for members.
  const nd = own(w.devices, p.dev)?.nd;
  const f = nd?.ifs[p.ifn];
  if (!nd || !f) return false;
  if (f.mode === 'access') return f.accessVlan === vlan;
  if (f.mode === 'trunk') return vlan in nd.vlans && (f.allowed === 'all' || f.allowed.includes(vlan));
  return false;
}
