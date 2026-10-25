// Infra services on top of reachability: DHCP scopes, firewall rules, the L4 load balancer, and
// "is something listening on host:port". WP1 owns this file.
import type { World } from '../types';
import { own } from '../util';
import { inCidr, powered } from './basics';

export interface DhcpView {
  /** Addresses in the scope */
  size: number;
  /** Leased (clients that got one + stale leases) */
  used: number;
  free: number;
  stale: number;
  /** Clients that asked and got nothing (they fall back to 169.254.x.x) */
  starving: number;
}

export function dhcpView(w: World, pool: string): DhcpView {
  const p = own(w.net?.dhcp.pools, pool);
  if (!p) return { size: 0, used: 0, free: 0, stale: 0, starving: 0 };
  const size = Math.max(0, p.end - p.start + 1);
  const want = Object.values(w.net?.clients ?? {}).filter((c) => c.pool === pool).reduce((a, c) => a + c.count, 0);
  const running = !!w.net?.dhcp.running && powered(w, w.net.dhcp.server);
  const room = Math.max(0, size - p.stale);
  const got = running ? Math.min(want, room) : 0;
  return { size, used: Math.min(size, p.stale + got), free: Math.max(0, room - got), stale: p.stale, starving: want - got };
}

/** First matching rule wins; no match = permit. */
export function fwAllows(w: World, src: string, dst: string, port?: number): boolean {
  for (const r of w.net?.fw.rules ?? []) {
    if (inCidr(src, r.src) && inCidr(dst, r.dst) && (r.port === undefined || r.port === port)) return r.action === 'permit';
  }
  return true;
}

export interface LbView {
  /** Active unit device id, or null if both are down */
  active: string | null;
  members: { name: string; host: string; port: number; enabled: boolean; healthy: boolean }[];
  /** Concurrent sessions the active unit is holding */
  sessions: number;
}

export function lbView(w: World): LbView {
  // TODO(WP1): health checks via `listening` + HTTP path; sessions from traffic.
  const lb = w.net?.lb;
  if (!lb) return { active: null, members: [], sessions: 0 };
  const active = lb.pair.find((id) => powered(w, id)) ?? null;
  return { active, members: lb.members.map((m) => ({ ...m, healthy: m.enabled && powered(w, m.host) })), sessions: 0 };
}

/** Is a program listening on host:port (web server, container -p, k8s NodePort)? */
export function listening(_w: World, _host: string, _port: number): boolean {
  // TODO(WP1)
  return true;
}
