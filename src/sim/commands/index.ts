import { clone } from '../step';
import type { StageId, World } from '../types';
import { dockerCommands } from './docker';
import { k8sCommands } from './k8s';
import { netCommands } from './net';
import { svcCommands } from './svc';
import type { Command, CmdResult } from './types';
import { bold, dim, err } from './types';
import { webCommands } from './web';

/** Terminal width of a string: wide (Hangul/CJK) characters take two cells. */
export function cellWidth(s: string): number {
  let n = 0;
  for (const ch of s) n += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1;
  return n;
}

export const padCells = (s: string, width: number) => s + ' '.repeat(Math.max(1, width - cellWidth(s)));

const base: Command[] = [
  {
    name: 'help',
    minStage: 0,
    usage: 'help',
    summary: '쓸 수 있는 명령어 보기',
    run: (_a, { stage }) => ({
      lines: [
        bold('쓸 수 있는 명령어'),
        ...available(stage).map((c) => `  ${padCells(c.usage, 40)} ${dim(c.summary)}`),
        dim('막히면 hint 를 입력하거나 쿠사수에게 물어보세요.'),
      ],
    }),
  },
  { name: 'clear', aliases: ['cls'], minStage: 0, usage: 'clear', summary: '화면 지우기', run: () => ({ lines: [], clear: true }) },
  { name: 'hint', minStage: 0, usage: 'hint', summary: 'AI 사수에게 힌트 요청', run: () => ({ lines: [dim('쿠사수를 불렀어요…')], openHint: true }) },
];

export const ALL_COMMANDS: Command[] = [...base, ...netCommands, ...webCommands, ...svcCommands, ...dockerCommands, ...k8sCommands];

export function available(stage: StageId): Command[] {
  return ALL_COMMANDS.filter((c) => c.minStage <= stage && (c.maxStage === undefined || stage <= c.maxStage));
}

/** Longest matching command name wins, so "docker run" beats "docker". */
function match(tokens: string[], stage: StageId): { cmd: Command; args: string[] } | null {
  let best: { cmd: Command; args: string[]; len: number } | null = null;
  for (const cmd of available(stage)) {
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

/** Run one terminal line against a copy of the world. */
export function runCommand(line: string, world: World, host: string, stage: StageId): RunOutput {
  let tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens[0] === 'sudo') tokens = tokens.slice(1);
  if (tokens[0] === 'kubectl' || tokens[0] === 'k') tokens = tokens.slice(1);
  if (!tokens.length) return { lines: [], world };
  const m = match(tokens, stage);
  if (!m) {
    const known = ALL_COMMANDS.some((c) => c.name.split(' ')[0] === tokens[0]);
    const msg = known
      ? `${tokens[0]}: 이 단계에서는 아직 못 써요. 또는 사용법이 달라요. (help)`
      : `${tokens[0]}: 그런 명령어는 아직 몰라요. help 를 쳐보세요.`;
    return { ...err(msg), world };
  }
  const w = clone(world);
  const res = m.cmd.run(m.args, { w, host, stage });
  return { ...res, world: w };
}

export function promptFor(host: string): string {
  return `\x1b[1;31m${host}\x1b[0m@khu-dc:~$ `;
}
