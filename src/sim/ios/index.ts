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
import { maskTip, tip } from './gloss';
import { canonicalOf } from './leak';
import { isConfigLevel, tokenize, visible, walk, type CNode, type Ctx, type Env, type Tok, type Walk } from './parse';
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

/** Exec commands that also run from config modes with `do`. */
const DOABLE = new Set(['show', 'write', 'copy', 'ping', 'clear']);

/** 관리 PC (Linux) commands: typed on a switch, they belong back on the admin PC. */
const LINUX_WORDS = new Set(['curl', 'nslookup', 'dig', 'traceroute', 'tracert', 'tracepath', 'ifconfig', 'docker', 'kubectl', 'k', 'pods', 'nodes', 'deploys', 'svcs', 'dhcp', 'dns', 'lb', 'fw', 'hostname', 'whoami', 'ls', 'cd', 'cat', 'sudo', 'cls']);

/** Commands of one kind of server, typed on a switch: the tip names that server. */
const HOME_TIP: Record<string, 'dnsHost' | 'dhcpHost' | 'lbHost' | 'fwHost'> = { dns: 'dnsHost', dhcp: 'dhcpHost', lb: 'lbHost', fw: 'fwHost' };

const HANGUL = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;

/** The prefix length in `ip address <IP> /24`, `ip address <IP>/24` or `ip address <IP> 24`, else null. */
function slashMask(toks: Tok[]): number | null {
  const t = toks.map((x) => x.s.toLowerCase());
  if (t[0] !== 'ip' || !t[1] || !'address'.startsWith(t[1])) return null;
  for (let i = 2; i < t.length; i++) {
    const m = /^(?:\d{1,3}(?:\.\d{1,3}){3})?\/(\d{1,2})$/.exec(t[i]) ?? (i === 3 ? /^(\d{1,2})$/.exec(t[i]) : null);
    if (m && Number(m[1]) <= 32) return Number(m[1]);
  }
  return null;
}

/** One dim Korean line under "% Invalid input": where the line would work instead, else how to look it up. */
function invalidTip(w: World, host: string, mode: IosMode, line: string, toks: Tok[], r: Walk): string | null {
  const first = toks[0]?.s.toLowerCase() ?? '';
  // The terminal adds its own 한/영 tip for a line typed in Hangul.
  if (HANGUL.test(first)) return null;
  if (first === 'ssh') return tip('ssh');
  if (first === 'help') return tip('help');
  // A command of another server: name the server it belongs on, not just "the 관리 PC".
  const home = HOME_TIP[first];
  if (home) return tip(home);
  if (LINUX_WORDS.has(first) || /^ip\s+(?:a|addr)$/i.test(line.trim())) return tip('linux');
  const at = (level: IosLevel, ifs?: string[]): Walk | null => {
    const r = walk(ROOTS[level], toks, line, envOf(w, host, { level, ...(ifs ? { ifs } : {}) }));
    return r.ok ? r : null;
  };
  const lv = mode.level;
  if (isConfigLevel(lv)) {
    if (first.length >= 2 && 'show'.startsWith(first)) return tip('doShow');
    const ex = at('exec');
    if (ex) {
      const head = ex.canon[0];
      if (head === 'write' || head === 'copy') return tip('doWrite');
      return tip(DOABLE.has(head) ? 'doExec' : 'inConfig');
    }
    if (lv === 'config-if') {
      // A command for another kind of interface (an SVI's standby on a port, a port's switchport on an SVI …).
      if (at('config-if', ['Vlan1'])) return tip('needSvi');
      if (at('config-if', ['Gi1/0/1']) || at('config-if', ['Po1'])) return tip('needPort');
    } else if (at('config-if')) return tip('pickIf');
    if (lv !== 'config-vlan' && at('config-vlan')) return tip('pickVlan');
  } else {
    const user = lv === 'user';
    if (first === 'do') return tip('noDo');
    if (user && at('exec')) return tip('needEnable');
    if (at('config')) return tip(user ? 'needConfigUser' : 'needConfig');
    if (at('config-if')) return tip(user ? 'needIfUser' : 'needIf');
    if (at('config-vlan')) return tip(user ? 'needVlanUser' : 'needVlan');
  }
  // A port was expected and a well-formed name came that this device doesn't have ('gi1/0/40', 'gi 1/0/40').
  const t = toks[r.at]?.s ?? '';
  const portNext = r.next.some((n) => n.arg === 'ifname' || n.arg === 'ifrange');
  if (portNext && (normIf(t) || (/^[a-z-]+$/i.test(t) && normIf(t + (toks[r.at + 1]?.s ?? ''))))) return tip('noSuchPort');
  const n = slashMask(toks);
  return n !== null ? maskTip(n) : tip('invalid');
}

