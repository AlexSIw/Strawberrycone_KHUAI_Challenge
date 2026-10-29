// The 퇴근 퀴즈: the day's finale objective shows up only once every other mission is done and every
// incident is settled.
import { describe, expect, it } from 'vitest';
import { getStage } from '../src/content/stages';
import type { Objective, StageDef } from '../src/content/types';
import { incidentsSettled, startStage, visibleObjectives, type StageRun } from '../src/sim/engine';
import type { ScenarioRuntime } from '../src/sim/scenario';
import { lockedText, objectiveStatus, waitingText } from '../src/ui/objectiveStatus';

// ---------- the finale rule ----------

const FINALE: Objective = { id: 'finale', text: '퇴근 전 복습 퀴즈', finale: true, done: (_w, c) => c.events.includes('quiz:correct') };

/** D-3 with a finale objective added at the end (the rule doesn't depend on the day's content). */
const withFinale = (): StageDef => {
  const def = getStage(2);
  return { ...def, objectives: [...def.objectives.filter((o) => !o.finale), FINALE] };
};

/** Every objective of `def` but the finale done; the incidents set to `state`. */
function missionsDone(def: StageDef, state: ScenarioRuntime['state'] | ((r: ScenarioRuntime, i: number) => ScenarioRuntime['state'])): StageRun {
  const run = startStage(def.id, 1);
  const objectivesDone = Object.fromEntries(def.objectives.filter((o) => !o.finale).map((o) => [o.id, 0]));
  const scenarios = run.scenarios.map((r, i) => ({ ...r, state: typeof state === 'function' ? state(r, i) : state }));
  return { ...run, objectivesDone, scenarios };
}

const finaleShown = (def: StageDef, run: StageRun) => visibleObjectives(def, run).some((o) => o.finale);

describe('the finale objective', () => {
  it('is not shown at the start, nor while a mission is left', () => {
    const def = withFinale();
    expect(finaleShown(def, startStage(2, 1))).toBe(false);
    const run = missionsDone(def, 'resolved');
    const { [def.objectives[0].id]: _first, ...rest } = run.objectivesDone;
    const left = { ...run, objectivesDone: rest };
    expect(finaleShown(def, left)).toBe(false);
    const st = objectiveStatus(def, left);
    expect(st.lockReason).toBe('objective');
    expect(st.finaleLocked).toBe(false);
  });

  it('waits for an incident going on, and for one still to fire', () => {
    const def = withFinale();
    for (const state of ['active', 'waiting'] as const) {
      const run = missionsDone(def, (_r, i) => (i === 0 ? state : 'resolved'));
      expect(incidentsSettled(def, run), state).toBe(false);
      expect(finaleShown(def, run), state).toBe(false);
      const st = objectiveStatus(def, run);
      expect(st.lockReason, state).toBe('incident');
      expect(st.finaleLocked, state).toBe(true);
      expect(lockedText(st)).toBe('퇴근 전 복습 퀴즈 (오늘 미션과 장애를 다 끝내면 열려요)');
    }
    // Nothing on the list to do and nothing going on yet: the panel says the next thing is on its way.
    expect(waitingText(objectiveStatus(def, missionsDone(def, (_r, i) => (i === 0 ? 'waiting' : 'resolved'))))).toBe(
      '지금 할 목표는 다 했어요! 다음 상황을 기다리는 중이에요…',
    );
  });

  it('shows up once every mission is done and every incident is settled', () => {
    const def = withFinale();
    const run = missionsDone(def, 'resolved');
    expect(incidentsSettled(def, run)).toBe(true);
    expect(finaleShown(def, run)).toBe(true);
    const st = objectiveStatus(def, run);
    expect(st.next?.id).toBe('finale');
    expect(st.lockedCount).toBe(0);
    expect(lockedText(st)).toBeNull();
  });

  it('an optional incident that never fired counts as settled', () => {
    // D-2's container-port mistake (a condition trigger) may never happen.
    const def = getStage(3);
    const run = startStage(3, 1);
    const scenarios = run.scenarios.map((r) => ({ ...r, state: r.trigger.type === 'condition' ? ('waiting' as const) : ('resolved' as const) }));
    expect(scenarios.some((r) => r.state === 'waiting')).toBe(true);
    expect(incidentsSettled(def, { ...run, scenarios })).toBe(true);
  });
});
