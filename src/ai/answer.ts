// 쿠사수's answer to "뭘 하면 돼요?": three short lines, 상황 / 할 일 / 명령. The AI writes them (worker/src/hint.ts);
// when it can't, incidentGuide builds them from the scenario, with the fix's values left blank (blanks.ts).
import type { Scenario } from '../sim/scenario';
import { fixShapes } from './blanks';

/**
 * Why the game answered by itself: no ChatKHU key on the Worker (nokey), no Worker behind /api (offline), too
 * many requests (rate), no reply in time (timeout), a gateway error or an unusable reply (upstream), or the
 * answer gave too much away twice (leak).
 */
export type FallbackReason = 'nokey' | 'offline' | 'rate' | 'timeout' | 'upstream' | 'leak';

export const FALLBACK_REASONS: readonly FallbackReason[] = ['nokey', 'offline', 'rate', 'timeout', 'upstream', 'leak'];

/** The line 쿠사수 puts above its own answer, so the player knows it isn't ChatKHU's. A leak says nothing. */
export const FALLBACK_NOTICE: Record<FallbackReason, string | null> = {
  nokey: 'ChatKHU API랑 연결이 안 돼 있어서 기본 힌트만 제공드려요.',
  offline: 'ChatKHU API랑 연결이 안 돼 있어서 기본 힌트만 제공드려요.',
  rate: 'ChatKHU 요청이 많아서 잠시 기본 힌트로 드려요.',
  timeout: 'ChatKHU 응답이 없어서 이번엔 기본 힌트로 드려요.',
  upstream: 'ChatKHU 응답이 없어서 이번엔 기본 힌트로 드려요.',
  leak: null,
};

/** What a button or the terminal's `hint` asks on the player's behalf. */
export const GUIDE_ASK = '지금 뭘 하면 돼요?';

export interface Guide {
  situation: string;
  todo: string;
  command: string;
}

export const formatGuide = (g: Guide): string => `상황: ${g.situation}\n할 일: ${g.todo}\n명령: ${g.command}`;

/** The three lines back, or null when the text isn't a guide (a short explanation, an old-style hint). */
export function parseGuide(text: string): Guide | null {
  const m = /^상황:[ \t]*(.+)\n할 일:[ \t]*(.+)\n명령:[ \t]*(.+)$/.exec(text.trim());
  return m ? { situation: m[1].trim(), todo: m[2].trim(), command: m[3].trim() } : null;
}

/** How to get onto the hosts from `from`: 'ssh TOR-01 → ', back to the 관리 PC, or nothing when already there. */
function goTo(hosts: string[], from?: string): string {
  if (from && hosts.includes(from)) return '';
  if (hosts.length > 1) return `${hosts.join('·')} 각각 ssh → `;
  if (hosts[0] === 'ops') return from ? 'exit (관리 PC로) → ' : '';
  return `ssh ${hosts[0]} → `;
}

/**
 * The 명령 line: get to the device, look with the scenario's checks, then the fix as blank shapes (an IOS fix
 * in config mode and saved). `from` is the host the player's terminal is on.
 */
export function commandLine(sc: Pick<Scenario, 'solutionSteps' | 'checks' | 'fixHow'>, from?: string): string {
  const check = sc.checks.length ? `(확인) ${sc.checks.join(', ')} → ` : '';
  const shapes = fixShapes(sc);
  if (!shapes.length) return `${check}${sc.fixHow ?? ''}`.trim();
  const ios = new Set(sc.solutionSteps.flatMap((s) => ('ios' in s ? [s.host] : [])));
  return shapes
    .map((f, i) => {
      const fix = ios.has(f.hosts[0]) ? ['enable', 'conf t', ...f.lines, 'end', 'wr'] : f.lines;
      return `${goTo(f.hosts, from)}${i === 0 ? check : ''}(고치기) ${fix.join(' → ')}`;
    })
    .join(' / ');
}

/** How 쿠사수's lines start in the terminal: the name in bright yellow, then the text. */
export const MENTOR_TAG = '\x1b[93m쿠사수>\x1b[0m ';
/**
 * The lines after the first sit under its text ('쿠사수> ' is 8 cells wide). The leading reset is invisible; it
 * tells the terminal's word wrap these are 쿠사수's lines, not some other output that starts with spaces.
 */
export const MENTOR_INDENT = `\x1b[0m${' '.repeat(8)}`;

/** An answer as terminal lines: the first after the name, the rest lined up under it. */
export const terminalLines = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => (i === 0 ? MENTOR_TAG : MENTOR_INDENT) + l);

/** The answer when the AI can't give one: the incident's title, its 할 일, and the blank-shape 명령 line. */
export const incidentGuide = (sc: Pick<Scenario, 'title' | 'todo' | 'solutionSteps' | 'checks' | 'fixHow'>, from?: string): string =>
  formatGuide({ situation: sc.title, todo: sc.todo, command: commandLine(sc, from) });
