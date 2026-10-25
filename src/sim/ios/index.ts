// Cisco-IOS-style CLI for switches and routers (CORE-01#, TOR-01(config-if)# …).
// Parser: per token, exact keyword → unique prefix → "% Ambiguous command" → typed arguments →
// "% Invalid input detected at '^' marker." / "% Incomplete command.". `no`, `do`, Ctrl+Z, `?`, Tab.
// WP2 owns src/sim/ios/*. This file is the contract the terminal, the command layer and the AI leak
// guard build against.
import { dim } from '../commands/types';
import { normIf } from '../net/ifname';
import type { DayId, IosLevel, IosMode, World } from '../types';
import { own } from '../util';
import { isPoKey, isSviKey, logConfigured, red } from './config';
import { canonicalOf } from './leak';
import { isConfigLevel, tokenize, visible, walk, type CNode, type Ctx, type Env, type Walk } from './parse';
import { ROOTS } from './tree';

export type { IosLevel, IosMode };
export { canonicalize, iosScript, iosVariantsRegex, type ScriptLine } from './leak';

export interface IosResult {
  /** Output. Error lines (the ones starting with '%') are wrapped in red (\x1b[31m…\x1b[0m) like the shell's errors. */
  lines: string[];
  /** Mode after the line. null = the session left the device (exit / logout at exec on an ssh session). */
  mode: IosMode | null;
  /** Events for objectives/scenarios: `ios:<deviceId>:<canonical command>` (e.g. 'ios:TOR-01:show vlan brief') */
  events: string[];
  /** The fully expanded command (`sh ip int br` → 'show ip interface brief'), null if it didn't parse */
  canonical: string | null;
}

export const USER_MODE: IosMode = { level: 'user' };

const SUFFIX: Record<IosLevel, string> = {
  user: '>',
  exec: '#',
  config: '(config)#',
  'config-if': '(config-if)#',
  'config-vlan': '(config-vlan)#',
};

/** 'CORE-01(config-if)#' */
export function iosPrompt(w: World, host: string, mode: IosMode): string {
  const name = own(w.devices, host)?.label ?? host;
  return `${name}${SUFFIX[mode.level]}`;
}

function envOf(w: World, host: string, mode: IosMode): Env {
  return { w, host, nd: own(w.devices, host)?.nd, mode };
}

/** Parse at the mode's level; a failing config-if / config-vlan line is retried at config level (IOS does the same). */
function parseIn(w: World, host: string, mode: IosMode, line: string): { r: Walk; mode: IosMode } {
  const toks = tokenize(line);
  const r = walk(ROOTS[mode.level], toks, line, envOf(w, host, mode));
  if (r.ok || r.err === 'ambiguous' || (mode.level !== 'config-if' && mode.level !== 'config-vlan')) return { r, mode };
  const up: IosMode = { level: 'config', ...(mode.changed ? { changed: true } : {}) };
  const r2 = walk(ROOTS.config, toks, line, envOf(w, host, up));
  if (r2.ok) return { r: r2, mode: up };
  // Report whichever got further.
  return { r: r2.at > r.at ? r2 : r, mode };
}

const EXEC_ONLY = ['configure', 'write', 'copy', 'clear', 'disable', 'running-config', 'startup-config'];

function errorLines(w: World, host: string, mode: IosMode, line: string, r: Walk): string[] {
  const toks = tokenize(line);
  if (r.err === 'ambiguous') return [red(`% Ambiguous command:  "${line.trim()}"`)];
  if (r.err === 'incomplete') return [red(r.last?.incomplete ?? '% Incomplete command.')];
  const col = toks[r.at]?.col ?? line.length;
  const out = [`${' '.repeat(iosPrompt(w, host, mode).length + 1 + col)}^`, red("% Invalid input detected at '^' marker.")];
  const first = toks[0]?.s.toLowerCase() ?? '';
  if (isConfigLevel(mode.level) && first.length >= 2 && 'show'.startsWith(first)) {
    out.push(dim('(설정 모드에서는 show 앞에 do 를 붙여요: do show …)'));
  } else if (mode.level === 'user' && toks.some((t) => EXEC_ONLY.some((k) => k.startsWith(t.s.toLowerCase()) && t.s.length >= 2))) {
    out.push(dim('(이 명령은 관리자 모드(#)에서 써요. 먼저 enable)'));
  }
  return out;
}

