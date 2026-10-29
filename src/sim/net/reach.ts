// Can A talk to B? Host → its gateway (the HSRP-active core) → the destination VLAN, with the return
// path, the firewall and the border routers for traffic to/from the internet. WP1 owns this file.
//
// The walk, in short:
//   - management addresses (10.10.250.x) are out of band: they answer whenever the device has power,
//     but only to the 관리 PC (ops) and to other network gear;
//   - same subnet: an L2 path in the source's VLAN over forwarding (not STP-blocked) links;
//   - otherwise: host → its gateway (VIP → HSRP-active core, a real SVI address → that switch) in its
//     own VLAN → L3 hops (routed links, the core↔core peer link) to a switch whose SVI for the
//     destination subnet is up and has an L2 path to it → the destination's own gateway must exist;
//   - the internet: core → firewall (rules) → border router → ISP link. Inbound only the L4's public VIP
//     is reachable (firewall → any core → VLAN 30 → the active L4 unit).
// Campus switches are L3 endpoints, never transit.
import type { World } from '../types';
import { own } from '../util';
import { addressOf, inCidr, isIp, isLoopback, powered, sameSubnet } from './basics';
import { hsrpActiveFor, sviUp } from './hsrp';
import { delivery } from './load';
import { fwAllows } from './services';
import { l2Path, stpView } from './stp';
import { devicesSorted, effIface, hostNic, isSwitch, lbActive, logicalLinks, memoGet, operState, peerOf, withNetMemo, type LLink, type Port } from './topo';

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
  /** Device ids along the way (for traceroute / NMS path highlight); on failure, as far as it got */
  hops: string[];
  /** Logical link keys traversed (for load); on failure, as far as it got */
  links: string[];
}

/**
 * Default source of a packet from the internet: one student address (in STUDENT_BLOCKS' first block).
 * Student traffic as a whole comes from every block: see studentFw / studentDelivery.
 */
export const STUDENT_IP = '175.223.10.20';
/** An outside address campus users browse to. */
export const INTERNET_PROBE = '8.8.8.8';

/** VLAN a host sits in: the access VLAN of the switch port its eth0 is cabled to (null if none). */
export function vlanOf(w: World, host: string): number | null {
  return withNetMemo(w, () => {
    const nic = hostNic(w, host);
    const peer = nic ? peerOf(w, { dev: host, ifn: nic }) : null;
    if (!peer || !isSwitch(w, peer.dev)) return null;
    const f = effIface(w, peer);
    return f?.mode === 'access' ? f.accessVlan : null;
  });
}

/** A DNS server (device id) that is powered and that `from` can reach, or null. */
export function dnsServerFor(w: World, from?: string): string | null {
  const net = w.net;
  if (!net) return null;
  return withNetMemo(w, () => {
    for (const s of net.dnsServers) {
      const ip = addressOf(w, s).ip;
      if (!powered(w, s) || !ip) continue;
      if (from === undefined || from === s || reach(w, from, ip, { port: 53 }).ok) return s;
    }
    return null;
  });
}

/** Network gear by id or hostname: the 관리 PC knows every device's management address (hosts file). */
function gearNamed(w: World, name: string) {
  const n = name.toLowerCase();
  return Object.values(w.devices).find((d) => d.nd?.mgmtIp && (d.id.toLowerCase() === n || d.label.toLowerCase() === n));
}

/**
 * Name → IP. Case-insensitive. An IP is returned as is; network gear names give their management
 * address (no DNS needed); everything else goes through DNS, which fails ('dns_down') when no DNS
 * server is powered and reachable from `from`.
 */
export function resolve(w: World, name: string, from?: string): { ip: string | null; failure?: 'unknown_host' | 'dns_down' } {
  if (isIp(name)) return { ip: name };
  if (isLoopback(name)) return { ip: '127.0.0.1' };
  const gear = gearNamed(w, name);
  if (gear) return { ip: gear.nd!.mgmtIp };
  const dns = w.net?.dns;
  if (!dns) return { ip: null, failure: 'unknown_host' };
  if (!dnsServerFor(w, from)) return { ip: null, failure: 'dns_down' };
  const key = Object.keys(dns).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? { ip: dns[key] } : { ip: null, failure: 'unknown_host' };
}

