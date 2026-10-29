import { iosPrompt, runIos, USER_MODE } from '../ios';
import { syncNet } from '../net/sync';
import { clone } from '../step';
import type { IosMode, StageId, World } from '../types';
import { own } from '../util';
import { dockerCommands } from './docker';
import { infraCommands } from './infra';
import { k8sCommands } from './k8s';
import { netCommands } from './net';
import { svcCommands } from './svc';
import type { Command, CmdResult, HostOs } from './types';
import { bold, dim, err, red } from './types';
import { webCommands } from './web';

/** Terminal width of a string: wide (Hangul/CJK) characters take two cells. */
export function cellWidth(s: string): number {
  let n = 0;
  for (const ch of s) n += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
  return n;
}

export const padCells = (s: string, width: number) => s + ' '.repeat(Math.max(1, width - cellWidth(s)));

/** The CLI a host speaks. */
export function osOf(w: World, host: string): HostOs {
  return own(w.devices, host)?.nd?.os ?? 'linux';
}

const base: Command[] = [
  {
    name: 'help',
    minStage: 0,
    os: ['linux', 'lb', 'fw'],
    usage: 'help',
    summary: '쓸 수 있는 명령어 보기',
    run: (_a, { w, host, stage }) => ({
      lines: [
        bold('쓸 수 있는 명령어'),
        ...available(stage, osOf(w, host)).map((c) => `  ${padCells(c.usage, 40)} ${dim(c.summary)}`),
        dim('막히면 hint를 입력하거나 쿠사수에게 물어보세요.'),
      ],
    }),
  },
  { name: 'clear', aliases: ['cls'], minStage: 0, os: ['linux', 'lb', 'fw'], usage: 'clear', summary: '화면 지우기', run: () => ({ lines: [], clear: true }) },
  { name: 'hint', minStage: 0, os: ['linux', 'lb', 'fw'], usage: 'hint', summary: '쿠사수에게 지금 할 일 묻기 (무료)', run: () => ({ lines: [], hint: true }) },
];

export const ALL_COMMANDS: Command[] = [...base, ...netCommands, ...infraCommands, ...webCommands, ...svcCommands, ...dockerCommands, ...k8sCommands];

/** Where a command that belongs to another kind of host is used. */
const WHERE: Record<HostOs, string> = { linux: '서버', ios: '스위치', lb: 'L4 장비(L4-01, L4-02)', fw: '방화벽(FW-01, FW-02)' };

export function available(stage: StageId, os: HostOs = 'linux'): Command[] {
  const here = ALL_COMMANDS.filter((c) => (c.os ?? ['linux']).includes(os) && c.minStage <= stage && (c.maxStage === undefined || stage <= c.maxStage));
  // One command per name (the first wins, as in match): an appliance has the shell's exit and its own.
  return here.filter((c, i) => here.findIndex((x) => x.name === c.name) === i);
}

/** First words a command answers to: its name's and its aliases' ('get pods' with alias 'pods' → get, pods). */
const heads = (c: Command) => [c.name, ...(c.aliases ?? [])].map((n) => n.split(' ')[0]);

/** Commands that only work on one server: typed elsewhere, the message names it. */
const HOME_HOST: Record<string, string> = { dns: 'DNS 서버(ssh ns1)', dhcp: 'DHCP 서버(ssh dhcp01)' };

/** Longest matching command name wins, so "docker run" beats "docker". */
function match(tokens: string[], stage: StageId, os: HostOs): { cmd: Command; args: string[] } | null {
  let best: { cmd: Command; args: string[]; len: number } | null = null;
  for (const cmd of available(stage, os)) {
    for (const name of [cmd.name, ...(cmd.aliases ?? [])]) {
      const words = name.split(' ');
      if (words.length > tokens.length) continue;
      if (words.every((w, i) => tokens[i] === w) && (!best || words.length > best.len)) {
        best = { cmd, args: tokens.slice(words.length), len: words.length };
      }
    }
  }
  return best;
}

export interface RunOutput extends CmdResult {
  world: World;
}

/**
 * Run one terminal line against a copy of the world. Network gear (os 'ios') goes to the IOS CLI in
 * `mode`; everything else to the shell commands for that host's OS. The network caches and syslog are
 * refreshed after every line.
 */