/**
 * Run one line on network device `host` in `mode`. Mutates `w` (the caller passes a copy).
 * Config changes set nd.dirty and log %SYS-5-CONFIG_I when leaving config mode.
 */
export function runIos(line: string, w: World, host: string, mode: IosMode, day: DayId): IosResult {
  const nd = own(w.devices, host)?.nd;
  const text = line.replace(/\t/g, ' ');
  if (!text.trim()) return { lines: [], mode, events: [], canonical: null };
  if (!nd) return { lines: [red('% Not a network device')], mode, events: [], canonical: null };
  // A line submitted with a trailing '?' is a help request.
  if (text.trimEnd().endsWith('?')) return { lines: iosHelp(w, host, mode, text.trimEnd().slice(0, -1)), mode, events: [], canonical: null };

  // `show … | include X` (and exclude / begin / section)
  let base = text;
  let pipe: Pipe | null = null;
  const bar = text.indexOf('|');
  if (bar >= 0 && /^(do )?show /.test(parseIn(w, host, mode, text.slice(0, bar)).r.canon.join(' ') + ' ')) {
    pipe = parsePipe(text.slice(bar + 1));
    if (!pipe) return { lines: [`${' '.repeat(iosPrompt(w, host, mode).length + 1 + bar)}^`, red("% Invalid input detected at '^' marker.")], mode, events: [], canonical: null };
    base = text.slice(0, bar);
  }
  const { r, mode: runMode } = parseIn(w, host, mode, base);
  if (!r.ok || !r.handler) return { lines: errorLines(w, host, mode, base, r), mode, events: [], canonical: null };

  const c: Ctx = { w, host, nd, day, mode: runMode, a: r.args, out: [], next: runMode, events: [], changed: false };
  r.handler(c);
  let next = c.next;
  if (next && c.changed && isConfigLevel(next.level) && !next.changed) next = { ...next, changed: true };
  const wasConfig = isConfigLevel(mode.level);
  const leaving = wasConfig && (next === null || !isConfigLevel(next.level));
  if (leaving && (mode.changed || c.changed)) logConfigured(c);
  if (next && !isConfigLevel(next.level) && next.changed) next = { level: next.level };

  const canonical = canonicalOf(r);
  const events = [`ios:${host}:${canonical}`, ...c.events];
  if (canonical.startsWith('do ')) events.push(`ios:${host}:${canonical.slice(3)}`);
  if (canonical.endsWith('copy running-config startup-config')) events.push(`ios:${host}:write memory`);
  return { lines: pipe ? applyPipe(c.out, pipe) : c.out, mode: next, events, canonical };
}

type Pipe = { kind: 'include' | 'exclude' | 'begin' | 'section'; re: RegExp };

function parsePipe(s: string): Pipe | null {
  const m = /^\s*(\S+)\s+(.*\S)\s*$/.exec(s);
  if (!m) return null;
  const kinds = (['include', 'exclude', 'begin', 'section'] as const).filter((k) => k.startsWith(m[1].toLowerCase()));
  if (kinds.length !== 1) return null;
  let re: RegExp;
  try {
    re = new RegExp(m[2]);
  } catch {
    re = new RegExp(m[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  }
  return { kind: kinds[0], re };
}

function applyPipe(lines: string[], p: Pipe): string[] {
  const plain = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''));
  const hit = (i: number) => p.re.test(plain[i]);
  if (p.kind === 'include') return lines.filter((_, i) => hit(i));
  if (p.kind === 'exclude') return lines.filter((_, i) => !hit(i));
  if (p.kind === 'begin') {
    const i = plain.findIndex((_, j) => hit(j));
    return i < 0 ? [] : lines.slice(i);
  }
  // section: a matching top-level line and the indented lines under it
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (plain[i].startsWith(' ') || !hit(i)) continue;
    out.push(lines[i]);
    for (let j = i + 1; j < lines.length && plain[j].startsWith(' '); j++) out.push(lines[j]);
  }
  return out;
}

// ---------- ? and Tab ----------

const IF_KINDS: { short: string; long: string; help: string }[] = [
  { short: 'Gi', long: 'GigabitEthernet', help: 'GigabitEthernet IEEE 802.3z' },
  { short: 'Te', long: 'TenGigabitEthernet', help: 'Ten Gigabit Ethernet' },
  { short: 'Hu', long: 'HundredGigE', help: 'Hundred GigabitEthernet' },
  { short: 'Po', long: 'Port-channel', help: 'Ethernet Channel of interfaces' },
  { short: 'Vlan', long: 'Vlan', help: 'Catalyst Vlans' },
];