/** The router behind a gateway address: an HSRP VIP → the active core; a real SVI address → that switch (SVI up). */
export function gatewayOf(w: World, gwIp: string): { dev: string; vlan: number } | null {
  return withNetMemo(w, () => {
    for (const d of devicesSorted(w)) {
      for (const [v, s] of Object.entries(d.nd?.svis ?? {})) {
        const vlan = Number(v);
        if (s.hsrp?.vip === gwIp) {
          const a = hsrpActiveFor(w, vlan);
          return a ? { dev: a, vlan } : null;
        }
        if (s.ip === gwIp) return sviUp(w, d.id, vlan) ? { dev: d.id, vlan } : null;
      }
    }
    return null;
  });
}

// ---------- who owns an address ----------

type Dst =
  /** A NIC in a VLAN: a server, the 관리 PC, the active L4 unit (for the VIPs; `ip` is the inside VIP then) */
  | { kind: 'host'; dev: string; vlan: number | null; ip: string }
  | { kind: 'svi'; dev: string; vlan: number }
  /** A routed interface's address */
  | { kind: 'l3'; dev: string }
  | { kind: 'internet' }
  | { kind: 'client'; group: string };

interface Target {
  dst?: Dst;
  failure?: ReachFailure;
  conflict?: boolean;
}

const dstId = (d: Dst): string => (d.kind === 'internet' ? 'internet' : d.kind === 'client' ? `client:${d.group}` : d.dev);

function targetOf(w: World, ip: string): Target {
  const net = w.net;
  for (const d of devicesSorted(w)) {
    for (const [v, s] of Object.entries(d.nd?.svis ?? {})) {
      if (s.hsrp?.vip !== ip) continue;
      const a = hsrpActiveFor(w, Number(v));
      return a ? { dst: { kind: 'svi', dev: a, vlan: Number(v) } } : { failure: 'gateway' };
    }
  }
  if (net?.lb && (ip === net.lb.vip || ip === net.lb.publicIp)) {
    const a = lbActive(w);
    return a ? { dst: { kind: 'host', dev: a, vlan: vlanOf(w, a), ip: net.lb.vip } } : { failure: 'no_route' };
  }
  const found: Dst[] = [];
  let configured = false;
  for (const d of devicesSorted(w)) {
    const on = powered(w, d.id);
    if (d.l3?.ip === ip) {
      configured = true;
      if (on) found.push({ kind: 'host', dev: d.id, vlan: vlanOf(w, d.id), ip });
    }
    for (const [v, s] of Object.entries(d.nd?.svis ?? {})) {
      if (s.ip !== ip) continue;
      configured = true;
      if (on) found.push({ kind: 'svi', dev: d.id, vlan: Number(v) });
    }
    for (const f of Object.values(d.nd?.ifs ?? {})) {
      if (f.mode !== 'routed' || f.ip?.addr !== ip) continue;
      configured = true;
      if (on) found.push({ kind: 'l3', dev: d.id });
    }
  }
  if (found.length) return { dst: found[0], conflict: found.length > 1 };
  if (configured) return { failure: 'no_route' };
  for (const [id, c] of Object.entries(net?.clients ?? {})) {
    const p = own(net!.dhcp.pools, c.pool);
    if (p && inCidr(ip, `${p.network}/${p.mask}`)) return { dst: { kind: 'client', group: id } };
  }
  if (!inCidr(ip, '10.0.0.0/8')) return { dst: { kind: 'internet' } };
  return { failure: 'no_route' };
}

/**
 * Who owns this address right now: a host, an SVI's real IP, an HSRP VIP (the active core), the L4 VIP or
 * public VIP (the active unit), a mgmt IP, a routed port, a campus client group ('client:<id>'), or
 * 'internet' for anything outside 10/8. Owners are listed whether or not they have power (VIPs excepted).
 */
