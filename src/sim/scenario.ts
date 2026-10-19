import type { Health, PlayContext, RoomId, StageId, World } from './types';

export type Trigger =
  | { type: 'stageStart'; delay?: number }
  /** Fires `delay` seconds after another scenario is resolved */
  | { type: 'after'; scenario: string; delay?: number }
  /** Fires `delay` seconds after an objective is completed */
  | { type: 'objective'; objective: string; delay?: number }
  /** Fires as soon as the condition holds (for mistakes the player may or may not make) */
  | { type: 'condition'; when: (w: World, ctx: PlayContext) => boolean };

/** A step that solves the scenario: either a terminal command run on a host, or a direct world action. */
export type SolutionStep =
  | { cmd: string; host: string }
  | { action: (w: World) => void; label: string };

export interface Scenario {
  id: string;
  stage: StageId;
  title: string;
  /** What the player hears first: a symptom, never the cause */
  alert: string;
  severity: 'critical' | 'warning';
  /** Room that is worth checking first (shown on the minimap) */
  room: RoomId;
  trigger: Trigger;
  inject: (w: World) => void;
  check: (w: World, ctx: PlayContext, h: Health) => boolean;
  /** Called once on resolve, e.g. to restore mains after a UPS fix */
  onResolve?: (w: World) => void;
  /** Optional scenarios only fire on a condition and don't block stage clear if they never happen */
  optional?: boolean;
  hints: [string, string, string];
  /** Strings the AI 사수 must never say (they give the answer away) */
  bannedPhrases: string[];
  /** Answer text for "정답 보기" */
  solution: string;
  solutionSteps: SolutionStep[];
  concept: string;
  /** One line shown when solved: what just happened */
  lesson: string;
}

export interface ScenarioRuntime {
  id: string;
  state: 'waiting' | 'active' | 'resolved';
  /** Stage time when it becomes active (waiting) or became active */
  at: number | null;
  activatedAt: number | null;
  resolvedAt: number | null;
}

export function initRuntime(scenarios: Scenario[]): ScenarioRuntime[] {
  return scenarios.map((s) => ({ id: s.id, state: 'waiting', at: null, activatedAt: null, resolvedAt: null }));
}

/**
 * Advance scenario state: schedule, activate (inject), and resolve (check).
 * Mutates `w` and `rt`; returns ids that activated and resolved this tick.
 */
export function tickScenarios(
  scenarios: Scenario[],
  rt: ScenarioRuntime[],
  w: World,
  ctx: PlayContext,
  h: Health,
  objectivesDone: (id: string) => number | null,
): { activated: string[]; resolved: string[] } {
  const activated: string[] = [];
  const resolved: string[] = [];
  const byId = new Map(rt.map((r) => [r.id, r]));

  for (const s of scenarios) {
    const r = byId.get(s.id)!;
    if (r.state === 'waiting') {
      if (r.at === null) {
        const tr = s.trigger;
        if (tr.type === 'stageStart') r.at = tr.delay ?? 0;
        else if (tr.type === 'after') {
          const dep = byId.get(tr.scenario);
          if (dep?.state === 'resolved' && dep.resolvedAt !== null) r.at = dep.resolvedAt + (tr.delay ?? 0);
        } else if (tr.type === 'objective') {
          const doneAt = objectivesDone(tr.objective);
          if (doneAt !== null) r.at = doneAt + (tr.delay ?? 0);
        } else if (tr.type === 'condition' && tr.when(w, ctx)) r.at = ctx.stageTime;
      }
      if (r.at !== null && ctx.stageTime >= r.at) {
        s.inject(w);
        r.state = 'active';
        r.activatedAt = ctx.stageTime;
        activated.push(s.id);
      }
    } else if (r.state === 'active') {
      if (s.check(w, ctx, h)) {
        r.state = 'resolved';
        r.resolvedAt = ctx.stageTime;
        s.onResolve?.(w);
        resolved.push(s.id);
      }
    }
  }
  return { activated, resolved };
}
