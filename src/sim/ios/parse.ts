// IOS line parser: per token, against a command tree.
// exact keyword → unique prefix → "% Ambiguous" → typed arguments → "% Invalid input" (caret) → "% Incomplete".
import { isIp } from '../net/basics';
import { normIf } from '../net/ifname';
import type { DayId, IosLevel, IosMode, NetDevice, World } from '../types';

export type ArgKind = 'int' | 'vlan' | 'vlanList' | 'ifname' | 'ifrange' | 'ip' | 'mask' | 'word' | 'line';
export type ArgVal = number | number[] | string;

/** What the tree can see while parsing: the device (absent when canonicalizing text) and the mode. */
export interface Env {
  w?: World;
  host?: string;
  nd?: NetDevice;
  mode: IosMode;
}

/** Handler context: everything a command needs to run. */
export interface Ctx {
  w: World;
  host: string;
  nd: NetDevice;
  day: DayId;
  /** Mode the line runs in (config, after a config-if → config fallback) */
  mode: IosMode;
  a: Record<string, ArgVal>;
  out: string[];
  /** Mode after the line; starts equal to `mode` */
  next: IosMode | null;
  events: string[];
  /** A config change happened (dirty) */
  changed: boolean;
}

export type Handler = (c: Ctx) => void;

export interface CNode {
  kw?: string;
  arg?: ArgKind;
  /** Key the argument's value is stored under in `Ctx.a` */
  id?: string;
  /** How the argument shows in `?`: '<1-4094>', 'WORD', 'A.B.C.D' */
  label?: string;
  min?: number;
  max?: number;
  help: string;
  /** Korean gloss (`?` and the cheat sheet) */
  ko: string;
  /** Matched only when typed in full and never listed (e.g. `end` at exec, for Ctrl+Z) */
  exact?: boolean;
  /** Decoy: listed by `?` and counted for prefixes, but not in the cheat sheet or Tab */
  decoy?: boolean;
  /** Visible only when true */
  when?: (e: Env) => boolean;
  /** Extra check on a parsed argument value (e.g. the interface exists) */
  check?: (v: ArgVal, e: Env) => boolean;
  kids?: CNode[];
  run?: Handler;
  /** Handler for the `no` form (the deepest `no` on the path wins) */
  no?: Handler;
  /** Message instead of "% Incomplete command." */
  incomplete?: string;
}

export interface Tok {
  s: string;
  col: number;
}

export function tokenize(line: string): Tok[] {
  const toks: Tok[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) toks.push({ s: m[0], col: m.index });
  return toks;
}

export const visible = (n: CNode, e: Env) => !n.when || n.when(e);

/** Does any node under (and including) `n` have a `no` handler? */
export function hasNo(n: CNode): boolean {
  return !!n.no || (n.kids ?? []).some(hasNo);
}

const VLAN_LIST_RE = /^\d+(-\d+)?(,\d+(-\d+)?)*$/;

export function parseVlanList(s: string): number[] | null {
  if (!VLAN_LIST_RE.test(s)) return null;
  const out = new Set<number>();
  for (const part of s.split(',')) {
    const [a, b] = part.split('-').map((x) => parseInt(x, 10));
    const hi = b ?? a;
    if (a < 1 || hi > 4094 || hi < a) return null;
    for (let v = a; v <= hi; v++) out.add(v);
  }
  return [...out].sort((x, y) => x - y);
}

/** [10,20,30,31,32] → '10,20,30-32' */
export function fmtVlanList(vs: number[]): string {
  const s = [...new Set(vs)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    parts.push(j > i ? `${s[i]}-${s[j]}` : `${s[i]}`);
    i = j;
  }
  return parts.join(',');
}

/** 'gi1/0/1 - 4, gi 1/0/7' → keys ['Gi1/0/1' … 'Gi1/0/4', 'Gi1/0/7'] and canonical 'Gi1/0/1 - 4 , Gi1/0/7'. */
export function parseIfRange(text: string): { keys: string[]; canon: string } | null {
  const keys: string[] = [];
  const canon: string[] = [];
  for (const part of text.split(',')) {
    const m = /^\s*(.*?)(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!m || !m[1].trim()) return null;
    const [, prefix, a, b] = m;
    const lo = parseInt(a, 10);
    const hi = b === undefined ? lo : parseInt(b, 10);
    if (hi < lo || hi - lo > 64) return null;
    for (let n = lo; n <= hi; n++) {
      const k = normIf(`${prefix}${n}`);
      if (!k) return null;
      keys.push(k);
    }
    canon.push(`${normIf(`${prefix}${lo}`)}${b === undefined ? '' : ` - ${hi}`}`);
  }
  return keys.length ? { keys: [...new Set(keys)], canon: canon.join(' , ') } : null;
}

interface ArgHit {
  value: ArgVal;
  consumed: number;
  canon: string;
}