function errorLines(w: World, host: string, mode: IosMode, line: string, r: Walk): string[] {
  const toks = tokenize(line);
  if (r.err === 'ambiguous') return [red(`% Ambiguous command:  "${line.trim()}"`), tip('ambiguous')];
  if (r.err === 'incomplete') {
    if (r.last?.incomplete) return [red(r.last.incomplete), tip(r.last.kw === 'show' ? 'showIncomplete' : 'incomplete')];
    return [red('% Incomplete command.'), tip('incomplete')];
  }
  const col = toks[r.at]?.col ?? line.length;
  const out = [`${' '.repeat(iosPrompt(w, host, mode).length + 1 + col)}^`, red("% Invalid input detected at '^' marker.")];
  const t = invalidTip(w, host, mode, line, toks, r);
  if (t) out.push(t);
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
    if (!pipe) return { lines: [`${' '.repeat(iosPrompt(w, host, mode).length + 1 + bar)}^`, red("% Invalid input detected at '^' marker."), tip('pipe')], mode, events: [], canonical: null };
    base = text.slice(0, bar);
  }
  const { r, mode: runMode } = parseIn(w, host, mode, base);
  if (!r.ok || !r.handler) return { lines: errorLines(w, host, mode, base, r), mode, events: [], canonical: null };

  const c: Ctx = { w, host, nd, day, mode: runMode, a: r.args, out: [], gloss: [], next: runMode, events: [], changed: false };
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
  // A filtered show (`| include …`) prints only the matching lines, without the Korean gloss.
  return { lines: pipe ? applyPipe(c.out, pipe) : [...c.out, ...c.gloss], mode: next, events, canonical };
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
  { short: 'Vlan', long: 'Vlan', help: 'VLAN interface (SVI)' },
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
    return r.err === 'ambiguous' ? [red(`% Ambiguous command:  "${partial.trim()}"`), tip('ambiguous')] : [red('% Unrecognized command'), tip('unrecognized')];
  }
  const nodes = r.next;
  if (!endsSpace) {
    const words = helpRows(nodes, e)
      .map(([k]) => k)
      .filter((k) => k.toLowerCase().startsWith(word));
    if (words.length) return [words.join('  ')];
    // a half-typed argument ('vlan 1?'): show what kind of value goes there
    const args = nodes.filter((n) => n.arg && n.arg !== 'ifname' && visible(n, e)).map((n) => `${n.label ?? n.arg}  ${n.help}`);
    return args.length ? args.map((a) => `  ${a}`) : [red('% Unrecognized command'), tip('unrecognized')];
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

/**
 * The first row of every sheet: which mode the prompt is in and how to move between modes. Its "command"
 * starts with '[' so clicking it types nothing (the side panel cuts a usage at '[' / '<').
 */
export const MODE_LEGEND: Record<IosLevel, [string, string]> = {
  user: ['[지금 모드] >', '일반 모드(보기만) · enable → # 관리자 모드 → conf t → (config)# 설정 모드'],
  exec: ['[지금 모드] #', '관리자 모드(보기·저장) · conf t → (config)# 설정 모드 · exit → 관리 PC로'],
  config: ['[지금 모드] (config)#', '설정 모드(장비 전체) · interface·vlan → 한 단계 안으로 · end → # 관리자 모드'],
  'config-if': ['[지금 모드] (config-if)#', '인터페이스 설정 모드: 고른 것에만 적용 · exit → (config)# · end → #'],
  'config-vlan': ['[지금 모드] (config-vlan)#', 'VLAN 설정 모드: 고른 VLAN에만 적용 · exit → (config)# · end → #'],
};

const SHEET_EXEC: [string, string][] = [
  MODE_LEGEND.exec,
  ['configure terminal', '설정 모드로 (줄여서 conf t)'],
  ['show interfaces status', '포트 상태 한눈에 (sh int status)'],
  ['show ip interface brief', '포트별 IP와 up/down (sh ip int br)'],
  ['show vlan brief', 'VLAN과 포트 (sh vlan br)'],
  ['show interfaces trunk', 'trunk 포트와 실어 나르는 VLAN 목록 (sh int trunk)'],
  ['show interfaces counters errors', '포트별 오류 수 (sh int count err)'],
  ['show etherchannel summary', '포트 묶음 상태 (sh eth sum)'],
  ['show standby brief', 'HSRP Active/Standby (sh standby br)'],
  ['show spanning-tree', '루프 방지 상태 (sh span)'],
  ['show logging', '장비 로그 (sh log)'],
  ['show running-config', '지금 설정 전체 (sh run)'],
  ['ping <IP>', '응답 확인 (! 성공 . 실패)'],
  ['write memory', '설정 저장 (wr)'],
  ['exit', '장비에서 나가기'],
];

/** Mode-aware cheat sheet for the terminal side panel: [command, Korean gloss]. */
export function iosCheatSheet(mode: IosMode): [string, string][] {
  const ifs = mode.ifs ?? [];
  switch (mode.level) {
    case 'user':
      return [
        MODE_LEGEND.user,
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
        MODE_LEGEND.config,
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
        MODE_LEGEND['config-vlan'],
        ['name <이름>', 'VLAN 이름 붙이기'],
        ['exit', 'config 모드로'],
        ['end', '관리자 모드(#)로'],
        ['do show vlan brief', 'VLAN 확인'],
      ];
    case 'config-if':
      if (ifs.length && ifs.every(isSviKey)) {
        return [
          MODE_LEGEND['config-if'],
          ['ip address <IP> <마스크>', '이 VLAN에서 이 스위치 자신의 주소 (게이트웨이 아님 · 마스크 예: 255.255.255.0 = /24)'],
          ['standby 1 ip <가상 IP>', '모두가 쓰는 공용 게이트웨이 주소(.1) · 두 코어가 나눠 맡는 가상 IP (HSRP)'],
          ['standby 1 priority <N>', '높은 쪽이 Active (기본 100)'],
          ['standby 1 preempt', 'Active 되찾아 오기'],
          ['ip helper-address <IP>', 'DHCP 요청을 서버로 전달'],
          ['no shutdown', '인터페이스 켜기'],
          ['do show standby brief', 'HSRP 확인'],
          ['end', '관리자 모드(#)로'],
        ];
      }
      return [
        MODE_LEGEND['config-if'],
        ['switchport mode access', '서버·PC용 포트로 (VLAN 하나)'],
        ['switchport access vlan <N>', '이 포트를 VLAN N에 넣기'],
        ['switchport mode trunk', '스위치 간 포트로 (VLAN 여러 개)'],
        ['switchport trunk allowed vlan add <N>', 'trunk에 VLAN 더하기'],
        ['channel-group <N> mode active', '포트 묶기 (LACP) · N = 이 장비의 묶음 번호: 이미 쓰는 번호면 그 묶음에 들어가요, 새 묶음은 안 쓰는 번호로'],
        ['shutdown', '포트 끄기'],
        ['no shutdown', '포트 켜기'],
        ['description <메모>', '포트 메모'],
        ['do show interfaces status', '포트 상태 확인'],
        ['end', '관리자 모드(#)로'],
      ];
  }
}