export function ownerOf(w: World, ip: string): string[] {
  return withNetMemo(w, () => {
    const out: string[] = [];
    for (const d of devicesSorted(w)) {
      if (d.nd?.mgmtIp === ip) out.push(d.id);
      if (d.l3?.ip === ip) out.push(d.id);
      for (const s of Object.values(d.nd?.svis ?? {})) if (s.ip === ip) out.push(d.id);
      for (const f of Object.values(d.nd?.ifs ?? {})) if (f.mode === 'routed' && f.ip?.addr === ip) out.push(d.id);
    }
    if (out.length) return [...new Set(out)];
    const t = targetOf(w, ip);
    return t.dst ? [dstId(t.dst)] : [];
  });
}

// ---------- graphs ----------

function l3End(w: World, p: Port): 'routed' | 'internet' | 'svi-trunk' | null {
  const d = own(w.devices, p.dev);
  if (!d) return null;
  if (d.kind === 'internet') return 'internet';
  const f = effIface(w, p);
  if (f?.mode === 'routed' && f.ip) return 'routed';
  if (f?.mode === 'trunk' && d.kind === 'switch' && Object.values(d.nd!.svis).some((s) => s.ip)) return 'svi-trunk';
  return null;
}

interface L3Hop {
  link: LLink;
  far: string;
}

/** Routed adjacencies: routed↔routed links, the ISP links, and trunks between two L3 switches (the core peer link). */
function l3Graph(w: World): Map<string, L3Hop[]> {
  return memoGet(w, 'l3', () => {
    const g = new Map<string, L3Hop[]>();
    for (const l of logicalLinks(w)) {
      if (!l.up) continue;
      const a = l3End(w, l.a);
      const b = l3End(w, l.b);
      const ok = (a === 'routed' && (b === 'routed' || b === 'internet')) || (a === 'internet' && b === 'routed') || (a === 'svi-trunk' && b === 'svi-trunk');
      if (!ok) continue;
      for (const [x, y] of [
        [l.a.dev, l.b.dev],
        [l.b.dev, l.a.dev],
      ]) {
        if (!g.has(x)) g.set(x, []);
        g.get(x)!.push({ link: l, far: y });
      }
    }
    for (const hops of g.values()) hops.sort((p, q) => (p.far < q.far ? -1 : p.far > q.far ? 1 : p.link.key < q.link.key ? -1 : 1));
    return g;
  });
}

/** Campus switches (they host client groups) and the internet are endpoints, never transit. */
function transit(w: World, dev: string): boolean {
  return own(w.devices, dev)?.kind !== 'internet' && !Object.values(w.net?.clients ?? {}).some((c) => c.switch === dev);
}

/** BFS over routed hops from `start`; the first node (start included) that `accept`s, with the path. */
function l3Search(w: World, start: string, accept: (dev: string) => boolean): { nodes: string[]; links: string[] } | null {
  const g = l3Graph(w);
  const prev = new Map<string, { node: string; link: string }>();
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const u = q.shift()!;
    if (accept(u)) {
      const nodes = [u];
      const links: string[] = [];
      for (let c = u; c !== start; ) {
        const p = prev.get(c)!;
        nodes.unshift(p.node);
        links.unshift(p.link);
        c = p.node;
      }
      return { nodes, links };
    }
    if (u !== start && !transit(w, u)) continue;
    for (const h of g.get(u) ?? []) {
      if (seen.has(h.far)) continue;
      seen.add(h.far);
      prev.set(h.far, { node: u, link: h.link.key });
      q.push(h.far);
    }
  }
  return null;
}

/** Physical connectivity through switches, any VLAN (tells a broken cable from a VLAN mistake). */
function l1Connected(w: World, a: string, b: string): boolean {
  const adj = memoGet(w, 'l1adj', () => {
    const m = new Map<string, string[]>();
    for (const l of logicalLinks(w)) {
      if (!l.up) continue;
      for (const [x, y] of [
        [l.a.dev, l.b.dev],
        [l.b.dev, l.a.dev],
      ]) {
        if (!m.has(x)) m.set(x, []);
        m.get(x)!.push(y);
      }
    }
    return m;
  });
  const seen = new Set([a]);
  const q = [a];
  while (q.length) {
    const u = q.shift()!;
    for (const n of adj.get(u) ?? []) {
      if (n === b) return true;
      if (seen.has(n) || !isSwitch(w, n)) continue;
      seen.add(n);
      q.push(n);
    }
  }
  return false;
}

