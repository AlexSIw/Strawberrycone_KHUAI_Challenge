// Day runtime: the game loop without any UI. The Zustand store and the tests both drive this.
import { getStage, planIncidents } from '../content/stages';
import type { StageDef } from '../content/types';
import { POLL_EVERY, updateAlarms, type Alarm } from './alarms';
import { fmtClock, gameSec } from './clock';
import { runCommand } from './commands';
import { syncNet } from './net/sync';
import { initRuntime, tickScenarios, type Scenario, type ScenarioRuntime } from './scenario';
import { clone, step } from './step';
import type { Health, IosMode, PlayContext, StageId, World } from './types';

export interface MetricPoint {
  t: number;
  availability: number;
  latencyMs: number;
  errorRate: number;
  rps: number;
  maxTemp: number;
  powerKw: number;
}

export interface StageRun {
  stage: StageId;
  /** Seed of this run's incident plan (from the save) */
  seed: number;
  world: World;
  ctx: PlayContext;
  /** The incidents planned for this run (not every scenario in the day's registry) */
  scenarios: ScenarioRuntime[];
  /** NOC alarm list */
  alarms: Alarm[];
  /** objective id → stage time it was completed */
  objectivesDone: Record<string, number>;
  health: Health;
  history: MetricPoint[];
  availabilitySum: number;
  ticks: number;
  /** scenario id → highest hint level the player has seen (1–3) */
  hintLevel: Record<string, number>;
  revealed: string[];
}

export interface TickResult {
  run: StageRun;
  activated: string[];
  resolved: string[];
  completed: string[];
  /** Alarms that showed up in the NOC this tick */
  raised: string[];
}

const HISTORY = 120;

const registries = new WeakMap<StageDef, Map<string, Scenario>>();

/** Look a scenario instance up in the day's registry. */
export function scenarioOf(def: StageDef, id: string): Scenario {
  let m = registries.get(def);
  // Rebuilt if the registry grew (tests add synthetic incidents to a day).
  if (!m || m.size !== def.scenarios.length) {
    m = new Map(def.scenarios.map((s) => [s.id, s]));
    registries.set(def, m);
  }
  const s = m.get(id);
  if (!s) throw new Error(`scenario ${id} is not in ${def.label}'s registry`);
  return s;
}

export function startStage(id: StageId, seed = 1): StageRun {
  const def = getStage(id);
  const world = def.initialWorld();
  if (world.net) syncNet(world, 0);
  const ctx: PlayContext = { visited: [], events: [], commands: [], resolved: [], stageTime: 0, eventTimes: {} };
  return {
    stage: id,
    seed,
    world,
    ctx,
    scenarios: initRuntime(planIncidents(def, seed)),
    alarms: [],
    objectivesDone: {},
    health: def.health(world),
    history: [],
    availabilitySum: 0,
    ticks: 0,
    hintLevel: {},
    revealed: [],
  };
}

/** Objectives that are visible (their prerequisite objectives are done and gating incidents resolved). */
export function visibleObjectives(def: StageDef, run: StageRun) {
  return def.objectives.filter(
    (o) =>
      (o.after ?? []).every((a) => a in run.objectivesDone) &&
      (o.afterIncidents ?? []).every((id) => run.ctx.resolved.includes(id)) &&
      (o.afterFired ?? []).every((id) => run.scenarios.some((s) => s.id === id && s.state !== 'waiting')),
  );
}

function evaluateObjectives(def: StageDef, run: StageRun): string[] {
  const completed: string[] = [];
  // Loop so that chained objectives completed by the same action are all picked up.
  for (let changed = true; changed; ) {
    changed = false;
    for (const o of visibleObjectives(def, run)) {
      if (o.id in run.objectivesDone) continue;
      if (o.done(run.world, run.ctx)) {
        run.objectivesDone[o.id] = run.ctx.stageTime;
        completed.push(o.id);
        changed = true;
      }
    }
  }
  return completed;
}

function cloneRun(run: StageRun): StageRun {
  return {
    ...run,
    world: clone(run.world),
    ctx: {
      ...run.ctx,
      visited: [...run.ctx.visited],
      events: [...run.ctx.events],
      commands: [...run.ctx.commands],
      resolved: [...run.ctx.resolved],
      eventTimes: { ...run.ctx.eventTimes },
    },
    scenarios: run.scenarios.map((s) => ({ ...s })),
    alarms: run.alarms.map((a) => ({ ...a })),
    objectivesDone: { ...run.objectivesDone },
    hintLevel: { ...run.hintLevel },
    revealed: [...run.revealed],
  };
}

