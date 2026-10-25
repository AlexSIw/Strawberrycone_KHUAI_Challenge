// L1/L2 topology: interface state, who is plugged into whom, port-channels, VLAN membership.
// WP1 owns this file. Everything here is DERIVED from config + cables + power; nothing is cached
// beyond one top-level call (see `withNetMemo`).
import type { Cable, Device, Iface, IfOper, World } from '../types';
import { own } from '../util';
import { cableAt, powered } from './basics';
import { compareIf, poNumber } from './ifname';

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

// ---------- per-call memo ----------
// The derived views are recomputed from scratch on every call, which is O(cables²) per view. A top-level
// entry point (reach, syncNet, computeLoad, lbView …) wraps its body in `withNetMemo` so that, within
// that one call, each view is built once. Nothing survives the call, so a mutated world is never stale.

interface Memo {
  w: World;
  m: Map<string, unknown>;
}
let memo: Memo | null = null;

/** Run `fn` with derived network views memoised for world `w` (nested calls share the outer memo). */
export function withNetMemo<T>(w: World, fn: () => T): T {
  if (memo && memo.w === w) return fn();
  const prev = memo;
  memo = { w, m: new Map() };
  try {
    return fn();
  } finally {
    memo = prev;
  }
}

/** Forget memoised views (syncNet calls this after it changes the world mid-pass). */
export function resetNetMemo(w: World): void {
  if (memo && memo.w === w) memo.m = new Map();
}

/** Memoised value for this call, or computed fresh outside a memo scope. */
export function memoGet<T>(w: World, key: string, make: () => T): T {
  if (!memo || memo.w !== w) return make();
  if (memo.m.has(key)) return memo.m.get(key) as T;
  const v = make();
  memo.m.set(key, v);
  return v;
}

// ---------- small helpers ----------

export const portKey = (p: Port): string => `${p.dev}:${p.ifn}`;

export function parseEp(ep: string): Port {
  const i = ep.indexOf(':');
  return { dev: ep.slice(0, i), ifn: ep.slice(i + 1) };
}

/** Switches forward frames: they have IOS config and are kind 'switch'. */
export function isSwitch(w: World, dev: string): boolean {
  const d = own(w.devices, dev);
  return !!d && d.kind === 'switch' && !!d.nd;
}

/** The interface config of a port (undefined for hosts / unknown ports). */
export function ifaceOf(w: World, p: Port): Iface | undefined {
  return own(own(w.devices, p.dev)?.nd?.ifs, p.ifn);
}

/** The config that decides what a port carries: a channel-group member follows its Po. */
export function effIface(w: World, p: Port): Iface | undefined {
  const nd = own(w.devices, p.dev)?.nd;
  const f = own(nd?.ifs, p.ifn);
  if (!nd || !f) return undefined;
  return f.group !== undefined ? (own(nd.ifs, `Po${f.group}`) ?? f) : f;
}

function cableIndex(w: World): Map<string, Cable> {
  return memoGet(w, 'cables', () => {
    const m = new Map<string, Cable>();
    for (const c of Object.values(w.cables)) {
      if (!m.has(c.a)) m.set(c.a, c);
      if (!m.has(c.b)) m.set(c.b, c);
    }
    return m;
  });
}

/** The cable in `dev:ifn` (memoised lookup). */
export function cableOf(w: World, dev: string, ifn: string): Cable | undefined {
  const ep = `${dev}:${ifn}`;
  return memo && memo.w === w ? cableIndex(w).get(ep) : cableAt(w, ep);
}

/** A campus client-group port: no cable (it stands for a building's wiring), up unless shut / err-disabled. */
export function isClientPort(w: World, dev: string, ifn: string): boolean {
  return Object.values(w.net?.clients ?? {}).some((c) => c.switch === dev && c.port === ifn);
}

/** A host's network card: its first port (eth0 on servers, Hu1/1 on the L4). */
export function hostNic(w: World, id: string): string | undefined {
  return own(w.devices, id)?.ports[0];
}

// ---------- L1: operational state ----------

/** The far end can bring the link up: powered, and its port isn't shut or err-disabled. */
function peerLive(w: World, p: Port): boolean {
  const d = own(w.devices, p.dev);
  if (!d || !powered(w, p.dev)) return false;
  const nd = d.nd;
  const f = own(nd?.ifs, p.ifn);
  if (!f) return true;
  if (f.errDisabled || f.shutdown) return false;
  if (f.group !== undefined && own(nd!.ifs, `Po${f.group}`)?.shutdown) return false;
  return true;
}