/** Interface kinds this device has (plus Po/Vlan, which can be created). */
function ifKinds(e: Env) {
  const keys = [...Object.keys(e.nd?.ifs ?? {}), 'Po1', 'Vlan1'];
  return IF_KINDS.filter((k) => keys.some((x) => x.startsWith(k.short) && (k.short !== 'Vlan' || isSviKey(x)) && (k.short !== 'Po' || isPoKey(x))));
}

/** `?` rows like IOS: argument placeholders first, then keywords in alphabetical order. */
function helpRows(nodes: CNode[], e: Env): [string, string, string][] {
  const args: [string, string, string][] = [];
  const kws: [string, string, string][] = [];
  for (const n of nodes) {
    if (!visible(n, e) || n.exact) continue;
    if (n.arg === 'ifname') for (const k of ifKinds(e)) kws.push([k.long, k.help, n.ko]);
    else if (n.arg) args.push([n.label ?? n.arg, n.help, n.ko]);
    else kws.push([n.kw!, n.help, n.ko]);
  }
  return [...args, ...kws.sort((a, b) => a[0].localeCompare(b[0]))];
}

/** `?` help for the half-typed line: `foo?` lists keywords starting with foo; `foo ?` lists what can come next. */
export function iosHelp(w: World, host: string, mode: IosMode, partial: string): string[] {
  const e = envOf(w, host, mode);
  const endsSpace = partial === '' || /\s$/.test(partial);
  const toks = tokenize(partial);
  const done = endsSpace ? toks : toks.slice(0, -1);
  const word = endsSpace ? '' : toks[toks.length - 1].s.toLowerCase();
  const doneText = done.length ? partial.slice(0, done[done.length - 1].col + done[done.length - 1].s.length) : '';
  const r = walk(ROOTS[mode.level], done, doneText, e);
  if (!r.ok && r.err !== 'incomplete') {
    // 'interface gi ?' — an interface type waiting for its number
    if (r.err === 'invalid' && r.at === done.length - 1 && r.next.some((n) => n.arg === 'ifname') && /^[a-z-]+$/i.test(done[r.at].s) && normIf(`${done[r.at].s}1/0/1`)) {
      return endsSpace ? ['  <1-9>    Interface number'] : ['% Unrecognized command'];
    }
    return [red(r.err === 'ambiguous' ? `% Ambiguous command:  "${partial.trim()}"` : '% Unrecognized command')];
  }
  const nodes = r.next;
  if (!endsSpace) {
    const words = helpRows(nodes, e)
      .map(([k]) => k)
      .filter((k) => k.toLowerCase().startsWith(word));
    if (words.length) return [words.join('  ')];
    // a half-typed argument ('vlan 1?'): show what kind of value goes there
    const args = nodes.filter((n) => n.arg && n.arg !== 'ifname' && visible(n, e)).map((n) => `${n.label ?? n.arg}  ${n.help}`);
    return args.length ? args.map((a) => `  ${a}`) : [red('% Unrecognized command')];
  }
  const rows = helpRows(nodes, e);
  const width = Math.max(10, ...rows.map(([k]) => k.length)) + 2;
  const out = rows.map(([k, help, ko]) => `  ${k.padEnd(width)}${help}${ko ? `  ${dim(ko)}` : ''}`);
  if (r.ok && r.handler) out.push('  <cr>');
  return out;
}

/** Tab completion: the line with its last word completed (plus a space), or null when not unique. */
export function iosComplete(w: World, host: string, mode: IosMode, partial: string): string | null {
  if (!partial.trim() || /\s$/.test(partial)) return null;
  const toks = tokenize(partial);
  const done = toks.slice(0, -1);
  const last = toks[toks.length - 1];
  const doneText = partial.slice(0, last.col);
  const word = last.s.toLowerCase();
  const tryAt = (m: IosMode): string[] | null => {
    const e = envOf(w, host, m);
    const r = walk(ROOTS[m.level], done, doneText, e);
    if (!r.ok && r.err !== 'incomplete') return null;
    const kws = r.next.filter((n) => n.kw && visible(n, e) && !n.exact).map((n) => n.kw!);
    return kws.includes(word) ? [word] : kws.filter((k) => k.startsWith(word));
  };
  let hits = tryAt(mode);
  // Like IOS, a word that isn't a sub-mode command completes from config mode.
  if (!hits?.length && (mode.level === 'config-if' || mode.level === 'config-vlan')) hits = tryAt({ level: 'config' });
  if (!hits || hits.length !== 1) return null;
  return `${doneText}${hits[0]} `;
}

