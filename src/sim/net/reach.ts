// Can A talk to B? Host → its gateway (the HSRP-active core) → the destination VLAN, with the return
// path, the firewall and the border routers for traffic to/from the internet. WP1 owns this file.
import type { World } from '../types';
import { own } from '../util';
import { addressOf, devicesWithIp, isIp, isLoopback, powered } from './basics';

export type ReachFailure =
  | 'no_power'
  | 'no_ip'
  | 'unknown_host'
  | 'dns_down'
  | 'no_route'
  | 'link'
  | 'vlan'
  | 'gateway'
  | 'storm'
  | 'fw_deny'
  | 'conflict';

export interface ReachResult {
  ok: boolean;
  /** Packet loss 0..1 */
  loss: number;
  failure?: ReachFailure;
  targetIp?: string;
  targetId?: string;
  /** Device ids along the way (for traceroute / NMS path highlight) */
  hops: string[];
  /** Logical link keys traversed (for load) */
  links: string[];
}

/** VLAN a host sits in: the access VLAN of the switch port its eth0 is cabled to (null if none). */
export function vlanOf(_w: World, _host: string): number | null {
  // TODO(WP1)
  return null;
}

/**
 * Name → IP through DNS. Case-insensitive. Fails ('dns_down') when no DNS server is powered and
 * reachable from `from`; an IP is returned as is.
 */
export function resolve(w: World, name: string, _from?: string): { ip: string | null; failure?: 'unknown_host' | 'dns_down' } {
  // TODO(WP1): DNS server reachability.
  if (isIp(name)) return { ip: name };
  const dns = w.net?.dns ?? {};
  const key = Object.keys(dns).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? { ip: dns[key] } : { ip: null, failure: 'unknown_host' };
}

/** Who owns this address right now: a host, an SVI's real IP, an HSRP VIP (the active core), the L4 VIP (active unit), a mgmt IP, a routed port, or 'internet'. */
export function ownerOf(w: World, ip: string): string[] {
  // TODO(WP1): SVI / VIP / mgmt / routed / internet owners.
  const hosts = devicesWithIp(w, ip).map((d) => d.id);
  if (hosts.length) return hosts;
  const mgmt = Object.values(w.devices).find((d) => d.nd?.mgmtIp === ip);
  return mgmt ? [mgmt.id] : [];
}

/** Can a packet get from device `from` to `dstIp` and back? `srcCidr` overrides the source address (macro bots, campus groups). */
export function reach(w: World, from: string, dstIp: string, _opts?: { srcIp?: string; port?: number }): ReachResult {
  // TODO(WP1): the real walk. Stub: anything powered with an address answers.
  if (!powered(w, from)) return { ok: false, loss: 1, failure: 'no_power', hops: [], links: [] };
  if (isLoopback(dstIp)) return { ok: true, loss: 0, targetIp: '127.0.0.1', targetId: from, hops: [from], links: [] };
  if (own(w.devices, from)?.kind !== 'internet' && !addressOf(w, from).ip && !own(w.devices, from)?.nd) {
    return { ok: false, loss: 1, failure: 'no_ip', hops: [], links: [] };
  }
  const owners = ownerOf(w, dstIp).filter((id) => powered(w, id));
  if (!owners.length) return { ok: false, loss: 1, failure: 'no_route', targetIp: dstIp, hops: [], links: [] };
  return { ok: true, loss: owners.length > 1 ? 0.5 : 0, failure: owners.length > 1 ? 'conflict' : undefined, targetIp: dstIp, targetId: owners[0], hops: [from, owners[0]], links: [] };
}
