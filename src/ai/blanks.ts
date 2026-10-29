// The shape of a fix command with its answer values left blank: 'switchport access vlan 20' →
// 'switchport access vlan <번호>', 'dns add db 10.10.20.11' → 'dns add <이름> <IP>'.
// The AI 사수 (쿠사수) may show these shapes; the player still has to find the values. Shared by the hint
// Worker and the client's fallback answer, so both speak the same shapes.
import type { Scenario } from '../sim/scenario';
import { iosScript } from '../sim/ios';
import { parseText } from '../sim/ios/leak';
import type { ArgKind } from '../sim/ios/parse';
import type { IosLevel } from '../sim/types';
import { ALL_COMMANDS } from '../sim/commands';

// ---------- IOS ----------

/** Lines that only move between modes or save: they carry no answer, so a shape leaves them out. */
const IOS_NAVIGATION = new Set(['enable', 'disable', 'configure terminal', 'end', 'exit', 'logout', 'write memory', 'copy running-config startup-config']);

const IOS_BLANK: Record<ArgKind, string> = {
  int: '<번호>',
  vlan: '<번호>',
  vlanList: '<번호>',
  ifname: '<포트>',
  ifrange: '<포트 범위>',
  ip: '<IP>',
  mask: '<마스크>',
  word: '<이름>',
  line: '<내용>',
};

/** One IOS line typed at `level`, keywords in full and every argument blank. Unparseable lines come back as typed. */
export function blankIos(line: string, level: IosLevel): string {
  const r = parseText(line, level);
  if (!r?.ok) return line.trim();
  return r.path
    .map((p) => {
      const { kw, arg } = p.node;
      if (kw) return kw;
      if (arg === 'ifname') {
        // The SVI and the bundle keep their kind: 'interface vlan <번호>', 'interface port-channel <번호>'.
        if (p.canon.startsWith('Vlan')) return 'vlan <번호>';
        if (p.canon.startsWith('Po')) return 'port-channel <번호>';
      }
      return arg ? IOS_BLANK[arg] : p.canon;
    })
    .join(' ');
}

// ---------- shell ----------

type Slot =
  | { kind: 'lit'; word: string }
  | { kind: 'blank'; label: string }
  | { kind: 'kv' }
  | { kind: 'flag'; flag: string; spec: string | null };

/** '<이름>' → '이름', 'KEY=VALUE' and choices stay as they are. */
const unwrap = (tok: string) => tok.replace(/^<(.*)>$/, '$1');

function slotsOf(usage: string): Slot[] {
  return (usage.match(/\[[^\]]*\]|<[^>]*>|\S+/g) ?? []).map((tok): Slot => {
    if (tok.startsWith('[')) {
      const [flag = '', ...rest] = tok.slice(1, -1).trim().split(/\s+/);
      return { kind: 'flag', flag, spec: rest.length ? rest.join(' ') : null };
    }
    if (tok.startsWith('<')) return { kind: 'blank', label: unwrap(tok) };
    if (tok === 'KEY=VALUE') return { kind: 'kv' };
    // 'single|multi', 'api|db': choosing is the answer, so it stays a blank listing the choices.
    if (tok.includes('|')) return { kind: 'blank', label: tok };
    return { kind: 'lit', word: tok };
  });
}

/**
 * Every form a usage line describes: 'lb health set path <경로> | port <포트>' is two forms, the second
 * continuing the first ('lb health set port <포트>').
 */
function usageForms(usage: string): string[] {
  const alts = usage.split(' | ');
  const first = alts[0].split(/\s+/);
  return alts.map((alt) => {
    const words = alt.split(/\s+/);
    if (words[0] === first[0]) return alt;
    return [...first.slice(0, Math.max(0, first.length - words.length)), ...words].join(' ');
  });
}