// ---------- cheat sheet ----------

const SHEET_EXEC: [string, string][] = [
  ['configure terminal', '설정 모드로 (줄여서 conf t)'],
  ['show interfaces status', '포트 상태 한눈에 (sh int status)'],
  ['show ip interface brief', '포트별 IP와 up/down (sh ip int br)'],
  ['show vlan brief', 'VLAN과 포트 (sh vlan br)'],
  ['show interfaces counters errors', '포트별 오류 수 (sh int count err)'],
  ['show etherchannel summary', '포트 묶음 상태 (sh eth sum)'],
  ['show standby brief', 'HSRP Active/Standby (sh standby br)'],
  ['show spanning-tree', '루프 방지 상태 (sh span)'],
  ['show logging', '장비 로그 (sh log)'],
  ['show running-config', '지금 설정 전체 (sh run)'],
  ['write memory', '설정 저장 (wr)'],
  ['exit', '장비에서 나가기'],
];

/** Mode-aware cheat sheet for the terminal side panel: [command, Korean gloss]. */
export function iosCheatSheet(mode: IosMode): [string, string][] {
  const ifs = mode.ifs ?? [];
  switch (mode.level) {
    case 'user':
      return [
        ['enable', '관리자 모드(#)로 (줄여서 en)'],
        ['show interfaces status', '포트 상태 한눈에 (sh int status)'],
        ['show ip interface brief', '포트별 IP와 up/down (sh ip int br)'],
        ['show vlan brief', 'VLAN과 포트 (sh vlan br)'],
        ['ping <IP>', '응답 확인 (! 성공 . 실패)'],
        ['exit', '장비에서 나가기'],
        ['?', '지금 쓸 수 있는 명령 보기 (예: show ?)'],
        ['Tab', '명령어 자동 완성'],
      ];
    case 'exec':
      return SHEET_EXEC;
    case 'config':
      return [
        ['interface <포트>', '포트 설정하러 (int gi1/0/5)'],
        ['interface vlan <N>', 'VLAN의 게이트웨이(SVI) 설정하러'],
        ['vlan <N>', 'VLAN 만들기'],
        ['spanning-tree vlan <N>', 'VLAN에 루프 방지(STP) 켜기'],
        ['no <명령>', '설정 되돌리기'],
        ['do show …', '설정 모드에서 show 쓰기'],
        ['end', '관리자 모드(#)로 (Ctrl+Z)'],
        ['exit', '한 단계 위로'],
      ];
    case 'config-vlan':
      return [
        ['name <이름>', 'VLAN 이름 붙이기'],
        ['exit', 'config 모드로'],
        ['end', '관리자 모드(#)로'],
        ['do show vlan brief', 'VLAN 확인'],
      ];
    case 'config-if':
      if (ifs.length && ifs.every(isSviKey)) {
        return [
          ['ip address <IP> <마스크>', '이 VLAN의 게이트웨이 주소'],
          ['standby 1 ip <가상 IP>', 'HSRP 가상 게이트웨이 주소'],
          ['standby 1 priority <N>', '높은 쪽이 Active (기본 100)'],
          ['standby 1 preempt', 'Active 되찾아 오기'],
          ['ip helper-address <IP>', 'DHCP 요청을 서버로 전달'],
          ['no shutdown', '인터페이스 켜기'],
          ['do show standby brief', 'HSRP 확인'],
          ['end', '관리자 모드(#)로'],
        ];
      }
      return [
        ['switchport mode access', '서버·PC용 포트로 (VLAN 하나)'],
        ['switchport access vlan <N>', '이 포트를 VLAN N에 넣기'],
        ['switchport mode trunk', '스위치 간 포트로 (VLAN 여러 개)'],
        ['switchport trunk allowed vlan add <N>', 'trunk에 VLAN 더하기'],
        ['channel-group <N> mode active', '포트 묶기 (LACP)'],
        ['shutdown', '포트 끄기'],
        ['no shutdown', '포트 켜기'],
        ['description <메모>', '포트 메모'],
        ['do show interfaces status', '포트 상태 확인'],
        ['end', '관리자 모드(#)로'],
      ];
  }
}
