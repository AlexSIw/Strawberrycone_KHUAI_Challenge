// Spanning tree, simplified: per VLAN, root = lowest stpPriority (then device id); BFS tree from the root;
// every non-tree edge gets one end blocked — unless NEITHER end runs STP for that VLAN, which is a
// broadcast storm (real PVST behaviour: one STP speaker on a loop is enough to break it).
// WP1 owns this file.
import type { World } from '../types';
import { own } from '../util';
import { powered } from './basics';
import { compareIf } from './ifname';
import { carries, effIface, isSwitch, logicalLinks, memoGet, portKey, withNetMemo, type LLink, type Port } from './topo';

export interface StpView {
  /** Root bridge device id per connected component (first component's root here) */
  root: string | null;
  /** Blocked ports, as 'dev:ifn' */
  blocked: Set<string>;
  /** Port roles for `show spanning-tree`, keyed 'dev:ifn' */
  roles: Record<string, 'Root' | 'Desg' | 'Altn'>;
  storm: boolean;
  /** Root bridge of the component each node (switch or host) is in; null when no switch there runs STP */
  rootOf: Record<string, string | null>;
  /** Looping links where neither end runs STP (the storm's cause), as [port, port] */
  loops: [Port, Port][];
}

/** One link of the VLAN's L2 graph, seen from one end. */
export interface VlanHop {
  link: LLink;
  near: Port;
  far: Port;
}

export interface VlanGraph {
  /** Switches that have the VLAN, and hosts plugged into an access port in it */
  nodes: string[];
  adj: Map<string, VlanHop[]>;
}

/** Does the switch run spanning tree for this VLAN (not `no spanning-tree vlan N`)? */
export function runsStp(w: World, dev: string, vlan: number): boolean {
  return isSwitch(w, dev) && !own(w.devices, dev)!.nd!.stpOff.includes(vlan);
}

function switchIn(w: World, dev: string, vlan: number): boolean {
  const nd = own(w.devices, dev)?.nd;
  return isSwitch(w, dev) && powered(w, dev) && !!nd && vlan in nd.vlans;
}

/** Is this end of a link part of the VLAN? Switch ports: carry it. Host NICs: face a switch access port in it. */
function endIn(w: World, near: Port, far: Port, vlan: number): boolean {
  if (isSwitch(w, near.dev)) return switchIn(w, near.dev, vlan) && carries(w, near, vlan);
  if (!isSwitch(w, far.dev)) return false;
  const f = effIface(w, far);
  return f?.mode === 'access' && f.accessVlan === vlan;
}

const hopOrder = (x: VlanHop, y: VlanHop) =>
  y.link.capMbps - x.link.capMbps || (x.far.dev < y.far.dev ? -1 : x.far.dev > y.far.dev ? 1 : 0) || compareIf(x.near.ifn, y.near.ifn) || compareIf(x.far.ifn, y.far.ifn);

/** The VLAN's L2 graph over links that are up (STP blocking not applied). */
export function vlanGraph(w: World, vlan: number): VlanGraph {
  return memoGet(w, `vg:${vlan}`, () => {
    const nodes = new Set<string>();
    const adj = new Map<string, VlanHop[]>();
    for (const d of Object.values(w.devices)) if (switchIn(w, d.id, vlan)) nodes.add(d.id);
    for (const l of logicalLinks(w)) {
      if (!l.up || !endIn(w, l.a, l.b, vlan) || !endIn(w, l.b, l.a, vlan)) continue;
      for (const [near, far] of [
        [l.a, l.b],
        [l.b, l.a],
      ] as const) {
        nodes.add(near.dev);
        if (!adj.has(near.dev)) adj.set(near.dev, []);
        adj.get(near.dev)!.push({ link: l, near, far });
      }
    }
    for (const hops of adj.values()) hops.sort(hopOrder);
    return { nodes: [...nodes].sort(), adj };
  });
}

