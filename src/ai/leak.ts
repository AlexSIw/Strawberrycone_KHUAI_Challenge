// Answer-leak guard for the AI 사수 (쿠사수): which strings in a reply would give the answer away.
// Shared by the hint Worker (worker/src/index.ts) and the tests (tests/leak.test.ts).
//
// Banned:
//  - the scenario's bannedPhrases;
//  - every multi-word shell solution command, and the exact values in it (IPs, CIDRs, port pairs, KEY=VALUE);
//  - IOS solution lines (`{ ios: [...] }` steps) in every abbreviated form, via iosVariantsRegex, when they
//    carry a value (VLAN number, IP, interface name …) or change config. Pure navigation (enable,
//    configure terminal, end, exit, write memory) and value-less show commands are fine to mention,
//    unless the scenario lists them in `bannedIos`;
//  - the values in those IOS lines on their own: IPs/CIDRs, interface names in any form ('Gi1/0/5',
//    'gi 1/0/5', 'GigabitEthernet1/0/5', '1/0/5'), and VLAN numbers ('VLAN 20', 'vlan20', '20번 VLAN').
// A MISSION answer (the radio's mission mode) is held to the same for every incident going on, minus what the
// mission itself shows on screen (missionBanned).
import type { Objective } from '../content/types';
import { canonicalize, iosVariantsRegex } from '../sim/ios';
import { normIf } from '../sim/net/ifname';
import type { Scenario } from '../sim/scenario';
import type { IosLevel } from '../sim/types';

export const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ');

export const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const IP = String.raw`\d{1,3}(?:\.\d{1,3}){3}`;
const IP_RE = new RegExp(`^${IP}$`);
const CIDR_RE = new RegExp(`^${IP}/\\d{1,2}$`);

/**
 * Exact answer values inside a solution command: IPs (10.0.1.20), CIDRs (198.51.100.0/24), port pairs
 * (80:8000) and KEY=VALUE settings. On their own they already give the answer away.
 */
export const VALUE_TOKEN = new RegExp(`^(?:${IP}(?:/\\d{1,2})?|\\d+:\\d+|[a-z_][a-z0-9_]*=\\S+)$`, 'i');

/**
 * Phrases are matched as substrings, with two kinds of edges:
 * - a phrase starting/ending with a digit must not continue into more digits
 *   (banning 10.0.1.1 must not block a reply that mentions 10.0.1.10);
 * - a leading/trailing space in a bannedPhrase means "word edge": '/enrol ' blocks "/enrol)" and
 *   "/enrol이" but not the correct "/enroll".
 */
export function phraseRe(raw: string): RegExp {
  const p = raw.trim();
  const head = /^\s/.test(raw) ? '(?<![a-z0-9_])' : /^\d/.test(p) ? '(?<![\\d.])' : '';
  const tail = /\s$/.test(raw) ? '(?![a-z0-9_])' : /\d$/.test(p) ? '(?!\\d)' : '';
  return new RegExp(head + escapeRe(p) + tail);
}

/** The value phrases of one token: the token, and the bare address of a CIDR. */
function valuePhrases(tok: string): string[] {
  if (!VALUE_TOKEN.test(tok)) return [];
  return CIDR_RE.test(tok) ? [tok, tok.slice(0, tok.indexOf('/'))] : [tok];
}

// ---------- IOS ----------

/** Lines that only move between modes or save: harmless to mention (the hints teach them). */
const NAVIGATION = new Set([
  'enable',
  'disable',
  'configure terminal',
  'end',
  'exit',
  'logout',
  'write',
  'write memory',
  'copy running-config startup-config',
]);

/** Is `tok` an abbreviation of `word` at least `min` letters long? */
const abbr = (tok: string, word: string, min: number) => tok.length >= min && word.startsWith(tok);

/**
 * Expansion of the lines the guard has to understand on its own (mode changes, saving), for when the
 * IOS parser can't canonicalize a line. Anything else comes back as typed (lower case, single spaces).
 */
function roughCanonical(line: string): string {
  const t = normalize(line.trim()).split(' ');
  const [a = '', b = ''] = t;
  if (t.length === 1 && abbr(a, 'enable', 2)) return 'enable';
  if (t.length === 1 && abbr(a, 'disable', 4)) return 'disable';
  if (t.length === 2 && abbr(a, 'configure', 3) && abbr(b, 'terminal', 1)) return 'configure terminal';
  if (t.length === 1 && a === 'end') return 'end';
  if (t.length === 1 && abbr(a, 'exit', 2)) return 'exit';
  if (t.length === 1 && abbr(a, 'logout', 4)) return 'logout';
  if (t.length === 1 && abbr(a, 'write', 2)) return 'write';
  if (t.length === 2 && abbr(a, 'write', 2) && abbr(b, 'memory', 1)) return 'write memory';
  if (t.length === 3 && abbr(a, 'copy', 2) && abbr(b, 'running-config', 3) && abbr(t[2], 'startup-config', 3)) return 'copy running-config startup-config';
  if (abbr(a, 'interface', 2) && t.length > 1) return `interface ${normIf(t.slice(1).join('')) ?? t.slice(1).join(' ')}`;
  if (abbr(a, 'vlan', 2) && /^\d+$/.test(b) && t.length === 2) return `vlan ${b}`;
  return t.join(' ');
}