/** A flag's value spec as blanks: '바깥포트:안쪽포트' → '<바깥포트>:<안쪽포트>', '볼륨:/폴더' → '<볼륨>:<폴더>'. */
const specBlank = (spec: string) =>
  spec
    .split(':')
    .map((p) => `<${p.replace(/^\//, '')}>`)
    .join(':');

const FORMS: Slot[][] = ALL_COMMANDS.flatMap((c) => usageForms(c.usage).map(slotsOf));

/** How many leading words of `toks` the form spells out literally. */
function literalHead(form: Slot[], toks: string[]): number {
  let n = 0;
  while (n < form.length && n < toks.length) {
    const s = form[n];
    if (s.kind !== 'lit' || s.word !== toks[n]) break;
    n++;
  }
  return n;
}

/**
 * One shell command with its arguments blank, from the command's usage line: literal words and flags stay,
 * every value becomes the usage's label ('kubectl drain n1' → 'kubectl drain <노드>',
 * 'env set enroll DB_POOL=10' → 'env set <앱> DB_POOL=<값>').
 */
export function blankShell(cmd: string): string {
  const all = cmd.trim().split(/\s+/).filter(Boolean);
  const prefix: string[] = [];
  while (all.length && ['sudo', 'kubectl', 'k'].includes(all[0])) prefix.push(all.shift()!);
  let best: Slot[] | null = null;
  let head = 0;
  for (const form of FORMS) {
    const n = literalHead(form, all);
    if (n > head) [best, head] = [form, n];
  }
  if (!best) return cmd.trim();
  const out = all.slice(0, head);
  const rest = best.slice(head);
  const flags = rest.filter((s): s is Extract<Slot, { kind: 'flag' }> => s.kind === 'flag');
  const positional = rest.filter((s) => s.kind !== 'flag');
  for (let i = head; i < all.length; i++) {
    const tok = all[i];
    const next = positional[0];
    if (next?.kind === 'lit' && next.word === tok) {
      out.push(tok);
      positional.shift();
      continue;
    }
    const flag = tok.startsWith('-') ? flags.find((f) => f.flag === tok) : undefined;
    if (flag) {
      out.push(tok);
      if (flag.spec && i + 1 < all.length) {
        out.push(specBlank(flag.spec));
        i++;
      }
      continue;
    }
    if (tok.startsWith('-')) {
      out.push(tok);
      continue;
    }
    positional.shift();
    const kv = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(tok);
    if (kv) out.push(`${kv[1]}=<값>`);
    else if (next?.kind === 'blank') out.push(`<${next.label}>`);
    else out.push('<값>');
  }
  return [...prefix, ...out].join(' ');
}

// ---------- a scenario's fix ----------

export interface FixShape {
  /** Hosts the lines are typed on (several when they need the same lines) */
  hosts: string[];
  lines: string[];
}

/**
 * The fix of a scenario as blank shapes, per host: navigation left out, repeats folded
 * (two ports bundled the same way are one 'interface <포트> → channel-group <번호> mode active').
 * Mini-game and NOC-button steps have no command, so they don't show up here.
 */
export function fixShapes(sc: Pick<Scenario, 'solutionSteps'>): FixShape[] {
  const byHost = new Map<string, string[]>();
  const add = (host: string, line: string) => {
    const lines = byHost.get(host) ?? [];
    if (!lines.includes(line)) lines.push(line);
    byHost.set(host, lines);
  };
  for (const step of sc.solutionSteps) {
    if ('ios' in step) {
      for (const l of iosScript(step.ios)) {
        if (l.canonical && IOS_NAVIGATION.has(l.canonical)) continue;
        add(step.host, l.canonical ? blankIos(l.canonical, l.level) : l.line.trim());
      }
    } else if ('cmd' in step) add(step.host, blankShell(step.cmd));
  }
  const shapes: FixShape[] = [];
  for (const [host, lines] of byHost) {
    const same = shapes.find((s) => s.lines.join('\n') === lines.join('\n'));
    if (same) same.hosts.push(host);
    else shapes.push({ hosts: [host], lines });
  }
  return shapes;
}
