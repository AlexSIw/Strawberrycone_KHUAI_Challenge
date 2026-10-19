// Incident pacing: an incident waits until the player has finished the objectives in front of it,
// then fires INCIDENT_GAP (10) stage seconds later; the next one fires 10 s after the previous one is
// solved. These tests play every stage with prompt, slow and random-timing players to prove it, and that no stage
// can deadlock on an objective that needs an incident (or the other way round).
import { describe, expect, it } from 'vitest';
import { STAGES, getStage } from '../src/content/stages';
import { isCleared, startStage, tickRun, visibleObjectives, type StageRun } from '../src/sim/engine';
import { gateOpenedAt, INCIDENT_GAP, type Trigger } from '../src/sim/scenario';
import type { StageId } from '../src/sim/types';
import { apply, AUTOPLAY, type Step } from './autoplay';

interface PlayOpts {
  /** Seconds the player waits after an objective appears before doing it (0 = right away) */
  slow?: number;
  /** Seconds after an incident fires before the player applies its documented fix */
  react?: number;
  /** Objectives the player never does */
  skip?: string[];
  /** Incidents the player never fixes */
  leave?: string[];
  /** Different ways of doing some objectives */
  steps?: Record<string, Step[]>;
  /** Play exactly this long instead of until the stage is cleared */
  seconds?: number;
  /** Random 0..1 source: when set, each objective waits 0–44 s and each fix 0–49 s instead of slow/react */
  rand?: () => number;
  /** Things a player may do on their own at a given stage second (e.g. fix a problem before its alert) */
  early?: { at: number; steps: Step[] }[];
}

interface Played {
  run: StageRun;
  /** For each incident that fired: visible objectives the player had not finished at that moment */
  pendingAtFire: Record<string, string[]>;
  errors: string[];
}

function play(stage: StageId, o: PlayOpts = {}): Played {
  const def = getStage(stage);
  const slow = o.slow ?? 0;
  const react = o.react ?? 2;
  let run = startStage(stage);
  const appeared: Record<string, number> = {};
  const fixed = new Set<string>();
  const pendingAtFire: Record<string, string[]> = {};
  const errors: string[] = [];
  const wait: Record<string, number> = {};
  const waitFor = (id: string, fixed: number, max: number) => (o.rand ? (wait[id] ??= Math.floor(o.rand() * max)) : fixed);
  const early = (o.early ?? []).map((e) => ({ ...e, done: false }));
  for (let i = 0; i < (o.seconds ?? 1000) && (o.seconds !== undefined || !isCleared(run)); i++) {
    for (const e of early) {
      if (e.done || run.ctx.stageTime < e.at) continue;
      for (const s of e.steps) run = apply(run, s, null);
      e.done = true;
    }
    for (const ob of visibleObjectives(def, run)) {
      if (ob.id in run.objectivesDone || o.skip?.includes(ob.id)) continue;
      appeared[ob.id] ??= run.ctx.stageTime;
      if (run.ctx.stageTime < appeared[ob.id] + waitFor(`objective:${ob.id}`, slow, 45)) continue;
      for (const s of o.steps?.[ob.id] ?? AUTOPLAY[stage]?.[ob.id] ?? []) run = apply(run, s, null);
    }
    const r = tickRun(run);
    run = r.run;
    for (const id of r.activated) {
      pendingAtFire[id] = visibleObjectives(def, run)
        .filter((x) => !(x.id in run.objectivesDone))
        .map((x) => x.id);
    }
    for (const rt of run.scenarios) {
      if (rt.state !== 'active' || fixed.has(rt.id) || o.leave?.includes(rt.id)) continue;
      if (run.ctx.stageTime < rt.activatedAt! + waitFor(`incident:${rt.id}`, react, 50)) continue;
      for (const s of def.scenarios.find((x) => x.id === rt.id)!.solutionSteps) run = apply(run, s, errors);
      fixed.add(rt.id);
    }
  }
  return { run, pendingAtFire, errors };
}

const rtOf = (run: StageRun, id: string) => run.scenarios.find((s) => s.id === id)!;
const gates = (tr: Trigger) => (tr.type === 'gate' ? tr : null);

