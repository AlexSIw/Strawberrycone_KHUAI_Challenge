// Explain before doing: every objective says what the new thing is and why we need it today (`why`)
// before the player acts, every card a day names exists, the first-time guides (`steps`) tick in order from
// what the player really does and are all done by the time their objective is, and a day started cold
// (`recap`, D-Day's `primer`) points at cards the earlier days really award.
// Two parts: D-5 … D-3, then D-2 · D-1 · D-Day. Each day's describe block is named after the day.
import { describe, expect, it } from 'vitest';
import { CONCEPTS } from '../src/content/concepts';
import { getStage } from '../src/content/stages';
import type { Objective, StageDef } from '../src/content/types';
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
import { AUTOPLAY, apply, type Step } from './autoplay';

// ---------- D-5 … D-3 ----------

/** Apply one autoplay / solution step line by line, calling `seen` after every change (an IOS script per line). */
function applyEach(run: StageRun, step: Step | SolutionStep, seen: (r: StageRun) => void): StageRun {
  if ('ios' in step) {
    let mode: IosMode | null = { level: 'user' };
    for (const line of step.ios) {
      const res = applyCommand(run, line, step.host, mode);
      run = res.run;
      mode = res.mode;
      seen(run);
    }
    return run;
  }
  if ('cmd' in step) run = applyCommand(run, step.cmd, step.host).run;
  else if ('action' in step) run = applyAction(run, step.action, 'events' in step ? (step.events ?? []) : []).run;
  else run = recordEvents(run, step.events).run;
  seen(run);
  return run;
}

interface GuideReport {
  /** Objectives with a guide that completed in the run, and which of their steps were done at that moment */
  atDone: Record<string, boolean[]>;
  /** "objective: flags" whenever a later step was done while an earlier one wasn't */
  outOfOrder: string[];
  cleared: boolean;
}

const flags = (o: Objective, r: StageRun) => (o.steps ?? []).map((s) => s.done(r.world, r.ctx));

/**
 * Play the day like tests/autoplay.ts playDay (missions, ACK alarms 2 s after they show, solutions 2 s
 * after that), checking the guides after every command, action and tick.
 */
function playWatchingGuides(day: StageId, seed: number, maxTicks = 900): GuideReport {
  const def = getStage(day);
  const guided = def.objectives.filter((o) => o.steps?.length);
  const atDone: Record<string, boolean[]> = {};
  const outOfOrder: string[] = [];
  const seen = (r: StageRun) => {
    const visible = new Set(visibleObjectives(def, r).map((o) => o.id));
    for (const o of guided) {
      if (o.id in r.objectivesDone) {
        if (!(o.id in atDone)) atDone[o.id] = flags(o, r);
        continue;
      }
      if (!visible.has(o.id)) continue;
      const f = flags(o, r);
      if (f.some((d, i) => d && f.slice(0, i).some((x) => !x))) outOfOrder.push(`${o.id}: ${f.map((x) => (x ? '✓' : '·')).join('')}`);
    }
  };
  let run = startStage(day, seed);
  const solved = new Set<string>();
  for (let i = 0; i < maxTicks && !(def.objectives.every((o) => o.id in run.objectivesDone) && run.scenarios.every((s) => s.state !== 'active')); i++) {
    for (const o of visibleObjectives(def, run)) {
      if (o.id in run.objectivesDone) continue;
      for (const st of AUTOPLAY[day]?.[o.id] ?? []) run = applyEach(run, st, seen);
    }
    run = tickRun(run).run;
    seen(run);
    const now = run.ctx.stageTime;
    for (const a of run.alarms) if (a.ackAt === null && a.clearedAt === null && now >= a.raisedAt + 2) run = ackAlarm(run, a.id);
    for (const a of run.alarms) {
      const r = run.scenarios.find((x) => x.id === a.scenarioId);
      if (!r || r.state !== 'active' || a.ackAt === null || solved.has(r.id) || now < a.ackAt + 2) continue;
      for (const st of scenarioOf(def, r.id).solutionSteps) run = applyEach(run, st, seen);
      solved.add(r.id);
    }
  }
  return { atDone, outOfOrder, cleared: def.objectives.every((o) => o.id in run.objectivesDone) };
}

