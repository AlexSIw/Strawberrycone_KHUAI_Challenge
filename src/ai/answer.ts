// 쿠사수's answer to "뭘 하면 돼요?": three short lines, 상황 / 할 일 / 명령. The AI writes them (worker/src/hint.ts);
// when it can't, incidentGuide builds them from the scenario, with the fix's values left blank (blanks.ts).
import type { Scenario } from '../sim/scenario';
import { fixShapes } from './blanks';

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

/** The answer when the AI can't give one: the incident's title, its 할 일, and the blank-shape 명령 line. */
export const incidentGuide = (sc: Pick<Scenario, 'title' | 'todo' | 'solutionSteps' | 'checks' | 'fixHow'>, from?: string): string =>
  formatGuide({ situation: sc.title, todo: sc.todo, command: commandLine(sc, from) });