/** Advance one second of day time. */
export function tickRun(prev: StageRun, dt = 1): TickResult {
  const def = getStage(prev.stage);
  const reg = (id: string) => scenarioOf(def, id);
  const run = cloneRun(prev);
  run.world = step(run.world, dt);
  run.ctx.stageTime = run.world.t;
  def.onTick?.(run.world, run.ctx.stageTime);
  // Escalated incidents: the owning team fixes it once, `delay` seconds after the hand-over; the normal
  // check below then resolves it in this same tick (so MTTR = time to escalate + the team's delay).
  let teamFixed = false;
  for (const r of run.scenarios) {
    const esc = reg(r.id).escalate;
    if (r.state !== 'active' || r.escalatedAt === null || !esc) continue;
    const flag = `escalated:${r.id}`;
    if (!run.world.flags[flag] && run.ctx.stageTime >= r.escalatedAt + esc.delay) {
      esc.fix(run.world);
      run.world.flags[flag] = true;
      teamFixed = true;
    }
  }
  if (teamFixed && run.world.net) syncNet(run.world, 0);
  const healthBefore = def.health(run.world);
  const { activated, resolved } = tickScenarios(reg, run.scenarios, run.world, run.ctx, healthBefore, (id) =>
    id in run.objectivesDone ? run.objectivesDone[id] : null,
  );
  // Injects and fixes changed the network: refresh caches and syslog before anyone looks.
  if (run.world.net) syncNet(run.world, 0);
  run.ctx.resolved.push(...resolved);
  const al = updateAlarms(run.alarms, run.scenarios, reg, run.ctx.stageTime, def.pollEvery ?? POLL_EVERY);
  run.alarms = al.alarms;
  run.health = def.health(run.world);
  const completed = evaluateObjectives(def, run);
  const h = run.health;
  run.history = [
    ...run.history.slice(-(HISTORY - 1)),
    { t: run.world.t, availability: h.availability, latencyMs: h.latencyMs, errorRate: h.errorRate, rps: h.rps, maxTemp: h.maxTemp, powerKw: h.powerKw },
  ];
  // Availability is scored between incidents, from the first incident on: setup time isn't the
  // player's fault, and downtime during an incident is already priced by MTTR.
  const anyFired = run.scenarios.some((s) => s.activatedAt !== null);
  const anyActive = run.scenarios.some((s) => s.state === 'active');
  if (h.rps > 0 && anyFired && !anyActive) {
    run.availabilitySum += h.availability;
    run.ticks += 1;
  }
  return { run, activated, resolved, completed, raised: al.raised };
}

function withEvents(run: StageRun, events: string[]): void {
  for (const e of events) {
    if (!run.ctx.events.includes(e)) run.ctx.events.push(e);
    run.ctx.eventTimes[e] = run.world.t;
  }
}

/** Record UI events like "open:terminal" or "room:server". */
export function recordEvents(prev: StageRun, events: string[]): { run: StageRun; completed: string[] } {
  const def = getStage(prev.stage);
  const run = cloneRun(prev);
  withEvents(run, events);
  for (const e of events) {
    if (e.startsWith('room:')) {
      const room = e.slice(5);
      if (!run.ctx.visited.includes(room)) run.ctx.visited.push(room);
    }
  }
  return { run, completed: evaluateObjectives(def, run) };
}

/** A mini-game or a NOC button changed the world directly. */
export function applyAction(prev: StageRun, action: (w: World) => void, events: string[] = []): { run: StageRun; completed: string[] } {
  const def = getStage(prev.stage);
  const run = cloneRun(prev);
  action(run.world);
  if (run.world.net) syncNet(run.world, 0);
  withEvents(run, events);
  run.health = def.health(run.world);
  return { run, completed: evaluateObjectives(def, run) };
}

export interface CommandOutcome {
  run: StageRun;
  lines: string[];
  host: string;
  /** IOS mode after the line (null: a shell, or the session left the device) */
  mode: IosMode | null;
  clear: boolean;
  openHint: boolean;
  completed: string[];
}

export function applyCommand(prev: StageRun, line: string, host: string, mode: IosMode | null = null): CommandOutcome {
  const def = getStage(prev.stage);
  const res = runCommand(line, prev.world, host, prev.stage, mode);
  const run = cloneRun(prev);
  run.world = res.world;
  const trimmed = line.trim();
  if (trimmed) run.ctx.commands.push(trimmed);
  withEvents(run, res.events ?? []);
  run.health = def.health(run.world);
  return {
    run,
    lines: res.lines,
    host: res.host ?? host,
    mode: res.mode === undefined ? mode : res.mode,
    clear: !!res.clear,
    openHint: !!res.openHint,
    completed: evaluateObjectives(def, run),
  };
}

export function activeScenarios(run: StageRun) {
  const def = getStage(run.stage);
  return run.scenarios.filter((r) => r.state === 'active').map((r) => ({ rt: r, def: scenarioOf(def, r.id) }));
}