export function runCommand(line: string, world: World, host: string, stage: StageId, mode?: IosMode | null): RunOutput {
  const os = osOf(world, host);
  if (os === 'ios') {
    // `clear` alone clears the screen on the switch too (as on the 관리 PC; IOS's own clear needs more words).
    if (/^\s*(clear|cls)\s*$/i.test(line)) return { lines: [], clear: true, mode, world };
    // `hint` asks 쿠사수 from any mode, as on the 관리 PC (IOS itself has no such command).
    if (/^\s*hint\s*$/i.test(line)) return { lines: [], hint: true, mode, world };
    const w = clone(world);
    try {
      const res = runIos(line, w, host, mode ?? USER_MODE, stage);
      if (w.net) syncNet(w, 0);
      // Leaving the device (exit at the top) drops back to the admin PC.
      return { lines: res.lines, events: res.events, mode: res.mode, host: res.mode === null ? 'ops' : host, world: w };
    } catch (e) {
      console.error(e);
      return { ...err('% 이 명령을 처리하지 못했어요.'), mode, world };
    }
  }
  let tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens[0] === 'sudo') tokens = tokens.slice(1);
  if (tokens[0] === 'kubectl' || tokens[0] === 'k') tokens = tokens.slice(1);
  if (!tokens.length) return { lines: [], world };
  const m = match(tokens, stage, os);
  if (!m) {
    const same = ALL_COMMANDS.filter((c) => heads(c).includes(tokens[0]) && (c.os ?? ['linux']).includes(os));
    const usable = available(stage, os).filter((c) => c.name.split(' ')[0] === tokens[0]);
    // The word exists today: show its forms instead of claiming it's unavailable.
    if (usable.length) return { lines: [red(`${tokens[0]}: 사용법이 달라요. 이렇게 써보세요:`), ...usable.map((c) => dim(`  ${c.usage}`))], world };
    let msg = `${tokens[0]}: 그런 명령어는 아직 몰라요. help를 쳐보세요.`;
    const elsewhere = ALL_COMMANDS.filter((c) => heads(c).includes(tokens[0]) && !(c.os ?? ['linux']).includes(os) && c.name !== 'exit');
    if (same.length && same.every((c) => c.minStage > stage)) msg = `${tokens[0]}: 이 명령어는 아직 안 열렸어요. 다음 날에 쓸 수 있어요. (help)`;
    else if (same.length) msg = `${tokens[0]}: 오늘은 쓰지 않는 명령어예요. help로 지금 쓸 수 있는 명령어를 보세요.`;
    else if (elsewhere.length) {
      const where = elsewhere[0].os?.[0] ?? 'linux';
      // On an appliance (L4, firewall) a shell command means going back to the 관리 PC, not to "a server".
      const home = own(HOME_HOST, tokens[0]);
      msg =
        where === 'linux' && os !== 'linux'
          ? home
            ? `${tokens[0]}: 이 장비에서 쓰는 명령이 아니에요. exit로 관리 PC(ops)에 돌아간 뒤 ${home}에 접속해서 쓰세요.`
            : `${tokens[0]}: 이 장비에서 쓰는 명령이 아니에요. exit로 관리 PC(ops)에 돌아가서 쓰세요.`
          : `${tokens[0]}: 이 장비에서 쓰는 명령이 아니에요. ${WHERE[where]}에 접속해서 쓰세요.`;
    }
    return { ...err(msg), world };
  }
  const w = clone(world);
  try {
    const res = m.cmd.run(m.args, { w, host, stage, mode });
    if (w.net) syncNet(w, 0);
    return { ...res, world: w };
  } catch (e) {
    // A bad name must never crash the terminal; keep the world unchanged.
    console.error(e);
    return { ...err(`${tokens[0]}: 이 명령을 처리하지 못했어요. 이름을 확인해보세요. (help)`), world };
  }
}

/** Shell prompt, or the IOS prompt ('CORE-01(config-if)# ') when the session is on network gear. */
export function promptFor(host: string, mode?: IosMode | null, w?: World): string {
  if (mode && w) return `\x1b[1;36m${iosPrompt(w, host, mode)}\x1b[0m `;
  return `\x1b[1;31m${host}\x1b[0m@khu-dc:~$ `;
}