const CONFIG_LEVELS: IosLevel[] = ['config', 'config-if', 'config-vlan'];

/** The mode a line leaves the session in (only what the guard needs: no errors, no `do`). */
function nextLevel(canonical: string, level: IosLevel): IosLevel {
  const inConfig = CONFIG_LEVELS.includes(level);
  if (canonical.startsWith('do ')) return level;
  if (canonical === 'enable' && level === 'user') return 'exec';
  if (canonical === 'disable' && level === 'exec') return 'user';
  if (canonical === 'configure terminal' && level === 'exec') return 'config';
  if (canonical === 'end' && inConfig) return 'exec';
  if (canonical === 'exit') return level === 'config-if' || level === 'config-vlan' ? 'config' : level === 'config' ? 'exec' : 'user';
  if (inConfig && canonical.startsWith('interface ')) return 'config-if';
  if (inConfig && /^vlan \d+$/.test(canonical)) return 'config-vlan';
  return level;
}

export interface IosScriptLine {
  /** As written in the solution */
  line: string;
  /** Mode it is typed in */
  level: IosLevel;
  /** Fully expanded ('sw acc vl 20' → 'switchport access vlan 20') */
  canonical: string;
}

const canon = (line: string, level: IosLevel) => canonicalize(line, level) ?? roughCanonical(line);

/** Walk an IOS keystroke script from the `>` prompt, tracking the mode each line is typed in. */
export function iosScript(lines: string[], start: IosLevel = 'user'): IosScriptLine[] {
  let level = start;
  return lines.map((line) => {
    const canonical = canon(line, level);
    const out = { line, level, canonical };
    level = nextLevel(canonical, level);
    return out;
  });
}

/** Does this line give the fix away? Values (VLAN, IP, interface…) or a config change, but not navigation. */
export function iosLineBanned(l: IosScriptLine): boolean {
  if (NAVIGATION.has(l.canonical)) return false;
  return /\d/.test(l.canonical) || CONFIG_LEVELS.includes(l.level);
}

/** A regex for an interface name in any spelling: 'Gi1/0/5', 'gi 1/0/5', '1/0/5', 'Po1', 'port-channel 1', 'vlan10'. */
export function ifValueRe(short: string): RegExp {
  const m = /^([A-Za-z]+)(\d+(?:\/\d+)*)$/.exec(short);
  if (!m) return phraseRe(short.toLowerCase());
  const [, kind, num] = m;
  // Slot/port numbers are distinctive on their own, whatever the prefix.
  if (num.includes('/')) return new RegExp(`(?<![\\d/])${escapeRe(num)}(?![\\d/])`);
  if (kind === 'Po') return new RegExp(`(?<![a-z0-9])(?:po|port-?channel)\\s*-?\\s*${num}(?!\\d)`);
  if (kind === 'Vlan') return vlanValueRe(num);
  return new RegExp(`(?<![a-z0-9])${kind.toLowerCase()}\\s*${num}(?!\\d)`);
}

/**
 * A VLAN number either way round: 'VLAN 20', 'vlan20', 'vl 20', 'VLAN20번', '브이랜 20', and number-first
 * '20번 VLAN', '20 VLAN', '20번 브이랜' (the reply is lower-cased before matching). Never 'VLAN 200' or
 * '120번 VLAN'.
 */
export const vlanValueRe = (n: string | number): RegExp =>
  new RegExp(`(?<![a-z0-9])(?:vl(?:an)?|브이랜)\\s*-?\\s*${n}(?!\\d)|(?<![\\d./])${n}\\s*번?\\s*(?:vlan|브이랜)`);

