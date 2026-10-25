// Infra services on top of reachability: DHCP scopes, firewall rules, the L4 load balancer, and
// "is something listening on host:port". WP1 owns this file.
import { readyPods } from '../k8s';
import type { LbMember, World } from '../types';
import { own } from '../util';
import { addressOf, inCidr, powered } from './basics';
import { hsrpActiveFor, sviUp } from './hsrp';
import { reach, vlanOf } from './reach';
import { l2Path } from './stp';
import { effIface, lbActive, operState, withNetMemo } from './topo';

/** The k8s NodePort the L4 pool points at, and the Service behind it. */
export const NODE_PORT = 30080;
export const NODE_PORT_SVC = 'enroll-svc';
/** A student's session lives about this long on the L4 (sessions = rps × this). */
export const SESSION_SECONDS = 2;
/** Paths the enrollment app answers (k8s pods, containers); `/health` answers on every listening app. */
export const APP_ROUTES = ['/', '/enroll', '/courses', '/health'];

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

/**
 * Do this client group's DHCP requests reach a running server? The server is in the clients' VLAN, or
 * their gateway (the campus switch's own SVI, or the HSRP-active core) is up, has `ip helper-address`
 * pointing at the server, and can reach it.
 */
export function dhcpRelayOk(w: World, group: string): boolean {
  return withNetMemo(w, () => {
    const net = w.net;
    const g = own(net?.clients, group);
    if (!net || !g) return false;
    const server = net.dhcp.server;
    const sip = addressOf(w, server).ip;
    if (!net.dhcp.running || !sip || !powered(w, server)) return false;
    if (!powered(w, g.switch) || operState(w, g.switch, g.port) !== 'up') return false;
    const f = effIface(w, { dev: g.switch, ifn: g.port });
    if (f?.mode !== 'access') return false;
    const vlan = f.accessVlan;
    if (vlanOf(w, server) === vlan && l2Path(w, vlan, g.switch, server)) return true;
    const relay = own(w.devices, g.switch)?.nd?.svis[vlan] ? g.switch : hsrpActiveFor(w, vlan);
    if (!relay || !sviUp(w, relay, vlan)) return false;
    if (relay !== g.switch && !l2Path(w, vlan, g.switch, relay)) return false;
    if (own(w.devices, relay)?.nd?.svis[vlan]?.helper !== sip) return false;
    return reach(w, relay, sip, { port: 67 }).ok;
  });
}

function poolDemand(w: World, pool: string) {
  const groups = Object.entries(w.net?.clients ?? {}).filter(([, c]) => c.pool === pool);
  const want = groups.reduce((a, [, c]) => a + c.count, 0);
  const wantOk = groups.reduce((a, [id, c]) => a + (dhcpRelayOk(w, id) ? c.count : 0), 0);
  return { want, wantOk };
}

export function dhcpView(w: World, pool: string): DhcpView {
  return withNetMemo(w, () => {
    const p = own(w.net?.dhcp.pools, pool);
    if (!p) return { size: 0, used: 0, free: 0, stale: 0, starving: 0 };
    const size = Math.max(0, p.end - p.start + 1);
    const { want, wantOk } = poolDemand(w, pool);
    const room = Math.max(0, size - p.stale);
    const got = Math.min(wantOk, room);
    return { size, used: Math.min(size, p.stale + got), free: Math.max(0, room - got), stale: p.stale, starving: want - got };
  });
}

/** Share (0..1) of a client group's devices that got an address. */
export function dhcpShare(w: World, group: string): number {
  return withNetMemo(w, () => {
    const g = own(w.net?.clients, group);
    if (!g || !g.count || !dhcpRelayOk(w, group)) return 0;
    const p = w.net!.dhcp.pools[g.pool];
    const { wantOk } = poolDemand(w, g.pool);
    const room = Math.max(0, p.end - p.start + 1 - p.stale);
    return wantOk ? Math.min(wantOk, room) / wantOk : 0;
  });
}

/** First matching rule wins; no match = permit. */
export function fwAllows(w: World, src: string, dst: string, port?: number): boolean {
  for (const r of w.net?.fw.rules ?? []) {
    if (inCidr(src, r.src) && inCidr(dst, r.dst) && (r.port === undefined || r.port === port)) return r.action === 'permit';
  }
  return true;
}