/** Why there is no L2 path: an endpoint's own link is down or no cable path exists ('link'), else the VLAN config ('vlan'). */
function l2Fail(w: World, a: string, b: string): ReachFailure {
  for (const x of [a, b]) {
    const nic = hostNic(w, x);
    if (!isSwitch(w, x) && nic && operState(w, x, nic) !== 'up') return 'link';
  }
  return l1Connected(w, a, b) ? 'vlan' : 'link';
}

const stormIn = (w: World, vlan: number) => stpView(w, vlan).storm;

/** The destination's reply needs its own gateway: configured, in its subnet, alive, and in its VLAN. */
function returnFail(w: World, dev: string): ReachFailure | null {
  if (!own(w.devices, dev)?.l3) return null;
  const a = addressOf(w, dev);
  if (!a.ip || !a.gw || !sameSubnet(a.ip, a.gw, a.mask)) return 'gateway';
  const g = gatewayOf(w, a.gw);
  const v = vlanOf(w, dev);
  if (!g || v === null || g.vlan !== v) return 'gateway';
  return l2Path(w, v, dev, g.dev) ? null : 'gateway';
}

// ---------- the walk ----------

interface Walk {
  hops: string[];
  links: string[];
  targetIp: string;
  targetId?: string;
}

function fail(c: Walk, failure: ReachFailure): ReachResult {
  return { ok: false, loss: 1, failure, targetIp: c.targetIp, targetId: c.targetId, hops: c.hops, links: c.links };
}

function finish(w: World, c: Walk, conflict?: boolean): ReachResult {
  const lossed = 1 - delivery(w, c.links);
  const loss = conflict ? Math.max(lossed, 0.5) : lossed;
  return { ok: loss < 1, loss, failure: conflict ? 'conflict' : undefined, targetIp: c.targetIp, targetId: c.targetId, hops: c.hops, links: c.links };
}

function push(c: Walk, p: { links: string[]; nodes: string[] }): void {
  c.links.push(...p.links);
  c.hops.push(...p.nodes.slice(1));
}

/** From router `r` (already reached) to the destination, over routed hops. */
function routeFrom(w: World, r: string, dst: Dst, dstIp: string, srcIp: string, port: number | undefined, c: Walk, conflict?: boolean): ReachResult {
  let why: ReachFailure | null = null;
  let anySvi = false;
  let tail: { p: { links: string[]; nodes: string[] }; vlan: number } | null = null;
  const clients = w.net?.clients ?? {};
  const accept = (n: string): boolean => {
    switch (dst.kind) {
      case 'host':
        for (const [v, s] of Object.entries(own(w.devices, n)?.nd?.svis ?? {})) {
          if (!s.ip || !sameSubnet(s.ip, dst.ip, s.mask)) continue;
          anySvi = true;
          const u = Number(v);
          if (!sviUp(w, n, u)) continue;
          if (dst.vlan !== u) {
            why ??= 'vlan';
            continue;
          }
          const p = l2Path(w, u, n, dst.dev);
          if (!p) {
            why ??= l2Fail(w, n, dst.dev);
            continue;
          }
          tail = { p, vlan: u };
          return true;
        }
        return false;
      case 'svi':
      case 'l3':
        return n === dst.dev;
      case 'internet':
        return own(w.devices, n)?.kind === 'internet';
      case 'client':
        return n === own(clients, dst.group)?.switch;
    }
  };
  const path = l3Search(w, r, accept);
  if (!path) return fail(c, why ?? (dst.kind === 'host' && anySvi ? 'gateway' : 'no_route'));
  for (let i = 1; i < path.nodes.length; i++) {
    c.links.push(path.links[i - 1]);
    c.hops.push(path.nodes[i]);
    if (own(w.devices, path.nodes[i])?.kind === 'firewall' && !fwAllows(w, srcIp, dstIp, port)) return fail(c, 'fw_deny');
  }
  if (dst.kind === 'host') {
    const t = tail as { p: { links: string[]; nodes: string[] }; vlan: number } | null;
    push(c, t!.p);
    if (stormIn(w, t!.vlan)) return fail(c, 'storm');
    const back = returnFail(w, dst.dev);
    if (back) return fail(c, back);
  }
  if (dst.kind === 'svi' && !sviUp(w, dst.dev, dst.vlan)) return fail(c, 'gateway');
  if (dst.kind === 'client') {
    const g = clients[dst.group];
    if (operState(w, g.switch, g.port) !== 'up') return fail(c, 'link');
  }
  return finish(w, c, conflict);
}

