// Infra services on top of reachability: DHCP scopes, firewall rules, the L4 load balancer, and
// "is something listening on host:port". WP1 owns this file.
import { readyPods } from '../k8s';
import type { Container, LbMember, World } from '../types';
import { own } from '../util';
import { addressOf, inCidr, intToIp, ipToInt, maskBits, powered } from './basics';
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

/** A CIDR ('any', '10.0.0.0/8', a bare address = /32) as an inclusive range of address numbers. */
function cidrRange(cidr: string): [number, number] {
  if (cidr === 'any') return [0, 2 ** 32 - 1];
  const [net, len] = cidr.split('/');
  const bits = len === undefined ? 32 : parseInt(len, 10);
  const lo = (ipToInt(net) & maskBits(bits)) >>> 0;
  return [lo, lo + 2 ** (32 - bits) - 1];
}

export interface FwSplit {
  /** Share 0..1 of the range's addresses whose first matching rule is a deny */
  blocked: number;
  /** An address in the range that the firewall lets through (null: none) */
  allowIp: string | null;
  /** An address in the range that the firewall drops (null: none) */
  denyIp: string | null;
}

/**
 * How the firewall treats a whole source range, address by address as `fwAllows` would: the first rule
 * that matches each address decides it, no match = permit. A deny on part of the range blocks only that
 * part (a /32 on a /24's first address blocks 1/256 of it).
 */
export function fwSplit(w: World, cidr: string, dst: string, port?: number): FwSplit {
  const [lo, hi] = cidrRange(cidr);
  /** Addresses no rule has decided yet */
  let open: [number, number][] = [[lo, hi]];
  let blocked = 0;
  let denied: number | null = null;
  let permitted: number | null = null;
  for (const r of w.net?.fw.rules ?? []) {
    if (!open.length) break;
    if (!inCidr(dst, r.dst) || (r.port !== undefined && r.port !== port)) continue;
    const [a, b] = cidrRange(r.src);
    const next: [number, number][] = [];
    for (const [x, y] of open) {
      const s = Math.max(x, a);
      const e = Math.min(y, b);
      if (s > e) {
        next.push([x, y]);
        continue;
      }
      if (r.action === 'deny') {
        blocked += e - s + 1;
        denied ??= s;
      } else permitted ??= s;
      if (x < s) next.push([x, s - 1]);
      if (e < y) next.push([e + 1, y]);
    }
    open = next;
  }
  const allowed = permitted ?? open[0]?.[0] ?? null;
  return {
    blocked: blocked / (hi - lo + 1),
    allowIp: allowed === null ? null : intToIp(allowed),
    denyIp: denied === null ? null : intToIp(denied),
  };
}

/**
 * Share (0..1) of a source range the firewall blocks on its way to dst:port: 1 only when, over the whole
 * range, the first matching rule is a deny; a deny that covers part of it blocks that fraction.
 */
export const fwBlocksCidr = (w: World, cidr: string, dst: string, port?: number): number => fwSplit(w, cidr, dst, port).blocked;

// ---------- students on the internet ----------

/** The students' ISP blocks (`fw top` lists them). Students are split evenly over them. */
export const STUDENT_BLOCKS: readonly { cidr: string; label: string }[] = [
  { cidr: '175.223.0.0/16', label: '학생 (모바일)' },
  { cidr: '211.234.0.0/16', label: '학생 (가정 인터넷)' },
  { cidr: '59.10.0.0/16', label: '학생 (가정 인터넷)' },
];

/** Each block's share of the students. */
export const STUDENT_SHARE = 1 / STUDENT_BLOCKS.length;

export interface StudentFw {
  /** Share 0..1 of the students the firewall lets through to 수강신청 */
  allowed: number;
  /** A student address that gets through (null: none) */
  allowIp: string | null;
  /** A student address that is dropped (null: none) */
  denyIp: string | null;
}

/** The students as the firewall sees them on their way to the L4's public address. */
export function studentFw(w: World): StudentFw {
  const lb = w.net?.lb;
  if (!lb) return { allowed: 0, allowIp: null, denyIp: null };
  let blocked = 0;
  let allowIp: string | null = null;
  let denyIp: string | null = null;
  for (const b of STUDENT_BLOCKS) {
    const s = fwSplit(w, b.cidr, lb.publicIp, lb.port);
    blocked += s.blocked;
    allowIp ??= s.allowIp;
    denyIp ??= s.denyIp;
  }
  return { allowed: 1 - blocked / STUDENT_BLOCKS.length, allowIp, denyIp };
}

// ---------- what listens where ----------

type Listener = 'web' | 'container' | 'nodeport' | 'sshd';

/** Port the program in each image listens on inside its container (commands/docker.ts APP_PORT). */
const IMAGE_PORT: Record<string, number> = { enroll: 8000, mysql: 3306 };

/** A published container answers only if -p leads to the port its program really listens on inside. */
const containerAnswers = (c: Container): boolean => {
  const inner = own(IMAGE_PORT, c.image.split(':')[0]);
  return inner === undefined || c.ports?.[1] === inner;
};

function listener(w: World, host: string, port: number): Listener | null {
  if (!powered(w, host)) return null;
  const web = w.web;
  if (web && web.host === host && web.running && web.port === port) return 'web';
  if (w.docker?.containers.some((c) => c.host === host && c.running && c.ports?.[0] === port && containerAnswers(c))) return 'container';
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

/** Requests per second arriving at the L4: the students and macro bots that the firewall lets through. */
export function lbOfferedRps(w: World): number {
  const lb = w.net?.lb;
  if (!lb) return 0;
  const bots = (w.traffic.sources ?? []).filter((s) => s.kind === 'macro');
  const botRps = bots.reduce((a, s) => a + s.rps * (1 - fwBlocksCidr(w, s.cidr, lb.publicIp, lb.port)), 0);
  return w.traffic.rps * studentFw(w).allowed + botRps;
}

export function lbView(w: World): LbView {
  return withNetMemo(w, () => {
    const lb = w.net?.lb;
    if (!lb) return { active: null, members: [], sessions: 0, demand: 0, over: false };
    const active = lbActive(w);
    const members = lb.members.map((m) => ({ ...m, healthy: !!active && memberHealthy(w, active, m) }));
    // Whole sessions (a partly blocked source sends a fraction of its rate).
    const demand = Math.round(lbOfferedRps(w) * SESSION_SECONDS);
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