/** The values in one IOS line, as regexes: IPs/CIDRs (not netmasks), interface names, VLAN numbers. */
export function iosValueRes(line: string): RegExp[] {
  const res: RegExp[] = [];
  const toks = normalize(line.trim()).split(' ');
  toks.forEach((tok, i) => {
    if (IP_RE.test(tok) || CIDR_RE.test(tok)) {
      // A netmask (255.255.255.0) is not an answer by itself.
      if (!/^(?:255|0)\./.test(tok)) res.push(...valuePhrases(tok).map(phraseRe));
      return;
    }
    // 'gi1/0/5', or 'gi 1/0/5' over two tokens; never the keyword 'vlan' of 'switchport access vlan 20'.
    const ifn = normIf(tok) ?? (i + 1 < toks.length && /^[a-z-]+$/.test(tok) && !abbr(tok, 'vlan', 1) ? normIf(tok + toks[i + 1]) : null);
    if (ifn) res.push(ifValueRe(ifn));
    if (abbr(tok, 'vlan', 2) && i + 1 < toks.length) {
      for (const n of toks[i + 1].split(/[,-]/)) if (/^\d+$/.test(n)) res.push(vlanValueRe(n));
    }
  });
  return res;
}

/** The level a bannedIos line is most likely typed at: the first one where it parses. */
function guessLevel(line: string): IosLevel {
  for (const level of ['exec', 'config', 'config-if', 'config-vlan', 'user'] as IosLevel[]) if (canonicalize(line, level)) return level;
  const c = roughCanonical(line);
  if (c === 'enable') return 'user';
  if (c === 'end' || c === 'exit') return 'config';
  return 'exec';
}

/** A regex as the guard uses it: no global/sticky state between tests. */
const stateless = (re: RegExp) => (re.global || re.sticky ? new RegExp(re.source, re.flags.replace(/[gy]/g, '')) : re);

// ---------- the guard ----------

/** Everything the 사수 must not say for this scenario. */
export function bannedFor(sc: Pick<Scenario, 'bannedPhrases' | 'solutionSteps' | 'bannedIos'>): RegExp[] {
  const cmds = sc.solutionSteps.flatMap((s) => ('cmd' in s ? [s.cmd.trim()] : []));
  const values = cmds.flatMap((c) => c.split(/\s+/).flatMap(valuePhrases));
  const phrases = [...sc.bannedPhrases, ...cmds.filter((c) => c.includes(' ')), ...values].map(normalize).filter((p) => p.trim() !== '');
  const res = [...new Set(phrases)].map(phraseRe);

  const ios = sc.solutionSteps.flatMap((s) => ('ios' in s ? iosScript(s.ios) : []));
  const lines: IosScriptLine[] = ios.filter(iosLineBanned);
  for (const extra of sc.bannedIos ?? []) {
    const known = ios.find((l) => normalize(l.line.trim()) === normalize(extra.trim()));
    const level = known?.level ?? guessLevel(extra);
    lines.push({ line: extra, level, canonical: canon(extra, level) });
  }
  const seen = new Set<string>();
  for (const l of lines) {
    const key = `${l.level}|${l.canonical}`;
    if (seen.has(key)) continue;
    seen.add(key);
    res.push(stateless(iosVariantsRegex(l.canonical, l.level)));
    // The line as written, too (the parser may not know an abbreviation the content used).
    if (normalize(l.line.trim()) !== l.canonical) res.push(phraseRe(normalize(l.line.trim())));
  }
  for (const l of ios) res.push(...iosValueRes(l.canonical), ...iosValueRes(l.line));
  for (const extra of sc.bannedIos ?? []) res.push(...iosValueRes(extra));
  // Same source and flags = same test.
  const uniq = new Map(res.map((r) => [`${r.flags}/${r.source}`, r]));
  return [...uniq.values()];
}

/** Does the reply contain anything banned? */
export function leaks(reply: string, banned: RegExp[]): boolean {
  const r = ` ${normalize(reply)} `;
  return banned.some((re) => re.test(r));
}

/** Everything a mission shows on screen (its text, why and steps): the radio may repeat it whatever is going on. */
export function missionShown(o: Pick<Objective, 'text' | 'why' | 'steps'>): string[] {
  return [o.text, o.why ?? '', ...(o.steps ?? []).flatMap((s) => [s.text, s.cmd ?? '', s.why ?? ''])].filter(Boolean);
}

/**
 * What the 사수 must not say when answering a question about a MISSION: everything banned for each incident
 * going on (a mission answer never gives an incident away), except what the mission itself already shows on
 * screen (its text, why and steps). Repeating those is no leak, and banning them would leave the mission
 * unexplainable while the incident lasts (D-4: DB-01's address in the DNS mission, during the VLAN incident).
 */
export function missionBanned(active: Pick<Scenario, 'bannedPhrases' | 'solutionSteps' | 'bannedIos'>[], shown: string[]): RegExp[] {
  const screen = ` ${normalize(shown.join(' \n '))} `;
  const uniq = new Map(active.flatMap(bannedFor).map((r) => [`${r.flags}/${r.source}`, r]));
  return [...uniq.values()].filter((re) => !re.test(screen));
}