/** Cards a day surely awards: its objectives' cards and its always-on incidents' cards (not random extras). */
function guaranteedCards(def: StageDef): string[] {
  const fromObjectives = def.objectives.flatMap((o) => [...(o.concept ? [o.concept] : []), ...(o.alsoConcepts ?? [])]);
  const fixed = def.fixed.map((f) => f.template);
  const fromIncidents = def.scenarios.filter((s) => fixed.includes(s.id.split(':')[0])).map((s) => s.concept);
  return [...fromObjectives, ...fromIncidents];
}

const SEEDS = [1, 2, 3, 4];

describe.each([
  ['D-5', 0],
  ['D-4', 1],
  ['D-3', 2],
] as [string, StageId][])('%s: explain before doing', (_label, day) => {
  const def = getStage(day);

  it('every objective says why before the player acts (and every one that awards a card does)', () => {
    for (const o of def.objectives) {
      expect(o.why?.trim(), `${o.id} has no why`).toBeTruthy();
      // 1–3 short sentences, not a lecture.
      expect(o.why!.length, `${o.id}: why is too long`).toBeLessThanOrEqual(260);
    }
  });

  it('every card it names exists (objective cards, extra cards, incident cards, recap)', () => {
    const named = [
      ...def.objectives.flatMap((o) => [...(o.concept ? [o.concept] : []), ...(o.alsoConcepts ?? [])]),
      ...def.scenarios.map((s) => s.concept),
      ...(def.recap?.concepts ?? []),
    ];
    expect(named.filter((c) => !(c in CONCEPTS))).toEqual([]);
  });

  it('first-time guides are short and every step says what to do', () => {
    for (const o of def.objectives) {
      if (!o.steps) continue;
      expect(o.steps.length, o.id).toBeGreaterThanOrEqual(2);
      expect(o.steps.length, o.id).toBeLessThanOrEqual(8);
      for (const s of o.steps) expect(s.text.trim(), o.id).toBeTruthy();
    }
  });

  it.each(SEEDS)('seed %i: every guide ticks in order and is all done when its objective is', (seed) => {
    const r = playWatchingGuides(day, seed);
    expect(r.cleared).toBe(true);
    expect(r.outOfOrder).toEqual([]);
    const guided = def.objectives.filter((o) => o.steps?.length).map((o) => o.id);
    expect(Object.keys(r.atDone).sort()).toEqual([...guided].sort());
    for (const [id, f] of Object.entries(r.atDone)) expect(f.every(Boolean), `${id}: ${f.map((x) => (x ? '✓' : '·')).join('')}`).toBe(true);
  }, 60_000);

  if (day > 0) {
    it('a cold start gets a recap: what earlier days built, and cards the earlier days surely award', () => {
      const recap = def.recap!;
      expect(recap).toBeDefined();
      expect(recap.built.length).toBeGreaterThanOrEqual(3);
      expect(recap.built.length).toBeLessThanOrEqual(6);
      expect(recap.concepts.length).toBeGreaterThanOrEqual(3);
      expect(recap.concepts.length).toBeLessThanOrEqual(8);
      const earlier = new Set(Array.from({ length: day }, (_, d) => guaranteedCards(getStage(d as StageId))).flat());
      expect(recap.concepts.filter((c) => !earlier.has(c))).toEqual([]);
    });
  }
});

describe('D-4 / D-3: cards that used to come only from random extras have a guaranteed home', () => {
  it('the gateway card comes with D-4’s gateway mission, the isolation card with D-3’s split', () => {
    expect(getStage(1).objectives.find((o) => o.id === 'gateway')?.alsoConcepts).toContain('gateway');
    expect(getStage(2).objectives.find((o) => o.id === 'msa')?.alsoConcepts).toContain('isolation');
  });
});