/** When the incident should have fired, from what the run recorded. */
function expectedFireTime(run: StageRun, tr: Trigger): number | null {
  if (tr.type === 'stageStart') return tr.delay ?? 0;
  if (tr.type !== 'gate') return null;
  const opened = gateOpenedAt(
    tr,
    (id) => rtOf(run, id).resolvedAt,
    (id) => (id in run.objectivesDone ? run.objectivesDone[id] : null),
  );
  return opened === null ? null : opened + (tr.delay ?? INCIDENT_GAP);
}

// ---------------------------------------------------------------------------------------------

describe('pacing plan', () => {
  it('every stage chains its incidents as decided', () => {
    const plan = Object.fromEntries(
      STAGES.flatMap((d) => d.scenarios).map((s) => {
        const tr = s.trigger;
        if (tr.type === 'gate') return [s.id, `gate ${[...(tr.scenarios ?? []), ...(tr.objectives ?? [])].join('+')} +${tr.delay ?? INCIDENT_GAP}`];
        if (tr.type === 'stageStart') return [s.id, `start +${tr.delay ?? 0}`];
        return [s.id, 'condition'];
      }),
    );
    expect(plan).toEqual({
      's1-cable': 'gate mount+power+cable +10',
      's1-blackout': 'gate s1-cable +10',
      's1-pdu': 'gate s1-blackout +10',
      's2-dns': 'gate terminal+dhcp+ping +10',
      's2-conflict': 'gate s2-dns +10',
      's2-gateway': 'gate s2-conflict +10',
      's3-port': 'gate start +10',
      's3-thread': 'gate s3-port+curl +10',
      's3-404': 'gate s3-thread +10',
      's4-monolith': 'gate watch +10',
      's4-notify': 'gate s4-monolith +10',
      's4-course': 'gate s4-notify +10',
      's4-shared-db': 'gate s4-course +10',
      's5-drift': 'start +10',
      's5-port': 'condition',
      's5-volume': 'gate s5-drift+run+open +10',
      's6-crash': 'gate desired+observe +10',
      's6-ip': 'gate s6-crash +10',
      's6-crac': 'gate s6-ip +10',
      's6-traffic': 'gate s6-crac +10',
      's6-rollout': 'gate s6-traffic +10',
      's7-traffic': 'start +10',
      's7-cable': 'start +20',
      's7-cooling': 'start +40',
      's7-outage': 'condition',
    });
    expect(getStage(3).objectives.find((o) => o.id === 'curl')!.afterIncidents).toEqual(['s3-port']);
  });

  for (const def of STAGES) {
    it(`stage ${def.id}: gates point at real, non-optional things in the same stage, never sooner than the gap`, () => {
      const scenarioIds = new Set(def.scenarios.map((s) => s.id));
      const objectiveIds = new Set(def.objectives.map((o) => o.id));
      const optional = new Set(def.scenarios.filter((s) => s.optional).map((s) => s.id));
      for (const s of def.scenarios) {
        const g = gates(s.trigger);
        // Only optional incidents (reactions to a mistake) may wait on a condition.
        if (s.trigger.type === 'condition') expect(s.optional, `${s.id} uses a condition but is required`).toBe(true);
        if (!g) continue;
        expect((g.scenarios ?? []).length + (g.objectives ?? []).length, `${s.id} gate is empty`).toBeGreaterThan(0);
        for (const id of g.scenarios ?? []) {
          expect(scenarioIds.has(id), `${s.id} waits for unknown incident ${id}`).toBe(true);
          expect(optional.has(id), `${s.id} waits for optional ${id}, which may never fire`).toBe(false);
        }
        for (const id of g.objectives ?? []) expect(objectiveIds.has(id), `${s.id} waits for unknown objective ${id}`).toBe(true);
        expect(g.delay ?? INCIDENT_GAP, s.id).toBeGreaterThanOrEqual(INCIDENT_GAP);
      }
      for (const o of def.objectives) {
        for (const id of o.afterIncidents ?? []) {
          expect(scenarioIds.has(id), `${o.id} waits for unknown incident ${id}`).toBe(true);
          expect(optional.has(id), `${o.id} waits for optional ${id}`).toBe(false);
        }
      }
    });
  }
});

