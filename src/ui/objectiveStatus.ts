// What the objective list says right now: shared by the left ObjectivePanel and the terminal's side box,
// so both always agree on what is open, what is locked (and what unlocks it) and what the player waits for.
import type { Objective, StageDef } from '../content/types';
import { activeScenarios, visibleObjectives, type StageRun } from '../sim/engine';

/** What the next locked objective is waiting for. */
export type LockReason =
  /** An objective on the list that isn't done yet */
  | 'objective'
  /** An incident to be solved (Objective.afterIncidents) */
  | 'incident'
  /** An incident to fire (Objective.afterFired): nothing for the player to do but wait a moment */
  | 'soon';

export interface ObjectiveStatus {
  /** Objectives on the list (done or not), in stage order */
  visible: Objective[];
  /** Visible and not done yet */
  open: Objective[];
  /** Visible and done */
  done: Objective[];
  /** The one to do now (the first open one) */
  next: Objective | undefined;
  /** Done, out of every objective of the stage (so the total doesn't grow as later ones unlock) */
  doneCount: number;
  total: number;
  /** Objectives not on the list yet */
  lockedCount: number;
  /** Why the next of them is still locked (null when none is) */
  lockReason: LockReason | null;
  /** Some incident is going on */
  incident: boolean;
  /** An incident is going on and the open objectives are the steps that solve it (stage 5's container chain) */
  objectivesFixIncident: boolean;
}

/** Incidents an objective's chain opened with (its own afterFired, and that of the objectives it comes after). */
function firedRoots(def: StageDef, o: Objective, seen = new Set<string>()): string[] {
  if (seen.has(o.id)) return [];
  seen.add(o.id);
  const before = (o.after ?? []).flatMap((id) => {
    const p = def.objectives.find((x) => x.id === id);
    return p ? firedRoots(def, p, seen) : [];
  });
  return [...(o.afterFired ?? []), ...before];
}

export function objectiveStatus(def: StageDef, run: StageRun): ObjectiveStatus {
  const isDone = (id: string) => id in run.objectivesDone;
  const visible = visibleObjectives(def, run);
  const shown = new Set(visible.map((o) => o.id));
  const open = visible.filter((o) => !isDone(o.id));
  const done = visible.filter((o) => isDone(o.id));
  const locked = def.objectives.filter((o) => !shown.has(o.id));

  // The locked objectives next in line: every objective they come after is already on the list.
  // Their own gate says what unlocks them; the ones behind them simply follow.
  let lockReason: LockReason | null = null;
  if (locked.length) {
    const frontier = locked.filter((o) => (o.after ?? []).every((a) => shown.has(a)));
    const first = frontier[0];
    if (!first || (first.after ?? []).some((a) => !isDone(a))) lockReason = 'objective';
    else if ((first.afterIncidents ?? []).some((id) => !run.ctx.resolved.includes(id))) lockReason = 'incident';
    else lockReason = 'soon';
  }

  const active = activeScenarios(run).map((a) => a.rt.id);
  const next = open[0];
  return {
    visible,
    open,
    done,
    next,
    doneCount: def.objectives.filter((o) => isDone(o.id)).length,
    total: def.objectives.length,
    lockedCount: locked.length,
    lockReason,
    incident: active.length > 0,
    objectivesFixIncident: !!next && firedRoots(def, next).some((id) => active.includes(id)),
  };
}

/** The 🔒 row under the list: how many objectives follow, and what opens them. */
export function lockedText(st: ObjectiveStatus): string | null {
  if (!st.lockedCount || !st.lockReason) return null;
  const n = st.lockedCount;
  const when =
    st.lockReason === 'incident'
      ? '장애를 해결하면 열려요'
      : st.lockReason === 'soon'
        ? n === 1
          ? '곧 열려요'
          : '첫 목표가 곧 열려요'
        : '앞 목표를 끝내면 열려요';
  return `이어지는 목표 ${n}개 (${when})`;
}

/**
 * The line shown when there is nothing to do on the list and no incident going on, or null when there is
 * something to do. Never "목표 완료!" while objectives are still locked.
 */
export function waitingText(st: ObjectiveStatus): string | null {
  if (st.incident || st.next) return null;
  if (st.doneCount === st.total) return '목표 완료! 다음 상황을 기다리는 중이에요…';
  if (st.doneCount === 0) return '곧 상황이 시작돼요. 잠깐 기다려봐요…';
  return st.lockReason === 'incident'
    ? '지금 할 목표는 다 했어요! 다음 상황을 기다리는 중이에요…'
    : '지금 할 목표는 다 했어요! 다음 목표가 곧 열려요…';
}

/** The highlighted box at the top of the objective panel (null: the highlighted objective says it all). */
export function nextStepText(st: ObjectiveStatus): string | null {
  if (st.incident) {
    return st.objectivesFixIncident
      ? '🚨 장애 발생! 아래 목표를 차례로 하면 해결돼요. 막히면 쿠사수에게 물어봐요.'
      : '🚨 장애부터 해결하세요! 막히면 쿠사수에게 물어봐요.';
  }
  return waitingText(st);
}
