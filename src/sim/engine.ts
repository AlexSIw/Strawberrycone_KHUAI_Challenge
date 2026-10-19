// Stage runtime: the game loop without any UI. The Zustand store and the tests both drive this.
import { getStage } from '../content/stages';
import type { StageDef } from '../content/types';
import { runCommand } from './commands';
import { initRuntime, tickScenarios, type ScenarioRuntime } from './scenario';
import { clone, step } from './step';
import type { Health, PlayContext, StageId, World } from './types';

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
  world: World;
  ctx: PlayContext;
  scenarios: ScenarioRuntime[];
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
}

const HISTORY = 120;

export function startStage(id: StageId): StageRun {
  const def = getStage(id);
  const world = def.initialWorld();
  const ctx: PlayContext = { visited: [], events: [], commands: [], resolved: [], stageTime: 0, eventTimes: {} };
  const run: StageRun = {
    stage: id,
    world,
    ctx,
    scenarios: initRuntime(def.scenarios),
    objectivesDone: {},
    health: def.health(world),
    history: [],
    availabilitySum: 0,
    ticks: 0,
    hintLevel: {},
    revealed: [],
  };
  return run;
}

/** Objectives that are visible (their prerequisite objectives are done and gating incidents resolved). */
export function visibleObjectives(def: StageDef, run: StageRun) {
  return def.objectives.filter(
    (o) => (o.after ?? []).every((a) => a in run.objectivesDone) && (o.afterIncidents ?? []).every((id) => run.ctx.resolved.includes(id)),
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
    objectivesDone: { ...run.objectivesDone },
    hintLevel: { ...run.hintLevel },
    revealed: [...run.revealed],
  };
}

/** Advance one second of game time. */
export function tickRun(prev: StageRun, dt = 1): TickResult {
  const def = getStage(prev.stage);
  const run = cloneRun(prev);
  run.world = step(run.world, dt);
  run.ctx.stageTime = run.world.t;
  const healthBefore = def.health(run.world);
  const { activated, resolved } = tickScenarios(def.scenarios, run.scenarios, run.world, run.ctx, healthBefore, (id) =>
    id in run.objectivesDone ? run.objectivesDone[id] : null,
  );
  run.ctx.resolved.push(...resolved);
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
  return { run, activated, resolved, completed };
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

/** A mini-game changed the world directly. */
export function applyAction(prev: StageRun, action: (w: World) => void, events: string[] = []): { run: StageRun; completed: string[] } {
  const def = getStage(prev.stage);
  const run = cloneRun(prev);
  action(run.world);
  withEvents(run, events);
  run.health = def.health(run.world);
  return { run, completed: evaluateObjectives(def, run) };
}

export interface CommandOutcome {
  run: StageRun;
  lines: string[];
  host: string;
  clear: boolean;
  openHint: boolean;
  completed: string[];
}

export function applyCommand(prev: StageRun, line: string, host: string): CommandOutcome {
  const def = getStage(prev.stage);
  const res = runCommand(line, prev.world, host, prev.stage);
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
    clear: !!res.clear,
    openHint: !!res.openHint,
    completed: evaluateObjectives(def, run),
  };
}

export function activeScenarios(run: StageRun) {
  const def = getStage(run.stage);
  return run.scenarios
    .filter((r) => r.state === 'active')
    .map((r) => ({ rt: r, def: def.scenarios.find((s) => s.id === r.id)! }));
}

export function isCleared(run: StageRun): boolean {
  const def = getStage(run.stage);
  const objectivesOk = def.objectives.every((o) => o.id in run.objectivesDone);
  const scenariosOk = def.scenarios.every((s) => {
    const r = run.scenarios.find((x) => x.id === s.id)!;
    return r.state === 'resolved' || (s.optional && r.state === 'waiting');
  });
  return objectivesOk && scenariosOk;
}

export interface Score {
  stars: 1 | 2 | 3;
  points: number;
  availability: number;
  mttr: number | null;
  hintPenalty: number;
  revealed: number;
}

/** Score units (×5 points) charged per incident for the highest hint level seen. */
export const HINT_COST = [0, 0, 1, 2];

export function scoreRun(run: StageRun): Score {
  const solved = run.scenarios.filter((s) => s.state === 'resolved' && s.activatedAt !== null && s.resolvedAt !== null);
  const mttr = solved.length ? solved.reduce((a, s) => a + (s.resolvedAt! - s.activatedAt!), 0) / solved.length : null;
  const hintPenalty = Object.values(run.hintLevel).reduce((a, l) => a + HINT_COST[l], 0);
  const availability = run.ticks ? run.availabilitySum / run.ticks : 1;
  let points = 100;
  points -= hintPenalty * 5;
  points -= run.revealed.length * 15;
  if (mttr !== null) points -= Math.max(0, Math.min(30, (mttr - 45) / 3));
  points -= Math.max(0, (0.9 - availability) * 50);
  points = Math.max(0, Math.round(points));
  const stars = points >= 85 ? 3 : points >= 60 ? 2 : 1;
  return { stars, points, availability, mttr, hintPenalty, revealed: run.revealed.length };
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
