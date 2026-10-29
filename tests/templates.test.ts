// Template matrix: every incident variant that can be drawn as an extra on a later day really breaks
// that day's starting world, and its own solution really fixes it there. (Its first day is covered by
// the seed sweep in days.test.ts, where the day's missions are done first.)
import { describe, expect, it } from 'vitest';
import { instanceIds, TEMPLATES, validOn } from '../src/content/incidents';
import { getStage } from '../src/content/stages';
import { ackAlarm, scenarioOf, startStage, tickRun, type StageRun } from '../src/sim/engine';
import { initRuntime } from '../src/sim/scenario';
import { LAST_DAY, type StageId } from '../src/sim/types';
import { apply } from './autoplay';

const cases: [string, StageId][] = [];
for (const t of TEMPLATES) {
  for (let d = t.day + 1; d <= LAST_DAY; d++) {
    const day = d as StageId;
    if (!validOn(t, day)) continue;
    const def = getStage(day);
    for (const id of instanceIds(t)) if (def.scenarios.some((s) => s.id === id)) cases.push([id, day]);
  }
}

/** Run only this incident on the day's starting world: fire at once, ACK, solve, see it resolve. */
function matrix(id: string, day: StageId) {
  const def = getStage(day);
  let run: StageRun = startStage(day, 1);
  run = { ...run, scenarios: initRuntime([{ id, trigger: { type: 'stageStart', delay: 1, overlap: true } }]) };
  const sc = scenarioOf(def, id);
  for (let i = 0; i < 5 && run.scenarios[0].state === 'waiting'; i++) run = tickRun(run).run;
  expect(run.scenarios[0].state, `${id} fires on ${def.label}`).toBe('active');
  expect(sc.check(run.world, run.ctx, run.health), `${id} breaks something on ${def.label}`).toBe(false);
  const errors: string[] = [];
  for (const st of sc.solutionSteps) run = apply(run, st, errors);
  expect(errors, `${id} solution runs clean on ${def.label}`).toEqual([]);
  for (let i = 0; i < 40 && run.scenarios[0].state === 'active'; i++) {
    run = tickRun(run).run;
    for (const a of run.alarms) if (a.ackAt === null) run = ackAlarm(run, a.id);
  }
  expect(run.scenarios[0].state, `${id} is fixed by its own solution on ${def.label}`).toBe('resolved');
}

describe('incident templates on later days', () => {
  it('there is something to check', () => expect(cases.length).toBeGreaterThan(0));
  it.each(cases)('%s on day %i', (id, day) => matrix(id, day));
});
