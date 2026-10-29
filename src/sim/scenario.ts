import type { Health, PlayContext, RoomId, StageId, World } from './types';

/**
 * Seconds of calm between "everything this incident waits for is done" and the incident firing:
 * after the previous incident is solved, and after the objectives in front of it are finished.
 * Stage time only runs while the game is unpaused (no dialogue, no concept card open).
 */
export const INCIDENT_GAP = 10;

export type Trigger =
  /**
   * Fires `delay` seconds into the day (day time starts after the briefing). Waits for the 10 s
   * breather after the last fix unless `overlap` is set (the D-Day timeline runs on the clock).
   */
  | { type: 'stageStart'; delay?: number; overlap?: boolean }
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

/**
 * A step that solves the scenario: a shell command on a host, an IOS keystroke script typed on a
 * network device (starting at the `>` prompt; the runner threads the mode line by line), or a direct
 * world action (a mini-game, a NOC button).
 */
export type SolutionStep =
  | { cmd: string; host: string }
  | { ios: string[]; host: string }
  | { action: (w: World) => void; label: string };

/** NOC alarm severity (the doc's four levels). */
export type AlarmSev = 'critical' | 'major' | 'minor' | 'warning';

/**
 * How the NOC learns about an incident:
 * - trap / syslog: the device says so itself → the alarm shows up at once;
 * - poll: only the next SNMP poll notices (utilization, CRC counters, temperature) → it shows up late.
 */
export interface AlarmSpec {
  source: 'trap' | 'syslog' | 'poll';
  /** Device id the NMS pins the alarm on */
  device: string;
  /** Alarm-list line: what the monitoring system sees, never the cause */
  text: string;
}

export interface Scenario {
  id: string;
  /** Day this incident is first taught (its manual section lives in that day's manual) */
  stage: StageId;
  title: string;
  /** What users / the 팀장 report: a symptom, never the cause */
  alert: string;
  severity: AlarmSev;
  alarm: AlarmSpec;
  /** Room worth checking first (map marker only; never shown with the alarm) */
  room: RoomId;
  trigger: Trigger;
  inject: (w: World) => void;
  check: (w: World, ctx: PlayContext, h: Health) => boolean;
  /** Called once on resolve */
  onResolve?: (w: World) => void;
  /** Optional scenarios only fire on a condition and don't block the day if they never happen */
  optional?: boolean;
  /**
   * Shallow-area incidents (campus services, campus links) can be handed to the team that owns them.
   * `fix` runs `delay` seconds after the player escalates; the normal `check` then resolves it.
   */
  escalate?: { delay: number; team: string; fix: (w: World) => void };
  hints: [string, string, string];
  /** Strings the AI 사수 must never say (they give the answer away) */
  bannedPhrases: string[];
  /** IOS answer lines to ban in every abbreviated form (beyond those derived from `solutionSteps`) */
  bannedIos?: string[];
  /** Answer text for "정답 보기" */
  solution: string;
  solutionSteps: SolutionStep[];
  /** 쿠사수's "할 일": what has to be done, in a few words and without values (at most 40 characters) */
  todo: string;
  /** Commands to look with first, typed as-is on the fix's host; no values in them */
  checks: string[];
  /** How the fix is done when it isn't typed (a mini-game, a NOC button): the "명령" line's last part */
  fixHow?: string;
  concept: string;
  /** One line shown when solved: what just happened */
  lesson: string;
}

/**
 * A kind of incident that can happen on its first day and any later day. Variants change parameters
 * only (which port, which VLAN, which rack) — never the text a player reads, so hints stay valid.
 * Instance ids are `${id}:${variantIndex}`.
 */
export interface IncidentTemplate {
  id: string;
  /** First day it can happen (it is taught that day) */
  day: StageId;
  /** Last day it can happen (default: D-Day). Set it when a later world lacks the layer it breaks. */
  until?: StageId;
  variants: Record<string, string | number>[];
  /** Build the scenario for one variant. Must work on the world of `day` and every later day. */
  make: (v: Record<string, string | number>) => Omit<Scenario, 'id' | 'stage' | 'trigger'>;
  /** Relative draw weight as an extra (default 1); 0 = never drawn as an extra */
  weight?: number;
}

export interface ScenarioRuntime {
  id: string;
  state: 'waiting' | 'active' | 'resolved';
  /** Trigger for this run (the day's scheduler may replace the scenario's own) */
  trigger: Trigger;
  /** Stage time when it becomes active (waiting) or became active */
  at: number | null;
  activatedAt: number | null;
  resolvedAt: number | null;
  /** Stage time the player handed it to another team (담당팀 이관) */
  escalatedAt: number | null;
}

/** A planned incident: which scenario instance, with which trigger. */
export interface PlannedIncident {
  id: string;
  trigger: Trigger;
}

export function initRuntime(plan: PlannedIncident[]): ScenarioRuntime[] {
  return plan.map((p) => ({ id: p.id, state: 'waiting', trigger: p.trigger, at: null, activatedAt: null, resolvedAt: null, escalatedAt: null }));
}

/**
 * Advance scenario state: schedule, activate (inject), and resolve (check).
 * Only the scenarios planned for this run (`rt`) take part; `registry` looks their definitions up.
 * Mutates `w` and `rt`; returns ids that activated and resolved this tick.
 */
export function tickScenarios(
  registry: (id: string) => Scenario,
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

  for (const r of rt) {
    const s = registry(r.id);
    if (r.state === 'waiting') {
      const tr = r.trigger;
      if (r.at === null) {
        if (tr.type === 'stageStart') r.at = tr.delay ?? 0;
        else if (tr.type === 'gate') {
          const opened = gateOpenedAt(tr, resolvedAt, objectivesDone);
          if (opened !== null) r.at = opened + (tr.delay ?? INCIDENT_GAP);
        } else if (tr.type === 'condition' && tr.when(w, ctx)) r.at = ctx.stageTime;
      }
      if (r.at !== null && ctx.stageTime >= r.at) {
        // Timed incidents keep the 10 s breather after a fix, unless another incident is still running
        // or the timeline says they overlap on purpose (D-Day).
        if (tr.type === 'stageStart' && !tr.overlap && !rt.some((x) => x.state === 'active')) {
          const lastFix = Math.max(-Infinity, ...rt.map((x) => x.resolvedAt ?? -Infinity));
          if (ctx.stageTime < lastFix + INCIDENT_GAP) continue;
        }
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
