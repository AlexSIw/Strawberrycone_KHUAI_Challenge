// Plays every stage from start to clear: completes objectives the way a player would,
// and when an incident fires, checks it is really broken and that its documented solution fixes it.
import { describe, expect, it } from 'vitest';
import { STAGES, getStage } from '../src/content/stages';
import { applyDesired, connectCable, mount, setFeeds, writeDockerfile } from '../src/sim/actions';
import { applyAction, applyCommand, isCleared, recordEvents, startStage, tickRun, visibleObjectives, type StageRun } from '../src/sim/engine';
import type { SolutionStep } from '../src/sim/scenario';
import type { StageId } from '../src/sim/types';

type Step = { cmd: string; host: string } | { action: Parameters<typeof applyAction>[1]; events?: string[] } | { events: string[] };

const RED = '\x1b[31m';

/** How a player completes each objective. */
const AUTOPLAY: Record<number, Record<string, Step[]>> = {
  0: {
    visit: [{ events: ['room:server', 'room:network', 'room:power', 'room:cooling', 'room:noc'] }],
    dashboard: [{ events: ['open:dashboard'] }],
    mentor: [{ events: ['open:mentor'] }],
    quiz: [{ events: ['quiz:correct'] }],
  },
  1: {
    mount: [{ action: (w) => ['web', 'db', 'spare'].forEach((id) => mount(w, id)) }],
    power: [{ action: (w) => ['web', 'db', 'spare'].forEach((id) => setFeeds(w, id, ['A'])) }],
    cable: [{ action: (w) => ['web', 'db', 'spare'].forEach((id, i) => connectCable(w, `${id}:eth0`, `sw1:p${i + 1}`)) }],
  },
  2: {
    terminal: [{ events: ['open:terminal'] }],
    dhcp: [{ cmd: 'dhcp on', host: 'ops' }],
    ping: [{ cmd: 'ping web', host: 'ops' }],
  },
  3: {
    start: [{ cmd: 'server start', host: 'web' }],
    curl: [{ cmd: 'curl http://web/enroll', host: 'ops' }],
  },
  4: { watch: [{ cmd: 'svc list', host: 'ops' }] },
  5: {
    log: [{ cmd: 'deploy log', host: 'srv-new' }],
    recipe: [{ action: (w) => writeDockerfile(w, 'enroll'), events: ['board:dockerfile'] }],
    image: [
      { cmd: 'docker build -t enroll:1.0 .', host: 'ops' },
      { cmd: 'docker push enroll:1.0', host: 'ops' },
    ],
    run: [{ cmd: 'docker run -p 80:8000 enroll:1.0', host: 'srv-new' }],
  },
  6: {
    desired: [{ action: (w) => applyDesired(w, 'enroll', 3, 'enroll:v1'), events: ['board:desired'] }],
    observe: [{ cmd: 'pods', host: 'ops' }],
  },
  7: { postmortem: [{ events: ['board:postmortem'] }] },
};

/** Objective steps may print expected errors (e.g. a refused curl); solution steps must not. */
function apply(run: StageRun, step: Step | SolutionStep, errors: string[] | null): StageRun {
  if ('cmd' in step) {
    const res = applyCommand(run, step.cmd, step.host);
    const bad = res.lines.filter((l) => l.startsWith(RED));
    if (bad.length && errors) errors.push(`${step.host}$ ${step.cmd} → ${bad.join(' | ')}`);
    return res.run;
  }
  if ('action' in step) return applyAction(run, step.action, 'events' in step ? step.events ?? [] : []).run;
  return recordEvents(run, step.events).run;
}

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
      it(`${s.id} lowers availability or breaks a check`, () => {
        // Play until just after the incident fires, without fixing it.
        let run = startStage(def.id);
        const errors: string[] = [];
        let fired = false;
        for (let t = 0; t < 300 && !fired; t++) {
          for (const o of visibleObjectives(def, run)) {
            if (o.id in run.objectivesDone) continue;
            for (const st of AUTOPLAY[def.id]?.[o.id] ?? []) run = apply(run, st, null);
          }
          const r = tickRun(run);
          run = r.run;
          if (run.scenarios.find((x) => x.id === s.id)?.state === 'active') fired = true;
          for (const rt of run.scenarios) {
            if (rt.state === 'active' && rt.id !== s.id) {
              for (const st of def.scenarios.find((x) => x.id === rt.id)!.solutionSteps) run = apply(run, st, errors);
            }
          }
        }
        expect(fired, `${s.id} never fired`).toBe(true);
        // Let the fault play out for a while.
        for (let i = 0; i < 20; i++) run = tickRun(run).run;
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
    for (let i = 0; i < 6; i++) run = tickRun(run).run;
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