function fromHost(w: World, from: string, dstIp: string, port: number | undefined, c: Walk): ReachResult {
  const a = addressOf(w, from);
  if (!a.ip) return fail(c, 'no_ip');
  if (dstIp === a.ip) return { ...finish(w, c), targetId: from };
  const nic = hostNic(w, from);
  if (!nic || operState(w, from, nic) !== 'up') return fail(c, 'link');
  const v = vlanOf(w, from);
  const t = targetOf(w, dstIp);
  if (!t.dst) return fail(c, t.failure ?? 'no_route');
  const dst = t.dst;
  c.targetId = dstId(dst);
  if ((dst.kind === 'host' || dst.kind === 'svi') && sameSubnet(a.ip, dstIp, a.mask)) {
    if (v === null || dst.vlan !== v) return fail(c, 'vlan');
    if (dst.kind === 'svi' && !sviUp(w, dst.dev, dst.vlan)) return fail(c, 'gateway');
    const p = l2Path(w, v, from, dst.dev);
    if (!p) return fail(c, l2Fail(w, from, dst.dev));
    push(c, p);
    if (stormIn(w, v)) return fail(c, 'storm');
    return finish(w, c, t.conflict);
  }
  if (!a.gw || !sameSubnet(a.ip, a.gw, a.mask)) return fail(c, 'gateway');
  const g = gatewayOf(w, a.gw);
  if (!g) return fail(c, 'gateway');
  if (v === null || g.vlan !== v) return fail(c, 'vlan');
  const p = l2Path(w, v, from, g.dev);
  if (!p) return fail(c, l2Fail(w, from, g.dev));
  push(c, p);
  if (stormIn(w, v)) return fail(c, 'storm');
  return routeFrom(w, g.dev, dst, dstIp, a.ip, port, c, t.conflict);
}

function fromGear(w: World, from: string, dstIp: string, port: number | undefined, c: Walk): ReachResult {
  const nd = own(w.devices, from)!.nd!;
  const t = targetOf(w, dstIp);
  if (!t.dst) return fail(c, t.failure ?? 'no_route');
  const dst = t.dst;
  c.targetId = dstId(dst);
  if ((dst.kind === 'svi' || dst.kind === 'l3') && dst.dev === from) return finish(w, c);
  const svis = Object.entries(nd.svis).filter(([v, s]) => s.ip && sviUp(w, from, Number(v)));
  if (dst.kind === 'host' || dst.kind === 'svi') {
    const hit = svis.find(([, s]) => sameSubnet(s.ip!, dstIp, s.mask));
    if (hit) {
      const u = Number(hit[0]);
      if (dst.vlan !== u) return fail(c, 'vlan');
      const p = l2Path(w, u, from, dst.dev);
      if (!p) return fail(c, l2Fail(w, from, dst.dev));
      push(c, p);
      if (stormIn(w, u)) return fail(c, 'storm');
      return finish(w, c, t.conflict);
    }
  }
  const src = svis[0]?.[1].ip ?? Object.values(nd.ifs).find((f) => f.mode === 'routed' && f.ip)?.ip?.addr ?? nd.mgmtIp;
  return routeFrom(w, from, dst, dstIp, src!, port, c, t.conflict);
}

