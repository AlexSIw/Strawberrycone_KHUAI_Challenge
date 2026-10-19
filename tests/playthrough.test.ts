// Plays every stage from start to clear: completes objectives the way a player would,
// and when an incident fires, checks it is really broken and that its documented solution fixes it.
import { describe, expect, it } from 'vitest';
import { STAGES, getStage } from '../src/content/stages';
import { writeDockerfile } from '../src/sim/actions';
import { isCleared, startStage, tickRun, visibleObjectives } from '../src/sim/engine';
import type { StageId } from '../src/sim/types';
import { apply, AUTOPLAY, type Step } from './autoplay';

function playStage(id: StageId) {
  const def = getStage(id);
  let run = startStage(id);
  const errors: string[] = [];
  const brokenOnActivation: Record<string, boolean> = {};
  const fixed = new Set<string>();
  for (let t = 0; t < 400 && !isCleared(run); t++) {
    for (const o of visibleObjectives(def, run)) {
      if (o.id in run.objectivesDone) continue;
      for (const s of AUTOPLAY[id]?.[o.id] ?? []) run = apply(run, s, null);
    }
    const r = tickRun(run);
    run = r.run;
    for (const sid of r.activated) {
      const sc = def.scenarios.find((s) => s.id === sid)!;
      brokenOnActivation[sid] = !sc.check(run.world, run.ctx, run.health);
    }
    // Solve each active incident a couple of seconds after it fires.
    for (const rt of run.scenarios) {
      if (rt.state !== 'active' || fixed.has(rt.id) || run.ctx.stageTime < (rt.activatedAt ?? 0) + 2) continue;
      const sc = def.scenarios.find((s) => s.id === rt.id)!;
      for (const s of sc.solutionSteps) run = apply(run, s, errors);
      fixed.add(rt.id);
    }
  }
  return { run, errors, brokenOnActivation };
}

describe('every stage can be played to the end', () => {
  for (const def of STAGES) {
    it(`stage ${def.id}: ${def.title}`, () => {
      const { run, errors, brokenOnActivation } = playStage(def.id);
      expect(errors, 'solution commands printed errors').toEqual([]);
      for (const s of def.scenarios) {
        const rt = run.scenarios.find((x) => x.id === s.id)!;
        if (s.optional && rt.state === 'waiting') continue;
        expect(rt.state, `${s.id} should be resolved`).toBe('resolved');
        expect(brokenOnActivation[s.id], `${s.id} should be broken when it fires`).toBe(true);
      }
      for (const o of def.objectives) expect(run.objectivesDone, `objective ${o.id}`).toHaveProperty(o.id);
      expect(isCleared(run)).toBe(true);
    });
  }
});

describe('incidents actually hurt the service', () => {
  for (const def of STAGES) {
    for (const s of def.scenarios.filter((x) => x.severity === 'critical')) {
      it(`${s.id} lowers availability and stays broken`, () => {
        // Play until just after the incident fires, without fixing it.
        let run = startStage(def.id);
        const errors: string[] = [];
        let fired = false;
        let preFire = 1;
        for (let t = 0; t < 300 && !fired; t++) {
          for (const o of visibleObjectives(def, run)) {
            if (o.id in run.objectivesDone) continue;
            for (const st of AUTOPLAY[def.id]?.[o.id] ?? []) run = apply(run, st, null);
          }
          const before = run.health.availability;
          const r = tickRun(run);
          run = r.run;
          if (run.scenarios.find((x) => x.id === s.id)?.state === 'active') {
            fired = true;
            preFire = before;
          }
          for (const rt of run.scenarios) {
            if (rt.state === 'active' && rt.id !== s.id) {
              for (const st of def.scenarios.find((x) => x.id === rt.id)!.solutionSteps) run = apply(run, st, errors);
            }
          }
        }
        expect(fired, `${s.id} never fired`).toBe(true);
        // Let the fault play out for a while.
        let minAv = run.health.availability;
        for (let i = 0; i < 20; i++) {
          run = tickRun(run).run;
          minAv = Math.min(minAv, run.health.availability);
        }
        // Students must feel it (unless the service was already down when the alert came).
        expect(minAv < preFire || preFire === 0, `${s.id} never lowered availability (${preFire} → ${minAv})`).toBe(true);
        const stillBroken = !s.check(run.world, run.ctx, run.health);
        expect(stillBroken, `${s.id} fixed itself without the player`).toBe(true);
      });
    }
  }
});

describe('optional port-mapping incident', () => {
  it('fires when the container runs without -p and the documented fix works', () => {
    let run = startStage(5);
    const errors: string[] = [];
    // The failed hand deploy (and its log) only exists once s5-drift has fired.
    for (let i = 0; i < 60 && run.scenarios.find((s) => s.id === 's5-drift')!.state !== 'active'; i++) run = tickRun(run).run;
    for (const s of [
      { cmd: 'deploy log', host: 'srv-new' },
      { action: (w: Parameters<typeof writeDockerfile>[0]) => writeDockerfile(w, 'enroll') },
      { cmd: 'docker build -t enroll:1.0 .', host: 'ops' },
      { cmd: 'docker push enroll:1.0', host: 'ops' },
      { cmd: 'docker run enroll:1.0', host: 'srv-new' },
    ] as Step[]) run = apply(run, s, null);
    for (let i = 0; i < 3; i++) run = tickRun(run).run;
    const port = run.scenarios.find((s) => s.id === 's5-port')!;
    expect(port.state).toBe('active');
    const def = getStage(5).scenarios.find((s) => s.id === 's5-port')!;
    for (const s of def.solutionSteps) run = apply(run, s, errors);
    for (let i = 0; i < 2; i++) run = tickRun(run).run;
    expect(run.scenarios.find((s) => s.id === 's5-port')!.state).toBe('resolved');
    expect(errors).toEqual([]);
  });
});