/** The player acknowledged an alarm in the NOC (MTTD stops here). */
export function ackAlarm(prev: StageRun, alarmId: string): StageRun {
  const run = cloneRun(prev);
  const a = run.alarms.find((x) => x.id === alarmId);
  if (a && a.ackAt === null) a.ackAt = run.ctx.stageTime;
  return run;
}

/** Can this incident be handed to its owning team right now? (shallow-area incidents, active, not handed over yet) */
export function canEscalate(run: StageRun, scenarioId: string): boolean {
  const r = run.scenarios.find((x) => x.id === scenarioId);
  return !!r && r.state === 'active' && r.escalatedAt === null && !!scenarioOf(getStage(run.stage), r.id).escalate;
}

/**
 * Hand a shallow-area incident to its owning team (담당팀 이관). Also acknowledges its alarm.
 * Returns `prev` unchanged when the incident can't be escalated.
 */
export function escalate(prev: StageRun, scenarioId: string): StageRun {
  if (!canEscalate(prev, scenarioId)) return prev;
  const run = ackAlarm(prev, scenarioId);
  run.scenarios.find((x) => x.id === scenarioId)!.escalatedAt = run.ctx.stageTime;
  return run;
}

/**
 * May this planned incident never happen? Optional scenarios, and anything on a `condition` trigger (a
 * mistake the player may never make — the scheduler doesn't gate on those either).
 */
export function isOptional(def: StageDef, r: ScenarioRuntime): boolean {
  return !!scenarioOf(def, r.id).optional || r.trigger.type === 'condition';
}

/** Every mission done, and every incident that fired is fixed (optional ones that never fired don't count). */
export function isCleared(run: StageRun): boolean {
  const def = getStage(run.stage);
  const objectivesOk = def.objectives.every((o) => o.id in run.objectivesDone);
  const scenariosOk = run.scenarios.every((r) => r.state === 'resolved' || (r.state === 'waiting' && isOptional(def, r)));
  return objectivesOk && scenariosOk;
}

/** The wall clock for the HUD: 'HH:MM' on weekdays, 'HH:MM:SS' on D-Day (it runs in phases). */
export function clockText(run: StageRun): string {
  const def = getStage(run.stage);
  return fmtClock(gameSec(def.clock, run.ctx.stageTime), !!def.clock.phases?.length);
}

export interface Score {
  stars: 1 | 2 | 3;
  points: number;
  availability: number;
  /** Mean time from incident start to the player's ACK (or the fix, if never acknowledged) */
  mttd: number | null;
  mttr: number | null;
  hintPenalty: number;
  revealed: number;
  /** Incidents handed to another team */
  escalated: number;
}

/** Score units (×5 points) charged per incident for the highest hint level seen. */
export const HINT_COST = [0, 0, 1, 2];

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function scoreRun(run: StageRun): Score {
  const solved = run.scenarios.filter((s) => s.state === 'resolved' && s.activatedAt !== null && s.resolvedAt !== null);
  const mttr = mean(solved.map((s) => s.resolvedAt! - s.activatedAt!));
  const mttd = mean(
    solved.map((s) => {
      const ack = run.alarms.find((a) => a.scenarioId === s.id)?.ackAt;
      return (ack ?? s.resolvedAt!) - s.activatedAt!;
    }),
  );
  const hintPenalty = Object.values(run.hintLevel).reduce((a, l) => a + HINT_COST[l], 0);
  const availability = run.ticks ? run.availabilitySum / run.ticks : 1;
  let points = 100;
  points -= hintPenalty * 5;
  points -= run.revealed.length * 15;
  if (mttr !== null) points -= Math.max(0, Math.min(30, (mttr - 45) / 3));
  // Detection weighs little: it's a habit to learn, and spamming ACK shouldn't pay.
  if (mttd !== null) points -= Math.max(0, Math.min(10, (mttd - 15) / 2));
  points -= Math.max(0, (0.9 - availability) * 50);
  points = Math.max(0, Math.round(points));
  const stars = points >= 85 ? 3 : points >= 60 ? 2 : 1;
  const escalated = run.scenarios.filter((s) => s.escalatedAt !== null).length;
  return { stars, points, availability, mttd, mttr, hintPenalty, revealed: run.revealed.length, escalated };
}

/** The player asked for a hint on a scenario. Returns the new level (1–3). */
export function bumpHint(prev: StageRun, scenarioId: string): { run: StageRun; level: number } {
  const run = cloneRun(prev);
  const level = Math.min(3, (run.hintLevel[scenarioId] ?? 0) + 1);
  run.hintLevel[scenarioId] = level;
  return { run, level };
}

export function revealSolution(prev: StageRun, scenarioId: string): StageRun {
  const run = cloneRun(prev);
  if (!run.revealed.includes(scenarioId)) run.revealed.push(scenarioId);
  return run;
}