function fromInternet(w: World, dstIp: string, srcIp: string, port: number | undefined, c: Walk): ReachResult {
  // Inside (10/8) addresses aren't routed on the internet; only public ones are (the L4's public VIP via the firewall's NAT).
  if (inCidr(dstIp, '10.0.0.0/8')) return fail(c, 'no_route');
  const t = targetOf(w, dstIp);
  if (!t.dst) return fail(c, t.failure ?? 'no_route');
  c.targetId = dstId(t.dst);
  if (t.dst.kind === 'internet') return finish(w, c);
  return routeFrom(w, 'internet', t.dst, dstIp, srcIp, port, c, t.conflict);
}

/**
 * Can a packet get from device `from` to `dstIp` and back? `srcIp` overrides the source address
 * (students and macro bots coming from the internet). `port` is used by the firewall rules.
 */
export function reach(w: World, from: string, dstIp: string, opts: { srcIp?: string; port?: number } = {}): ReachResult {
  return withNetMemo(w, () => {
    const c: Walk = { hops: [from], links: [], targetIp: dstIp };
    if (!powered(w, from)) return { ok: false, loss: 1, failure: 'no_power', hops: [], links: [] };
    if (isLoopback(dstIp)) return { ok: true, loss: 0, targetIp: '127.0.0.1', targetId: from, hops: [from], links: [] };
    const d = own(w.devices, from)!;
    const mg = Object.values(w.devices).find((x) => x.nd?.mgmtIp === dstIp);
    if (mg) {
      // Out of band: only the 관리 PC and network gear sit on the management network.
      c.targetId = mg.id;
      if (mg.id === from) return finish(w, c);
      if (!(from === 'ops' || d.nd) || !powered(w, mg.id)) return fail(c, 'no_route');
      c.hops.push(mg.id);
      return finish(w, c);
    }
    if (d.kind === 'internet') return fromInternet(w, dstIp, opts.srcIp ?? STUDENT_IP, opts.port, c);
    if (d.l3) return fromHost(w, from, dstIp, opts.port, c);
    if (d.nd) return fromGear(w, from, dstIp, opts.port, c);
    return fail(c, 'no_ip');
  });
}

/**
 * Traffic from a campus client group to the internet: the campus switch is powered, the group's port is
 * up (not shut / err-disabled), its gateway SVI is up, and a routed uplink leads to a core → firewall →
 * border → ISP.
 */
export function reachFromClients(w: World, group: string, dstIp = INTERNET_PROBE, port?: number): ReachResult {
  return withNetMemo(w, () => {
    const g = own(w.net?.clients, group);
    const c: Walk = { hops: g ? [g.switch] : [], links: [], targetIp: dstIp };
    if (!g || !powered(w, g.switch)) return fail(c, 'no_power');
    if (operState(w, g.switch, g.port) !== 'up') return fail(c, 'link');
    const vlan = effIface(w, { dev: g.switch, ifn: g.port })?.accessVlan;
    const pool = own(w.net!.dhcp.pools, g.pool);
    if (vlan === undefined || !sviUp(w, g.switch, vlan)) return fail(c, 'gateway');
    const t = targetOf(w, dstIp);
    if (!t.dst) return fail(c, t.failure ?? 'no_route');
    c.targetId = dstId(t.dst);
    const src = pool ? `${pool.network.split('.').slice(0, 3).join('.')}.${pool.start}` : INTERNET_PROBE;
    return routeFrom(w, g.switch, t.dst, dstIp, src, port, c, t.conflict);
  });
}

/** A k8s node (or any server) is online: powered, its NIC is up at the switch, and (with a network) it reaches its gateway. */
export function nodeOnline(w: World, id: string): boolean {
  const d = own(w.devices, id);
  if (!d) return true; // an abstract node with no device: only temperature matters
  if (!powered(w, id)) return false;
  return withNetMemo(w, () => {
    const nic = hostNic(w, id);
    if (nic && operState(w, id, nic) !== 'up') return false;
    if (!w.net || !d.l3) return true;
    return !!d.l3.gw && reach(w, id, d.l3.gw).ok;
  });
}