// ---------- D-2 · D-1 · D-Day ----------

/** Cards first met on these days: each one says what it does in this data center ("여기서는 …"). */
const FIRST_MET: Partial<Record<StageId, string[]>> = {
  3: ['container', 'portMapping', 'volume', 'oversubscription', 'lacp', 'stp'],
  4: ['pod', 'selfHealing', 'service', 'rollback', 'drain', 'reschedule', 'spof', 'failover'],
  5: ['triage', 'postmortem', 'scaleOut', 'queue', 'peak', 'firewall'],
};

/** Cards that used to come only from a random extra and now have a guaranteed home on this day. */
const HOMES: Partial<Record<StageId, string[]>> = { 4: ['service', 'rollback'], 5: ['queue', 'firewall'] };

interface Walk {
  /** Per objective with steps: the moment (action count) each step was first seen done (-1: never) */
  first: Map<string, number[]>;
  /** Steps still open when their objective completed */
  open: string[];
  completed: Set<string>;
  cleared: boolean;
}

/**
 * Play the day like tests/autoplay.ts playDay (missions' AUTOPLAY rows, every alarm ACKed 2 s after it
 * shows, its solution 2 s after that), but one command (one IOS line) at a time, looking at the visible
 * missions' guides after each.
 */
function walk(day: StageId, seed: number): Walk {
  const def = getStage(day);
  const guided = def.objectives.filter((o) => o.steps?.length);
  const first = new Map(guided.map((o) => [o.id, o.steps!.map(() => -1)]));
  const open: string[] = [];
  const completed = new Set<string>();
  let clock = 0;
  const look = (r: StageRun) => {
    clock++;
    const shown = new Set(visibleObjectives(def, r).map((o) => o.id));
    for (const o of guided) {
      if (!shown.has(o.id) && !(o.id in r.objectivesDone)) continue;
      const f = first.get(o.id)!;
      o.steps!.forEach((s, i) => {
        if (f[i] < 0 && s.done(r.world, r.ctx)) f[i] = clock;
      });
      if (o.id in r.objectivesDone && !completed.has(o.id)) {
        completed.add(o.id);
        for (const s of o.steps!) if (!s.done(r.world, r.ctx)) open.push(`${o.id}: ${s.text}`);
      }
    }
  };
  const act = (r: StageRun, st: Step | SolutionStep): StageRun => {
    if ('ios' in st) {
      let mode: IosMode | null = { level: 'user' };
      for (const line of st.ios) {
        const res = applyCommand(r, line, st.host, mode);
        r = res.run;
        mode = res.mode;
        look(r);
      }
      return r;
    }
    r = apply(r, st, null);
    look(r);
    return r;
  };

  let run = startStage(day, seed);
  look(run);
  const solved = new Set<string>();
  for (let i = 0; i < 900 && !isCleared(run); i++) {
    for (const o of visibleObjectives(def, run)) {
      if (o.id in run.objectivesDone) continue;
      for (const st of AUTOPLAY[day]?.[o.id] ?? []) run = act(run, st);
    }
    run = tickRun(run).run;
    look(run);
    const now = run.ctx.stageTime;
    for (const a of run.alarms) {
      if (a.ackAt === null && a.clearedAt === null && now >= a.raisedAt + 2) run = ackAlarm(run, a.id);
    }
    for (const a of run.alarms) {
      const r = run.scenarios.find((x) => x.id === a.scenarioId);
      if (!r || r.state !== 'active' || a.ackAt === null || solved.has(r.id) || now < a.ackAt + 2) continue;
      for (const st of scenarioOf(def, r.id).solutionSteps) run = act(run, st);
      solved.add(r.id);
    }
  }
  return { first, open, completed, cleared: isCleared(run) };
}