function computeOper(w: World, dev: string, ifn: string): IfOper {
  const d = own(w.devices, dev);
  if (!d || !powered(w, dev)) return 'down';
  const nd = d.nd;
  const f = own(nd?.ifs, ifn);
  if (f?.errDisabled) return 'err-disabled';
  if (f?.shutdown) return 'admin-down';
  const po = poNumber(ifn);
  if (po !== null && nd) return poMembers(w, dev, po).some((m) => bundled(w, dev, m)) ? 'up' : 'down';
  if (f?.group !== undefined && own(nd!.ifs, `Po${f.group}`)?.shutdown) return 'admin-down';
  const c = cableOf(w, dev, ifn);
  if (!c) return isClientPort(w, dev, ifn) ? 'up' : 'down';
  if (c.broken) return 'down';
  const ep = `${dev}:${ifn}`;
  return peerLive(w, parseEp(c.a === ep ? c.b : c.a)) ? 'up' : 'down';
}

/**
 * Operational state: power → err-disabled → admin-down (own or its Po's `shutdown`) → cable
 * (missing / broken) → peer (unpowered, shut, err-disabled) → up. A Po is up iff a member is bundled.
 * Hosts' ports (no nd) are up when cabled to a live peer. A campus client port with no cable counts as up.
 */
export function operState(w: World, dev: string, ifn: string): IfOper {
  return memoGet(w, `oper:${dev}:${ifn}`, () => computeOper(w, dev, ifn));
}

/** The port at the other end of the cable. */
export function peerOf(w: World, p: Port): Port | null {
  const c = cableOf(w, p.dev, p.ifn);
  if (!c) return null;
  const ep = portKey(p);
  return parseEp(c.a === ep ? c.b : c.a);
}

// ---------- port-channels ----------

/** Physical members of Po`n` on `dev`, in interface order. */
export function poMembers(w: World, dev: string, n: number): string[] {
  const ifs = own(w.devices, dev)?.nd?.ifs ?? {};
  return Object.keys(ifs)
    .filter((k) => ifs[k].group === n && poNumber(k) === null)
    .sort(compareIf);
}

/**
 * Do two facing channel-group members agree on how to bundle? Both `on` (no negotiation), or both LACP
 * with at least one `active` (two passive ends never start talking; LACP facing `on` is suspended).
 * A member with no mode set counts as `active` (as `show running-config` prints it).
 */
function modesMatch(a: Iface, b: Iface): boolean {
  const ma = a.chMode ?? 'active';
  const mb = b.chMode ?? 'active';
  if (ma === 'on' || mb === 'on') return ma === mb;
  return ma === 'active' || mb === 'active';
}

/**
 * The Po a port-channel bundles with: the far Po of its first (interface order) member that is up and
 * whose peer is in a channel group with a matching mode. One Po bundles with exactly one far Po on one device.
 */
function partnerOf(w: World, dev: string, n: number): string | null {
  return memoGet(w, `partner:${dev}:${n}`, () => {
    for (const m of poMembers(w, dev, n)) {
      if (operState(w, dev, m) !== 'up') continue;
      const peer = peerOf(w, { dev, ifn: m });
      const pf = peer && ifaceOf(w, peer);
      const f = ifaceOf(w, { dev, ifn: m });
      if (peer && f && pf?.group !== undefined && modesMatch(f, pf)) return `${peer.dev}:Po${pf.group}`;
    }
    return null;
  });
}

/** Is this physical member bundled (flag P): up, modes that negotiate, and both ends' Po picked each other. */
export function bundled(w: World, dev: string, ifn: string): boolean {
  const f = ifaceOf(w, { dev, ifn });
  if (f?.group === undefined || operState(w, dev, ifn) !== 'up') return false;
  const peer = peerOf(w, { dev, ifn });
  const pf = peer && ifaceOf(w, peer);
  if (!peer || pf?.group === undefined || !modesMatch(f, pf)) return false;
  return partnerOf(w, dev, f.group) === `${peer.dev}:Po${pf.group}` && partnerOf(w, peer.dev, pf.group) === `${dev}:Po${f.group}`;
}