describe('incidents fire exactly when their gate says, and never mid-objective', () => {
  const players = [
    { name: 'prompt player', opts: { slow: 0, react: 2 } },
    { name: 'slow player (25 s per objective, 15 s per fix)', opts: { slow: 25, react: 15 } },
  ];
  for (const { name, opts } of players) {
    for (const def of STAGES) {
      it(`stage ${def.id}, ${name}: clears, with every incident on time`, () => {
        const { run, pendingAtFire, errors } = play(def.id, opts);
        expect(errors, 'documented fixes printed errors').toEqual([]);
        // No deadlock: every objective done, every required incident fired and resolved.
        expect(isCleared(run), `stage ${def.id} did not clear`).toBe(true);
        for (const s of def.scenarios) {
          const rt = rtOf(run, s.id);
          if (s.optional && rt.state === 'waiting') continue;
          expect(rt.state, s.id).toBe('resolved');
          if (s.trigger.type === 'condition') continue;
          // Exactly INCIDENT_GAP after the later of "previous incident solved" and "objectives done".
          expect(rt.activatedAt, `${s.id} fired at the wrong time`).toBe(expectedFireTime(run, s.trigger));
          // A gated incident never interrupts an objective the player is still working on.
          if (s.trigger.type === 'gate') expect(pendingAtFire[s.id], `${s.id} fired mid-objective`).toEqual([]);
        }
      });
    }
  }

  /** Things an eager player might do before the alert that asks for them. */
  const EARLY: Partial<Record<StageId, Step[][]>> = {
    // Fixing the port before s3-port fires, or getting a 200 OK from the wrong port.
    3: [[{ cmd: 'server set port 80', host: 'web' }], [{ cmd: 'curl http://web:8080/enroll', host: 'ops' }]],
    // Restarting notify (= the hotfix) before s4-notify fires.
    4: [[{ cmd: 'svc restart notify', host: 'ops' }]],
  };
  /** xorshift: the same "random" players on every run. */
  const seeded = (seed: number) => {
    let x = seed >>> 0 || 1;
    return () => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return ((x >>> 0) % 10000) / 10000;
    };
  };
  for (const def of STAGES) {
    it(`stage ${def.id}, 15 players with random timing: clear, every incident on time, ≥10 s after the one before`, () => {
      for (let seed = 1; seed <= 15; seed++) {
        const rand = seeded(seed * 7919 + def.id);
        const early = (EARLY[def.id] ?? []).map((steps) => ({ at: Math.floor(rand() * 60), steps }));
        const { run, pendingAtFire } = play(def.id, { rand, early });
        const why = `stage ${def.id}, player ${seed}`;
        expect(isCleared(run), `${why} did not clear`).toBe(true);
        for (const s of def.scenarios) {
          const rt = rtOf(run, s.id);
          if (s.optional && rt.state === 'waiting') continue;
          expect(rt.state, `${why}: ${s.id}`).toBe('resolved');
          if (s.trigger.type === 'condition') continue;
          expect(rt.activatedAt, `${why}: ${s.id} fired at the wrong time`).toBe(expectedFireTime(run, s.trigger));
          const g = gates(s.trigger);
          if (!g) continue;
          expect(pendingAtFire[s.id], `${why}: ${s.id} fired mid-objective`).toEqual([]);
          for (const id of g.scenarios ?? []) expect(rt.activatedAt! - rtOf(run, id).resolvedAt!, `${why}: ${id} → ${s.id}`).toBeGreaterThanOrEqual(INCIDENT_GAP);
          for (const id of g.objectives ?? []) expect(rt.activatedAt! - run.objectivesDone[id], `${why}: ${id} → ${s.id}`).toBeGreaterThanOrEqual(INCIDENT_GAP);
        }
        // Outside the stage 7 rush, required incidents come one at a time, each ≥10 s after the last was solved.
        if (def.id === 7) continue;
        const required = run.scenarios
          .filter((r) => r.activatedAt !== null && !def.scenarios.find((s) => s.id === r.id)!.optional)
          .sort((a, b) => a.activatedAt! - b.activatedAt!);
        for (let i = 1; i < required.length; i++) {
          const [prev, next] = [required[i - 1], required[i]];
          expect(next.activatedAt! - prev.resolvedAt!, `${why}: ${prev.id} → ${next.id}`).toBeGreaterThanOrEqual(INCIDENT_GAP);
        }
      }
    });
  }

  it('a chained incident waits 10 s after the previous fix, however long the fix took', () => {
    for (const react of [2, 15, 40]) {
      const { run } = play(1, { react });
      const cable = rtOf(run, 's1-cable');
      const blackout = rtOf(run, 's1-blackout');
      const pdu = rtOf(run, 's1-pdu');
      expect(blackout.activatedAt! - cable.resolvedAt!).toBe(10);
      expect(pdu.activatedAt! - blackout.resolvedAt!).toBe(10);
    }
  });

  it('the first incident waits 10 s after the LAST initial objective, not the first one', () => {
    const { run } = play(2, { slow: 25 });
    const done = run.objectivesDone;
    expect(done.ping).toBeGreaterThan(done.dhcp);
    expect(rtOf(run, 's2-dns').activatedAt).toBe(done.ping + 10);
  });

  it('stage 5: the data-loss incident waits for s5-drift AND the running, reachable container', () => {
    const { run } = play(5, { slow: 25 });
    const volume = rtOf(run, 's5-volume');
    const opened = Math.max(rtOf(run, 's5-drift').resolvedAt!, run.objectivesDone.run, run.objectivesDone.open);
    expect(volume.activatedAt).toBe(opened + 10);
  });
});

