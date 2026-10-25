// How a player completes each day's missions, and how a test plays a whole day.
// (Not a test file itself: vitest only collects tests/**/*.test.ts.)
import { getStage } from '../src/content/stages';
import {
  ackAlarm,
  applyAction,
  applyCommand,
  isCleared,
  recordEvents,
  scenarioOf,
  startStage,
  tickRun,
  visibleObjectives,
  type StageRun,
} from '../src/sim/engine';
import type { SolutionStep } from '../src/sim/scenario';
import type { IosMode, StageId } from '../src/sim/types';

export type Step =
  | { cmd: string; host: string }
  /** IOS keystrokes on a network device, starting at its `>` prompt (as after ssh / the console) */
  | { ios: string[]; host: string }
  | { action: Parameters<typeof applyAction>[1]; events?: string[] }
  | { events: string[] };

export const RED = '\x1b[31m';

/** How a player completes each mission, per day. Each day's owner fills in its own entry. */
export const AUTOPLAY: Record<number, Record<string, Step[]>> = {
  0: { noc: [{ events: ['open:noc'] }] },
  1: { noc: [{ events: ['open:noc'] }] },
  2: { noc: [{ events: ['open:noc'] }] },
  3: { noc: [{ events: ['open:noc'] }] },
  4: { noc: [{ events: ['open:noc'] }] },
  5: { noc: [{ events: ['open:noc'] }] },
};

/** Mission steps may print expected errors (e.g. a refused curl); solution steps must not (errors: non-null). */
export function apply(run: StageRun, step: Step | SolutionStep, errors: string[] | null): StageRun {
  if ('ios' in step) {
    let mode: IosMode | null = { level: 'user' };
    for (const line of step.ios) {
      const res = applyCommand(run, line, step.host, mode);
      const bad = res.lines.filter((l) => l.startsWith(RED));
      if (bad.length && errors) errors.push(`${step.host}> ${line} → ${bad.join(' | ')}`);
      run = res.run;
      mode = res.mode;
    }
    return run;
  }
  if ('cmd' in step) {
    const res = applyCommand(run, step.cmd, step.host);
    const bad = res.lines.filter((l) => l.startsWith(RED));
    if (bad.length && errors) errors.push(`${step.host}$ ${step.cmd} → ${bad.join(' | ')}`);
    return res.run;
  }
  if ('action' in step) return applyAction(run, step.action, 'events' in step ? step.events ?? [] : []).run;
  return recordEvents(run, step.events).run;
}

export interface DayReport {
  run: StageRun;
  cleared: boolean;
  /** Red output from solution steps */
  errors: string[];
  /** Incidents that were already fine when they fired (the inject didn't break anything) */
  notBroken: string[];
  /** Incidents still not resolved 10 s after their solution ran */
  unsolved: string[];
  /** Polled alarms that showed up off a poll boundary */
  offPoll: string[];
}

/**
 * Play a day like a prompt player: do each visible mission's AUTOPLAY steps, ACK each alarm 2 s after it
 * shows up, run the incident's solution 2 s after that.
 */
export function playDay(day: StageId, seed = 1, maxTicks = 900): DayReport {
  const def = getStage(day);
  let run = startStage(day, seed);
  const errors: string[] = [];
  const notBroken: string[] = [];
  const solvedAt = new Map<string, number>();
  const offPoll: string[] = [];
  for (let i = 0; i < maxTicks && !isCleared(run); i++) {
    for (const o of visibleObjectives(def, run)) {
      if (o.id in run.objectivesDone) continue;
      for (const st of AUTOPLAY[day]?.[o.id] ?? []) run = apply(run, st, null);
    }
    const t = tickRun(run);
    run = t.run;
    for (const id of t.activated) {
      if (scenarioOf(def, id).check(run.world, run.ctx, run.health)) notBroken.push(id);
    }
    for (const id of t.raised) {
      const a = run.alarms.find((x) => x.id === id)!;
      if (a.source === 'poll' && a.raisedAt % (def.pollEvery ?? 15) !== 0) offPoll.push(id);
    }
    const now = run.ctx.stageTime;
    for (const a of run.alarms) {
      if (a.ackAt === null && a.clearedAt === null && now >= a.raisedAt + 2) run = ackAlarm(run, a.id);
    }
    for (const a of run.alarms) {
      const r = run.scenarios.find((x) => x.id === a.scenarioId);
      if (!r || r.state !== 'active' || a.ackAt === null || solvedAt.has(r.id) || now < a.ackAt + 2) continue;
      for (const st of scenarioOf(def, r.id).solutionSteps) run = apply(run, st, errors);
      solvedAt.set(r.id, now);
    }
  }
  const unsolved = run.scenarios
    .filter((r) => r.state === 'active' && solvedAt.has(r.id) && run.ctx.stageTime > solvedAt.get(r.id)! + 10)
    .map((r) => r.id);
  return { run, cleared: isCleared(run), errors, notBroken, unsolved, offPoll };
}
