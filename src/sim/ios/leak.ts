// Text-only helpers for the AI hint leak guard and content authors: expand a typed line to its
// canonical form, and build a regex that matches every way of typing a canonical line.
import type { IosLevel } from '../types';
import { tokenize, walk, type CNode, type Env, type Walk } from './parse';
import { ROOTS } from './tree';

/** Parse at `level` (config-if / config-vlan lines fall back to config like IOS does). */
export function parseText(line: string, level: IosLevel): Walk | null {
  const toks = tokenize(line);
  if (!toks.length) return null;
  const env: Env = { mode: { level } };
  const r = walk(ROOTS[level], toks, line, env);
  if (r.ok) return r;
  if (level === 'config-if' || level === 'config-vlan') {
    const r2 = walk(ROOTS.config, toks, line, { mode: { level: 'config' } });
    if (r2.ok) return r2;
  }
  return null;
}

/** Fully expand a line typed at `level`, or null if it doesn't parse ('sw acc vl 20' → 'switchport access vlan 20'). */
export function canonicalize(line: string, level: IosLevel): string | null {
  const r = parseText(line, level);
  return r ? canonicalOf(r) : null;
}

/** `write` alone is `write memory`; `configure` alone is `configure terminal`. */
export function canonicalOf(r: Walk): string {
  const c = r.canon.join(' ');
  if (c === 'write' || c === 'do write') return `${c} memory`;
  if (c === 'configure') return 'configure terminal';
  return c;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/** 'switchport' with minimum 'sw' → 'sw(?:i(?:t(?:c(?:h(?:p(?:o(?:r(?:t)?)?)?)?)?)?)?)?' */
function prefixRe(word: string, min: number): string {
  const head = esc(word.slice(0, min));
  let tail = '';
  for (let i = word.length - 1; i >= min; i--) tail = `(?:${esc(word[i])}${tail})?`;
  return head + tail;
}

/** Shortest prefix of `kw` that no other keyword among `siblings` shares. */
function minPrefix(kw: string, siblings: CNode[]): number {
  const others = siblings.filter((n) => n.kw && n.kw !== kw && !n.exact).map((n) => n.kw!);
  for (let i = 1; i <= kw.length; i++) {
    const p = kw.slice(0, i);
    if (!others.some((o) => o.startsWith(p))) return i;
  }
  return kw.length;
}

const IF_LONG: Record<string, string> = { Gi: 'gigabitethernet', Te: 'tengigabitethernet', Hu: 'hundredgige', Po: 'port-channel', Vlan: 'vlan' };

function ifRe(key: string): string {
  const m = /^(Gi|Te|Hu|Po|Vlan)(.+)$/.exec(key);
  if (!m) return esc(key);
  return `${prefixRe(IF_LONG[m[1]], 1)}\\s*${esc(m[2])}`;
}

/**
 * A regex matching every way a player (or the AI) could type this canonical line: each keyword from its
 * shortest unique prefix, interface names in any form (gi|g|gigabitethernet, optional space).
 * Case-insensitive and word-bounded, so 'switchport access vlan 20' doesn't match '… vlan 200'.
 */
export function iosVariantsRegex(canonical: string, level: IosLevel): RegExp {
  const r = parseText(canonical, level);
  if (!r) return new RegExp(`(?<![\\w-])${esc(canonical.trim()).replace(/\s+/g, '\\s+')}(?![\\w./-])`, 'i');
  // `write memory` / `configure terminal` written short ('wr', 'conf') are the same command; keep the
  // optional last word optional in the pattern.
  const parts = r.path.map((p) => {
    const n = p.node;
    if (n.kw) return prefixRe(n.kw, minPrefix(n.kw, p.siblings));
    if (n.arg === 'ifname') return ifRe(p.canon);
    return esc(p.canon).replace(/\s+/g, '\\s+');
  });
  let body = parts.join('\\s+');
  const kws = r.path.map((p) => p.node.kw);
  if (kws.length === 1 && (kws[0] === 'write' || kws[0] === 'configure')) {
    body += `(?:\\s+${kws[0] === 'write' ? prefixRe('memory', 1) : prefixRe('terminal', 1)})?`;
  } else if (kws.length === 2 && ((kws[0] === 'write' && kws[1] === 'memory') || (kws[0] === 'configure' && kws[1] === 'terminal'))) {
    const [a, b] = parts;
    body = `${a}(?:\\s+${b})?`;
  }
  return new RegExp(`(?<![\\w-])${body}(?![\\w./-])`, 'i');
}

export interface ScriptLine {
  line: string;
  /** Level the line is typed at (pass this to iosVariantsRegex / canonicalize) */
  level: IosLevel;
  /** null when the line doesn't parse */
  canonical: string | null;
}

/**
 * Follow an IOS keystroke script (a SolutionStep `ios` list, starting at the `>` prompt) without a
 * world: which level each line is typed at, and its canonical form. Stops after the session leaves.
 */
export function iosScript(lines: string[], start: IosLevel = 'user'): ScriptLine[] {
  const out: ScriptLine[] = [];
  let level: IosLevel | null = start;
  for (const line of lines) {
    if (!level) break;
    const at: IosLevel = level;
    const toks = tokenize(line);
    let r = toks.length ? walk(ROOTS[at], toks, line, { mode: { level: at } }) : null;
    let ranAt: IosLevel = at;
    if (r && !r.ok && (at === 'config-if' || at === 'config-vlan')) {
      const r2 = walk(ROOTS.config, toks, line, { mode: { level: 'config' } });
      if (r2.ok) {
        r = r2;
        ranAt = 'config';
      }
    }
    if (!r?.ok) {
      out.push({ line, level: at, canonical: null });
      continue;
    }
    out.push({ line, level: at, canonical: canonicalOf(r) });
    const head = r.canon[0];
    const cfg: boolean = ranAt === 'config' || ranAt === 'config-if' || ranAt === 'config-vlan';
    if (head === 'enable') level = 'exec';
    else if (head === 'disable') level = 'user';
    else if (head === 'configure') level = 'config';
    else if (head === 'end') level = cfg ? 'exec' : ranAt;
    else if (head === 'exit' || head === 'logout') level = ranAt === 'config' ? 'exec' : cfg ? 'config' : null;
    else if (head === 'interface' && ranAt === 'config') level = 'config-if';
    else if (head === 'vlan' && ranAt === 'config') level = 'config-vlan';
    else level = ranAt;
  }
  return out;
}