describe('no incident fires before its gate objectives are done', () => {
  /** Ways a player can leave an objective undone while doing everything else they can. */
  const HOW: Record<string, Pick<PlayOpts, 'steps' | 'leave'>> = {
    // Runs the container without -p: that alone resolves s5-drift (its documented fix would publish the
    // port), and 'open' stays undone because s5-port is left alone.
    open: { steps: { run: [{ cmd: 'docker run enroll:1.0', host: 'srv-new' }] }, leave: ['s5-drift', 's5-port'] },
    // The documented s5-drift fix would run the container (= the 'run' objective).
    run: { leave: ['s5-drift'] },
  };
  /** How the skipped objective is finished afterwards, where autoplay has no single step for it. */
  const FINISH: Record<string, Step[]> = {
    open: [
      { cmd: 'docker rm -f enroll', host: 'srv-new' },
      { cmd: 'docker run -p 80:8000 enroll:1.0', host: 'srv-new' },
    ],
  };
  /** Cases where everything else the gate waits for IS done, so only the skipped objective holds it. */
  const ONLY_HOLD = ['s1-cable/cable', 's2-dns/ping', 's3-port/start', 's3-thread/curl', 's4-monolith/watch', 's5-volume/open', 's6-crash/observe'];

  const cases = STAGES.flatMap((def) =>
    def.scenarios.flatMap((s) => (gates(s.trigger)?.objectives ?? []).map((obj) => ({ stage: def.id, id: s.id, obj }))),
  );
  it('covers every gate objective', () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
    for (const c of ONLY_HOLD) expect(cases.map((x) => `${x.id}/${x.obj}`)).toContain(c);
  });

  for (const { stage, id, obj } of cases) {
    it(`${id} stays quiet for 200 s while "${obj}" is left undone`, () => {
      const { run } = play(stage, { ...HOW[obj], skip: [obj], seconds: 200 });
      expect(run.objectivesDone).not.toHaveProperty(obj);
      const rt = rtOf(run, id);
      expect(rt.state).toBe('waiting');
      expect(rt.at).toBeNull();
      if (ONLY_HOLD.includes(`${id}/${obj}`)) {
        // Everything else the gate lists is done: the undone objective alone holds the incident.
        const g = gates(getStage(stage).scenarios.find((s) => s.id === id)!.trigger)!;
        for (const o of (g.objectives ?? []).filter((x) => x !== obj)) expect(run.objectivesDone, o).toHaveProperty(o);
        for (const sid of g.scenarios ?? []) expect(rtOf(run, sid).state, sid).toBe('resolved');
      }
      // Doing it at last starts the 10 s timer from that moment.
      const def = getStage(stage);
      const trigger = def.scenarios.find((s) => s.id === id)!.trigger;
      const t0 = run.ctx.stageTime;
      let r = run;
      for (const s of FINISH[obj] ?? AUTOPLAY[stage][obj]) r = apply(r, s, null);
      for (let i = 0; i < 60 && rtOf(r, id).state === 'waiting'; i++) r = tickRun(r).run;
      // Some objectives finish a few seconds after the command (DHCP leases take a moment).
      const doneAt = r.objectivesDone[obj];
      expect(doneAt).toBeGreaterThanOrEqual(t0);
      const fired = rtOf(r, id).activatedAt;
      if (fired === null) {
        // Only possible while something else in the gate is still undone (e.g. 'mount' done, 'power' not).
        expect(expectedFireTime(r, trigger)).toBeNull();
        return;
      }
      expect(fired).toBe(expectedFireTime(r, trigger));
      expect(fired).toBeGreaterThanOrEqual(doneAt + INCIDENT_GAP);
      if (ONLY_HOLD.includes(`${id}/${obj}`)) expect(fired).toBe(doneAt + INCIDENT_GAP);
    });
  }
});

