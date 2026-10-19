import type { Health, PlayContext, RoomId, StageId, World } from './types';

/**
 * Seconds of calm between "everything this incident waits for is done" and the incident firing:
 * after the previous incident is solved, and after the objectives in front of it are finished.
 * Stage time only runs while the game is unpaused (no dialogue, no concept card open).
 */
export const INCIDENT_GAP = 10;

export type Trigger =
  /** Fires `delay` seconds into the stage (stage time starts after the intro dialogue) */
  | { type: 'stageStart'; delay?: number }
  /**
   * Fires `delay` seconds (default INCIDENT_GAP) after every listed scenario is resolved AND every
   * listed objective is done; the timer starts at the latest of those moments. This is how incidents
   * chain, and how they wait for the player to finish the objectives in front of them.
   * Optional scenarios can't be gates (they may never fire).
   */
  | { type: 'gate'; scenarios?: string[]; objectives?: string[]; delay?: number }
  /** Fires as soon as the condition holds (for mistakes the player may or may not make) */
  | { type: 'condition'; when: (w: World, ctx: PlayContext) => boolean };

/**
 * When a gate opens: the stage time its last scenario was resolved / objective was done, or null
 * while any of them is still pending.
 */
export function gateOpenedAt(
  tr: { scenarios?: string[]; objectives?: string[] },
  resolvedAt: (id: string) => number | null,
  objectivesDone: (id: string) => number | null,
): number | null {
  let latest = 0;
  for (const t of [...(tr.scenarios ?? []).map(resolvedAt), ...(tr.objectives ?? []).map(objectivesDone)]) {
    if (t === null) return null;
    latest = Math.max(latest, t);
  }
  return latest;
}

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
  const resolvedAt = (id: string) => {
    const dep = byId.get(id);
    return dep?.state === 'resolved' ? dep.resolvedAt : null;
  };

  for (const s of scenarios) {
    const r = byId.get(s.id)!;
    if (r.state === 'waiting') {
      if (r.at === null) {
        const tr = s.trigger;
        if (tr.type === 'stageStart') r.at = tr.delay ?? 0;
        else if (tr.type === 'gate') {
          const opened = gateOpenedAt(tr, resolvedAt, objectivesDone);
          if (opened !== null) r.at = opened + (tr.delay ?? INCIDENT_GAP);
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