/** `show etherchannel summary` view of Port-channel N on a device. Flags: P bundled, s suspended, D down, I stand-alone. */
export function poState(w: World, dev: string, n: number): { up: boolean; members: { ifn: string; flag: 'P' | 's' | 'D' | 'I' }[] } {
  return withNetMemo(w, () => {
    const members = poMembers(w, dev, n).map((ifn) => {
      if (operState(w, dev, ifn) !== 'up') return { ifn, flag: 'D' as const };
      if (bundled(w, dev, ifn)) return { ifn, flag: 'P' as const };
      const peer = peerOf(w, { dev, ifn });
      // Facing another switch that won't bundle: suspended. Facing a host (no LACP at all): stand-alone.
      return { ifn, flag: peer && isSwitch(w, peer.dev) ? ('s' as const) : ('I' as const) };
    });
    return { up: operState(w, dev, `Po${n}`) === 'up', members };
  });
}

// ---------- logical links ----------

function speedOf(w: World, p: Port): number | undefined {
  return ifaceOf(w, p)?.speed;
}

function cableSpeed(w: World, a: Port, b: Port): number {
  const s = [speedOf(w, a), speedOf(w, b)].filter((x): x is number => x !== undefined);
  return s.length ? Math.min(...s) : 1000;
}

function linkKey(a: Port, b: Port): { key: string; a: Port; b: Port } {
  const [x, y] = [a, b].sort((p, q) => (portKey(p) < portKey(q) ? -1 : 1));
  return { key: `${portKey(x)}~${portKey(y)}`, a: x, b: y };
}

/**
 * Every logical link in the world. Members of Po(a) whose peers are members of one Po(b) on one peer
 * device fold into one link (kind 'po', cap = Σ bundled member speeds). A member that can't bundle
 * (peer not in a channel group, or bundled elsewhere) is suspended: it shows as a down cable link.
 */
export function logicalLinks(w: World): LLink[] {
  return memoGet(w, 'links', () => {
    const out: LLink[] = [];
    const pos = new Map<string, LLink>();
    for (const c of Object.values(w.cables)) {
      const a = parseEp(c.a);
      const b = parseEp(c.b);
      const ga = ifaceOf(w, a)?.group;
      const gb = ifaceOf(w, b)?.group;
      if (ga === undefined && gb === undefined) {
        const up = operState(w, a.dev, a.ifn) === 'up' && operState(w, b.dev, b.ifn) === 'up';
        const k = linkKey(a, b);
        out.push({ ...k, cables: [c.id], kind: 'cable', capMbps: up ? cableSpeed(w, a, b) : 0, up });
        continue;
      }
      if (ga !== undefined && gb !== undefined && bundled(w, a.dev, a.ifn)) {
        const k = linkKey({ dev: a.dev, ifn: `Po${ga}` }, { dev: b.dev, ifn: `Po${gb}` });
        let l = pos.get(k.key);
        if (!l) {
          l = { ...k, cables: [], kind: 'po', capMbps: 0, up: true };
          pos.set(k.key, l);
          out.push(l);
        }
        l.cables.push(c.id);
        l.capMbps += cableSpeed(w, a, b);
        continue;
      }
      // A member that is down or suspended carries nothing: a down cable link of its own.
      out.push({ ...linkKey(a, b), cables: [c.id], kind: 'cable', capMbps: 0, up: false });
    }
    return out;
  });
}

/** Logical link by key. */
export function linkByKey(w: World, key: string): LLink | undefined {
  return memoGet(w, 'linkByKey', () => new Map(logicalLinks(w).map((l) => [l.key, l]))).get(key);
}

/** Does this switch port carry `vlan`? access → accessVlan === vlan; trunk → allowed and the VLAN exists on that switch. Members follow their Po. */
export function carries(w: World, p: Port, vlan: number): boolean {
  const nd = own(w.devices, p.dev)?.nd;
  const f = effIface(w, p);
  if (!nd || !f) return false;
  if (f.mode === 'access') return f.accessVlan === vlan;
  if (f.mode === 'trunk') return vlan in nd.vlans && (f.allowed === 'all' || f.allowed.includes(vlan));
  return false;
}

/** The L4 unit that answers for the VIP: the first of the pair that is powered with its link up. */
export function lbActive(w: World): string | null {
  const lb = w.net?.lb;
  if (!lb) return null;
  return (
    lb.pair.find((id) => {
      const nic = hostNic(w, id);
      return powered(w, id) && !!nic && operState(w, id, nic) === 'up';
    }) ?? null
  );
}

/** Devices sorted by id (stable iteration for deterministic output). */
export function devicesSorted(w: World): Device[] {
  return Object.values(w.devices).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