describe('stage 3: the 200 OK step appears once the port is fixed', () => {
  it('curl is hidden until s3-port is resolved, and s3-thread waits for it', () => {
    const def = getStage(3);
    const visible = (run: StageRun) => visibleObjectives(def, run).map((o) => o.id);
    let run = startStage(3);
    run = apply(run, { cmd: 'server start', host: 'web' }, null);
    expect(run.objectivesDone).toHaveProperty('start');
    expect(visible(run)).toEqual(['start']);
    // Students (and the player's curl) are refused on port 80 while the app sits on 8080.
    run = apply(run, { cmd: 'curl http://web/enroll', host: 'ops' }, null);
    expect(run.ctx.events).toContain('curl:refused');
    for (let i = 0; i < INCIDENT_GAP; i++) run = tickRun(run).run;
    expect(rtOf(run, 's3-port').state).toBe('active');
    expect(rtOf(run, 's3-port').activatedAt).toBe(run.objectivesDone.start + INCIDENT_GAP);
    expect(visible(run)).toEqual(['start']);
    run = apply(run, { cmd: 'server set port 80', host: 'web' }, null);
    expect(visible(run)).toEqual(['start']);
    run = tickRun(run).run;
    expect(rtOf(run, 's3-port').state).toBe('resolved');
    expect(visible(run)).toEqual(['start', 'curl']);
    // The player takes their time: s3-thread waits for the 200 OK, then 10 s more.
    for (let i = 0; i < 30; i++) run = tickRun(run).run;
    expect(rtOf(run, 's3-thread').state).toBe('waiting');
    run = apply(run, { cmd: 'curl http://web/enroll', host: 'ops' }, null);
    expect(run.objectivesDone).toHaveProperty('curl');
    const curlAt = run.objectivesDone.curl;
    for (let i = 0; i < INCIDENT_GAP - 1; i++) run = tickRun(run).run;
    expect(rtOf(run, 's3-thread').state).toBe('waiting');
    run = tickRun(run).run;
    expect(rtOf(run, 's3-thread').state).toBe('active');
    expect(rtOf(run, 's3-thread').activatedAt).toBe(curlAt + INCIDENT_GAP);
  });
});

describe('stage 4: the notify crash comes with its alert', () => {
  it('after the split, notify stays up through the calm and goes down when s4-notify fires', () => {
    const def = getStage(4);
    let run = startStage(4);
    run = apply(run, AUTOPLAY[4].watch[0], null);
    while (rtOf(run, 's4-monolith').state !== 'active') run = tickRun(run).run;
    for (const s of def.scenarios.find((x) => x.id === 's4-monolith')!.solutionSteps) run = apply(run, s, null);
    while (rtOf(run, 's4-monolith').state !== 'resolved') run = tickRun(run).run;
    for (let i = 0; i < INCIDENT_GAP - 1; i++) {
      run = tickRun(run).run;
      expect(run.world.app!.services.notify.up, `t=${run.ctx.stageTime}`).toBe(true);
      expect(rtOf(run, 's4-notify').state).toBe('waiting');
    }
    run = tickRun(run).run;
    expect(rtOf(run, 's4-notify').state).toBe('active');
    expect(run.world.app!.services.notify.up).toBe(false);
  });
});
