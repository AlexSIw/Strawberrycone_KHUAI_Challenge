// What the objective list says right now: shared by the left ObjectivePanel and the terminal's side box,
// so both always agree on what is open, what is locked (and what unlocks it) and what the player waits for.
import type { GuideStep, Objective, StageDef } from '../content/types';
import { activeScenarios, visibleObjectives, type StageRun } from '../sim/engine';
import type { IosMode, PlayContext, World } from '../sim/types';

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

/** The locked row under the list: how many objectives follow, and what opens them. */
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
  if (st.doneCount === st.total) return '목표 완료! 관제 화면(N)을 지켜보며 다음 상황을 기다려요…';
  if (st.doneCount === 0) return '곧 상황이 시작돼요. 잠깐 기다려봐요…';
  return st.lockReason === 'incident'
    ? '지금 할 목표는 다 했어요! 다음 상황을 기다리는 중이에요…'
    : '지금 할 목표는 다 했어요! 다음 목표가 곧 열려요…';
}

/** The highlighted box at the top of the objective panel (null: the highlighted objective says it all). */
export function nextStepText(st: ObjectiveStatus): string | null {
  if (st.incident) {
    return st.objectivesFixIncident
      ? '장애 발생! 아래 목표를 차례로 하면 해결돼요. 막히면 쿠사수에게 물어봐요.'
      : '장애부터 해결하세요! 막히면 쿠사수에게 물어봐요.';
  }
  return waitingText(st);
}

/**
 * The mission the terminal's side box explains (its why and first-time steps), or undefined: the one to do
 * now, when it has something to explain and the box shows the missions (no incident going on, or the missions
 * are the steps that solve it). A mission that shows up while the terminal is open gets no 미션 브리핑 only
 * when it is this one; the others are briefed once the terminal isn't the open window any more.
 */
export function termGuided(st: ObjectiveStatus): Objective | undefined {
  const o = st.next;
  if (!o || !(o.why || o.steps?.length)) return undefined;
  return !st.incident || st.objectivesFixIncident ? o : undefined;
}

/** The mission the radio talks about: the one to do now, or (none open) the last one on the list. */
export function missionInFocus(def: StageDef, run: StageRun): Objective | undefined {
  const visible = visibleObjectives(def, run);
  return visible.find((o) => !(o.id in run.objectivesDone)) ?? visible[visible.length - 1];
}

// ---------- first-time guide ----------

/** One step of an objective's guide, as the world is now. */
export interface GuideRow {
  text: string;
  cmd?: string;
  why?: string;
  done: boolean;
  /** The step to do now: the first one not done */
  next: boolean;
}

export interface Guide {
  rows: GuideRow[];
  doneCount: number;
  /** The step to do now (null once every step is ticked) */
  next: GuideRow | null;
}

/** A step's own check. One that throws counts as not done: a content slip must not take the panel down. */
function stepDone(s: GuideStep, w: World, ctx: PlayContext): boolean {
  try {
    return !!s.done(w, ctx);
  } catch {
    return false;
  }
}

/**
 * An objective's first-time guide, each step ticked by the world and events as they are now (null when
 * the objective has no steps). Shared by the mission panel, the terminal's side box and the radio.
 */
export function guideOf(o: Objective | undefined, run: Pick<StageRun, 'world' | 'ctx'>): Guide | null {
  if (!o?.steps?.length) return null;
  const done = o.steps.map((s) => stepDone(s, run.world, run.ctx));
  const nextIndex = done.indexOf(false);
  const rows = o.steps.map(
    (s, i): GuideRow => ({
      text: s.text,
      ...(s.cmd ? { cmd: s.cmd } : {}),
      ...(s.why ? { why: s.why } : {}),
      done: done[i],
      next: i === nextIndex,
    }),
  );
  return { rows, doneCount: done.filter(Boolean).length, next: nextIndex >= 0 ? rows[nextIndex] : null };
}

// ---------- IOS mode, in plain words ----------

export interface IosModeText {
  /** The prompt's mode mark: '>', '#', '(config)#' … */
  mark: string;
  /** What the mode is for, in plain Korean */
  name: string;
  /** How to go back from it */
  back: string;
}

/** The line on the terminal's IOS cheat sheet: which mode the session is in, and the way back. */
export function iosModeText(mode: IosMode): IosModeText {
  const toConfig = 'exit: (config)#로 · end: #로';
  switch (mode.level) {
    case 'user':
      return { mark: '>', name: '사용자 모드 (보기만 해요)', back: 'exit: 장비에서 나가기' };
    case 'exec':
      return { mark: '#', name: '관리자 모드 (보고 저장해요)', back: 'exit: 장비에서 나가기' };
    case 'config':
      return { mark: '(config)#', name: '장비 전체 설정', back: 'exit · end: #로' };
    case 'config-if': {
      const ifs = mode.ifs ?? [];
      // `interface vlan N` (the VLAN's gateway interface) lands here too, with the VLAN number.
      const name =
        mode.vlan !== undefined
          ? `VLAN ${mode.vlan}의 인터페이스 설정`
          : ifs.length > 1
            ? `포트 여러 개 설정 (${ifs.length > 2 ? `${ifs[0]} 외 ${ifs.length - 1}개` : ifs.join(', ')})`
            : `포트 하나 설정${ifs.length ? ` (${ifs[0]})` : ''}`;
      return { mark: '(config-if)#', name, back: toConfig };
    }
    case 'config-vlan':
      return { mark: '(config-vlan)#', name: `VLAN 설정${mode.vlan !== undefined ? ` (VLAN ${mode.vlan})` : ''}`, back: toConfig };
  }
}