function compute(w: World, vlan: number): StpView {
  const g = vlanGraph(w, vlan);
  const blocked = new Set<string>();
  const roles: StpView['roles'] = {};
  const rootOf: StpView['rootOf'] = {};
  const loops: [Port, Port][] = [];
  let storm = false;
  let firstRoot: string | null = null;
  const seen = new Set<string>();
  const prio = (id: string) => own(w.devices, id)!.nd!.stpPriority;
  const comps: string[][] = [];
  for (const n of g.nodes) {
    if (seen.has(n)) continue;
    const comp: string[] = [];
    const q = [n];
    seen.add(n);
    while (q.length) {
      const u = q.shift()!;
      comp.push(u);
      for (const h of g.adj.get(u) ?? []) if (!seen.has(h.far.dev)) (seen.add(h.far.dev), q.push(h.far.dev));
    }
    comps.push(comp);
  }
  for (const comp of comps) {
    const speakers = comp.filter((id) => runsStp(w, id, vlan)).sort((a, b) => prio(a) - prio(b) || (a < b ? -1 : a > b ? 1 : 0));
    const root = speakers[0] ?? null;
    for (const id of comp) rootOf[id] = root;
    // The best root overall is "the" root (the one show spanning-tree on most switches reports).
    if (root && (!firstRoot || prio(root) < prio(firstRoot) || (prio(root) === prio(firstRoot) && root < firstRoot))) firstRoot = root;
    const start = root ?? [...comp].sort()[0];
    const depth = new Map<string, number>([[start, 0]]);
    const parent = new Map<string, LLink>();
    const tree = new Set<LLink>();
    const q = [start];
    while (q.length) {
      const u = q.shift()!;
      for (const h of g.adj.get(u) ?? []) {
        if (depth.has(h.far.dev)) continue;
        depth.set(h.far.dev, depth.get(u)! + 1);
        parent.set(h.far.dev, h.link);
        tree.add(h.link);
        q.push(h.far.dev);
      }
    }
    const nonTree = new Set<LLink>();
    for (const id of comp) for (const h of g.adj.get(id) ?? []) if (!tree.has(h.link)) nonTree.add(h.link);
    const cut: string[] = [];
    let loopy = false;
    for (const l of nonTree) {
      const ends = [l.a, l.b].filter((p) => runsStp(w, p.dev, vlan));
      if (!ends.length) {
        loopy = true;
        loops.push([l.a, l.b]);
        continue;
      }
      ends.sort((p, q2) => depth.get(q2.dev)! - depth.get(p.dev)! || (p.dev < q2.dev ? 1 : p.dev > q2.dev ? -1 : 0) || compareIf(q2.ifn, p.ifn));
      cut.push(portKey(ends[0]));
    }
    if (loopy) storm = true;
    else cut.forEach((k) => blocked.add(k));
    for (const id of comp) {
      if (!runsStp(w, id, vlan)) continue;
      for (const h of g.adj.get(id) ?? []) {
        const k = portKey(h.near);
        roles[k] = id === root ? 'Desg' : parent.get(id) === h.link ? 'Root' : blocked.has(k) ? 'Altn' : 'Desg';
      }
    }
  }
  return { root: firstRoot, blocked, roles, storm, rootOf, loops };
}

/** Spanning tree for one VLAN (see the file comment). */
export function stpView(w: World, vlan: number): StpView {
  return withNetMemo(w, () => memoGet(w, `stp:${vlan}`, () => compute(w, vlan)));
}

/** Every VLAN some switch has. */
export function allVlans(w: World): number[] {
  const s = new Set<number>();
  for (const d of Object.values(w.devices)) if (d.kind === 'switch' && d.nd) for (const v of Object.keys(d.nd.vlans)) s.add(Number(v));
  return [...s].sort((a, b) => a - b);
}

/**
 * Shortest forwarding path in the VLAN (blocked ports skipped; during a storm nothing is blocked).
 * Returns the logical-link keys and the devices along the way, or null.
 */
export function l2Path(w: World, vlan: number, from: string, to: string): { links: string[]; nodes: string[] } | null {
  return withNetMemo(w, () => {
    if (from === to) return { links: [], nodes: [from] };
    const g = vlanGraph(w, vlan);
    if (!g.adj.has(from)) return null;
    const stp = stpView(w, vlan);
    const prev = new Map<string, { node: string; link: string }>();
    const seen = new Set([from]);
    const q = [from];
    while (q.length) {
      const u = q.shift()!;
      for (const h of g.adj.get(u) ?? []) {
        if (seen.has(h.far.dev) || stp.blocked.has(portKey(h.near)) || stp.blocked.has(portKey(h.far))) continue;
        seen.add(h.far.dev);
        prev.set(h.far.dev, { node: u, link: h.link.key });
        if (h.far.dev === to) {
          const links: string[] = [];
          const nodes = [to];
          for (let c = to; c !== from; ) {
            const p = prev.get(c)!;
            links.unshift(p.link);
            nodes.unshift(p.node);
            c = p.node;
          }
          return { links, nodes };
        }
        // Hosts don't forward.
        if (isSwitch(w, h.far.dev)) q.push(h.far.dev);
      }
    }
    return null;
  });
}