// ---------- what listens where ----------

type Listener = 'web' | 'container' | 'nodeport' | 'sshd';

function listener(w: World, host: string, port: number): Listener | null {
  if (!powered(w, host)) return null;
  const web = w.web;
  if (web && web.host === host && web.running && web.port === port) return 'web';
  if (w.docker?.containers.some((c) => c.host === host && c.running && c.ports?.[0] === port)) return 'container';
  const k = w.k8s;
  const svc = own(k?.services, NODE_PORT_SVC);
  if (port === NODE_PORT && k && own(k.nodes, host)?.ready && svc && readyPods(k, svc.selector).length > 0) return 'nodeport';
  if (port === 22 && own(w.devices, host)?.kind === 'server') return 'sshd';
  return null;
}

/** Is a program listening on host:port (web server, container -p, k8s NodePort on a Ready node, sshd)? */
export function listening(w: World, host: string, port: number): boolean {
  return listener(w, host, port) !== null;
}

/** HTTP status of GET path on host:port: 0 = nothing listening (connection refused) or not an HTTP server. */
export function httpStatus(w: World, host: string, port: number, path: string): number {
  const l = listener(w, host, port);
  if (!l || l === 'sshd') return 0;
  if (path === '/health') return 200;
  if (l === 'web') return w.web!.routes.includes(path) ? 200 : 404;
  return APP_ROUTES.includes(path) ? 200 : 404;
}

// ---------- L4 ----------

export interface LbView {
  /** Active unit device id, or null if both are down */
  active: string | null;
  members: { name: string; host: string; port: number; enabled: boolean; healthy: boolean }[];
  /** Concurrent sessions the active unit is holding (capped at maxConn) */
  sessions: number;
  /** Sessions wanted: (students + macro bots the firewall lets in) × SESSION_SECONDS */
  demand: number;
  /** More sessions wanted than the session table holds (new ones are refused) */
  over: boolean;
}

function memberHealthy(w: World, active: string, m: LbMember): boolean {
  const h = w.net!.lb!.health;
  const ip = addressOf(w, m.host).ip;
  if (!m.enabled || !ip || !listening(w, m.host, h.port)) return false;
  if (h.proto === 'http' && httpStatus(w, m.host, h.port, h.path) !== 200) return false;
  return reach(w, active, ip, { port: h.port }).ok;
}

/** Requests per second arriving at the L4: students plus macro bots that the firewall lets through. */
export function lbOfferedRps(w: World): number {
  const lb = w.net?.lb;
  if (!lb) return 0;
  const bots = (w.traffic.sources ?? []).filter((s) => s.kind === 'macro' && fwAllows(w, s.cidr.split('/')[0], lb.publicIp, lb.port));
  return w.traffic.rps + bots.reduce((a, s) => a + s.rps, 0);
}

export function lbView(w: World): LbView {
  return withNetMemo(w, () => {
    const lb = w.net?.lb;
    if (!lb) return { active: null, members: [], sessions: 0, demand: 0, over: false };
    const active = lbActive(w);
    const members = lb.members.map((m) => ({ ...m, healthy: !!active && memberHealthy(w, active, m) }));
    const demand = lbOfferedRps(w) * SESSION_SECONDS;
    return { active, members, sessions: active ? Math.min(demand, lb.maxConn) : 0, demand, over: !!active && demand > lb.maxConn };
  });
}

/**
 * How the L4 splits requests over its healthy members: a k8s NodePort member by the Running enroll pods
 * on that node; any other member counts 1. (All weights 0 → equal split.)
 */
export function lbShares(w: World, view: LbView = lbView(w)): { member: LbView['members'][number]; share: number }[] {
  const healthy = view.members.filter((m) => m.healthy);
  if (!healthy.length) return [];
  const k = w.k8s;
  const svc = own(k?.services, NODE_PORT_SVC);
  const pods = k && svc ? readyPods(k, svc.selector) : [];
  let ws = healthy.map((m) => (m.port === NODE_PORT && own(k?.nodes, m.host) ? pods.filter((p) => p.node === m.host).length : 1));
  if (!ws.some((x) => x > 0)) ws = healthy.map(() => 1);
  const total = ws.reduce((a, x) => a + x, 0);
  return healthy.map((member, i) => ({ member, share: ws[i] / total })).filter((x) => x.share > 0);
}