function parseArg(n: CNode, toks: Tok[], i: number, line: string, e: Env): ArgHit | null {
  const t = toks[i].s;
  let hit: ArgHit | null = null;
  switch (n.arg) {
    case 'int':
    case 'vlan': {
      if (!/^\d+$/.test(t)) return null;
      const v = parseInt(t, 10);
      const [lo, hi] = n.arg === 'vlan' ? [1, 4094] : [n.min ?? 0, n.max ?? 2147483647];
      if (v < lo || v > hi) return null;
      hit = { value: v, consumed: 1, canon: String(v) };
      break;
    }
    case 'vlanList': {
      const vs = parseVlanList(t);
      if (!vs) return null;
      hit = { value: vs, consumed: 1, canon: fmtVlanList(vs) };
      break;
    }
    case 'ifname': {
      let k = normIf(t);
      let consumed = 1;
      // 'gi 1/0/5', 'port-channel 1', 'vlan 10'
      if (!k && /^[a-z-]+$/i.test(t) && toks[i + 1]) {
        k = normIf(t + toks[i + 1].s);
        consumed = 2;
      }
      if (!k) return null;
      hit = { value: k, consumed, canon: k };
      break;
    }
    case 'ip':
    case 'mask':
      if (!isIp(t)) return null;
      hit = { value: t, consumed: 1, canon: t };
      break;
    case 'word':
      hit = { value: t, consumed: 1, canon: t };
      break;
    case 'line': {
      const rest = line.slice(toks[i].col).trim();
      hit = { value: rest, consumed: toks.length - i, canon: rest };
      break;
    }
    case 'ifrange': {
      const r = parseIfRange(line.slice(toks[i].col));
      if (!r) return null;
      hit = { value: r.keys.join(','), consumed: toks.length - i, canon: r.canon };
      break;
    }
    default:
      return null;
  }
  if (n.check && !n.check(hit.value, e)) return null;
  return hit;
}

export type Match = { node: CNode; consumed: number; canon: string; value?: ArgVal } | { err: 'ambiguous' | 'invalid' };

/** Match token i against the candidate nodes. */
export function matchAt(nodes: CNode[], toks: Tok[], i: number, line: string, e: Env): Match {
  const lt = toks[i].s.toLowerCase();
  const kws = nodes.filter((n) => n.kw && visible(n, e));
  const exact = kws.find((n) => n.kw === lt);
  if (exact) return { node: exact, consumed: 1, canon: exact.kw! };
  const pre = kws.filter((n) => !n.exact && n.kw!.startsWith(lt));
  if (pre.length === 1) return { node: pre[0], consumed: 1, canon: pre[0].kw! };
  if (pre.length > 1) return { err: 'ambiguous' };
  for (const n of nodes) {
    if (!n.arg || !visible(n, e)) continue;
    const h = parseArg(n, toks, i, line, e);
    if (h) return { node: n, consumed: h.consumed, canon: h.canon, value: h.value };
  }
  return { err: 'invalid' };
}

export interface Walk {
  ok: boolean;
  err?: 'ambiguous' | 'invalid' | 'incomplete';
  /** Token index where it failed */
  at: number;
  neg: boolean;
  /** Last matched node */
  last: CNode | null;
  /** Nodes that may come next (visible kids of `last`, or the roots) */
  next: CNode[];
  args: Record<string, ArgVal>;
  canon: string[];
  /** Matched nodes, with the sibling set each was chosen from and how many tokens it took */
  path: { node: CNode; siblings: CNode[]; canon: string }[];
  handler: Handler | null;
}

/**
 * Walk the tokens through the tree. `no` (a root keyword `no` with no handler of its own) flips to the
 * negated form: from then on only branches that lead to a `no` handler are offered, until one is passed.
 */
export function walk(roots: CNode[], toks: Tok[], line: string, e: Env): Walk {
  const w: Walk = { ok: true, at: 0, neg: false, last: null, next: roots, args: {}, canon: [], path: [], handler: null };
  let nodes = roots;
  let noHandler: Handler | null = null;
  const offer = (ns: CNode[]) => (w.neg && !noHandler ? ns.filter(hasNo) : ns);
  for (let i = 0; i < toks.length; ) {
    const m = matchAt(offer(nodes), toks, i, line, e);
    if ('err' in m) return { ...w, ok: false, err: m.err, at: i, next: offer(nodes) };
    w.path.push({ node: m.node, siblings: offer(nodes), canon: m.canon });
    w.canon.push(m.canon);
    i += m.consumed;
    if (m.node.kw === 'no' && !m.node.run && !w.neg && w.path.length === 1) {
      w.neg = true;
      nodes = m.node.kids ?? [];
      w.last = m.node;
      continue;
    }
    if (m.node.id !== undefined && m.value !== undefined) w.args[m.node.id] = m.value;
    w.last = m.node;
    if (w.neg && m.node.no) noHandler = m.node.no;
    nodes = (m.node.kids ?? []).filter((k) => visible(k, e));
  }
  w.next = offer(nodes);
  const last = w.last;
  w.handler = w.neg ? (last?.no ?? noHandler) : (last?.run ?? null);
  if (!w.handler) return { ...w, ok: false, err: 'incomplete', at: toks.length };
  return w;
}

export const isConfigLevel = (l: IosLevel) => l === 'config' || l === 'config-if' || l === 'config-vlan';