describe.each([
  ['D-2', 3],
  ['D-1', 4],
  ['D-Day', 5],
] as [string, StageId][])('%s', (_label, day) => {
  const def = getStage(day);

  it('every mission that brings a concept card first says what it is and why we need it (why)', () => {
    const missing = def.objectives.filter((o) => (o.concept || o.alsoConcepts?.length) && !o.why?.trim()).map((o) => o.id);
    expect(missing).toEqual([]);
  });

  it('every concept card the day names exists (missions, extra cards, incidents, recap)', () => {
    const named = [
      ...def.objectives.flatMap((o) => [o.concept, ...(o.alsoConcepts ?? [])]),
      ...def.scenarios.map((s) => s.concept),
      ...(def.recap?.concepts ?? []),
    ].filter((id): id is string => !!id);
    expect(named.filter((id) => !(id in CONCEPTS))).toEqual([]);
  });

  it('a cold start gets a recap of what earlier days built and the cards it relies on', () => {
    expect(def.recap).toBeDefined();
    expect(def.recap!.built.length).toBeGreaterThanOrEqual(3);
    expect(def.recap!.built.length).toBeLessThanOrEqual(6);
    expect(def.recap!.concepts.length).toBeGreaterThanOrEqual(3);
    expect(def.recap!.concepts.length).toBeLessThanOrEqual(8);
    expect(def.recap!.concepts.filter((id) => !(id in CONCEPTS))).toEqual([]);
  });

  it('cards first met today say what they do here, not only what they are', () => {
    const plain = (FIRST_MET[day] ?? []).filter((id) => !CONCEPTS[id]?.definition.includes('여기서는'));
    expect(plain).toEqual([]);
  });

  it('cards that used to come only from a random extra have a guaranteed home today', () => {
    // Missions, and the fixed incidents that always happen (not a condition the player may avoid).
    const always = def.fixed.filter((f) => f.trigger.type !== 'condition').map((f) => `${f.template}:`);
    const guaranteed = new Set([
      ...def.objectives.flatMap((o) => [o.concept, ...(o.alsoConcepts ?? [])]),
      ...def.scenarios.filter((s) => always.some((p) => s.id.startsWith(p))).map((s) => s.concept),
    ]);
    expect((HOMES[day] ?? []).filter((id) => !guaranteed.has(id))).toEqual([]);
  });

  it('first-time guides are short and every step says what to do', () => {
    for (const o of def.objectives) {
      if (!o.steps) continue;
      expect(o.steps.length, o.id).toBeGreaterThanOrEqual(2);
      expect(o.steps.length, o.id).toBeLessThanOrEqual(8);
      for (const s of o.steps) expect(s.text.trim(), o.id).not.toBe('');
    }
  });

  const guided = def.objectives.filter((o) => o.steps?.length).map((o) => o.id);
  if (guided.length) {
    it.each([1, 2, 3, 4, 5, 6])('seed %i: on the autoplay run every guide step ticks, in order, by the time its mission completes', (seed) => {
      const w = walk(day, seed);
      expect(w.cleared).toBe(true);
      expect(w.open).toEqual([]);
      for (const id of guided) {
        expect(w.completed.has(id), id).toBe(true);
        const f = w.first.get(id)!;
        expect(f.every((t) => t > 0), `${id}: ${f.join(',')}`).toBe(true);
        for (let i = 1; i < f.length; i++) expect(f[i], `${id} step ${i + 1} before step ${i}: ${f.join(',')}`).toBeGreaterThanOrEqual(f[i - 1]);
      }
    }, 60_000);
  }
});

describe('D-Day', () => {
  it('a cold start (D-Day 바로 체험) gets a primer: each tool with the role it plays today', () => {
    const p = getStage(5).primer ?? [];
    expect(p.length).toBeGreaterThanOrEqual(4);
    for (const t of p) {
      expect(t.tool.trim()).not.toBe('');
      expect(t.role.trim()).not.toBe('');
    }
    const tools = p.map((t) => t.tool).join(' ');
    for (const tool of ['ACK', 'scale', 'env set', 'LACP', 'fw top', 'fw deny']) expect(tools).toContain(tool);
  });
});
