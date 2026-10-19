// Regression tests for the Kubernetes sim and stages 6–7 (cluster k8s-stages6-7).
import { describe, expect, it } from 'vitest';
import { k8sHealth, k8sWorld } from '../src/content/k8sWorld';
import { getStage } from '../src/content/stages';
import { applyDesired, repairCrac, replaceCable } from '../src/sim/actions';
import { runCommand } from '../src/sim/commands';
import { applyAction, applyCommand, isCleared, recordEvents, startStage, tickRun, type StageRun } from '../src/sim/engine';
import { podsOf, readyPods, reconcile, setImage, unscheduled } from '../src/sim/k8s';
import type { SolutionStep } from '../src/sim/scenario';
import { step } from '../src/sim/step';
import type { World } from '../src/sim/types';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const RED = '\x1b[31m';

const state = (run: StageRun, id: string) => run.scenarios.find((s) => s.id === id)!.state;

function ticks(run: StageRun, n: number): StageRun {
  for (let i = 0; i < n; i++) run = tickRun(run).run;
  return run;
}

function cmd(run: StageRun, line: string, host = 'ops'): { run: StageRun; out: string; red: boolean } {
  const r = applyCommand(run, line, host);
  return { run: r.run, out: r.lines.map(strip).join('\n'), red: r.lines.some((l) => l.startsWith(RED)) };
}

function solve(run: StageRun, steps: SolutionStep[]): StageRun {
  for (const s of steps) run = 'cmd' in s ? applyCommand(run, s.cmd, s.host).run : applyAction(run, s.action).run;
  return run;
}

/** Stage 6 with the board applied (3 enroll pods) and `pods` run, as a player would. */
function stage6Start(): StageRun {
  let run = startStage(6);
  run = applyAction(run, (w) => applyDesired(w, 'enroll', 3, 'enroll:v1'), ['board:desired']).run;
  return cmd(run, 'pods').run;
}

/** Play stage 6 (solving earlier incidents with their documented steps) until `id` fires. */
function stage6Until(id: string): StageRun {
  const def = getStage(6);
  let run = stage6Start();
  for (let t = 0; t < 400; t++) {
    run = tickRun(run).run;
    if (state(run, id) === 'active') return run;
    for (const rt of run.scenarios) {
      if (rt.state === 'active') run = solve(run, def.scenarios.find((s) => s.id === rt.id)!.solutionSteps);
    }
  }
  throw new Error(`${id} never fired`);
}

const enroll = (run: StageRun) => run.world.k8s!.deployments.enroll;

describe('set image / rollout (C0, C13, C7)', () => {
  it('set image back to the running version mid-rollout retargets it and fixes s6-rollout', () => {
    let run = ticks(stage6Until('s6-rollout'), 3);
    expect(enroll(run).rolling?.target).toBe('enroll:v2');
    const r = cmd(run, 'set image enroll enroll:v1');
    expect(r.out).toContain('rolling update 시작');
    run = r.run;
    expect(enroll(run).rolling?.target).toBe('enroll:v1');
    for (let i = 0; i < 40 && state(run, 's6-rollout') !== 'resolved'; i++) run = tickRun(run).run;
    expect(state(run, 's6-rollout')).toBe('resolved');
    expect(podsOf(run.world.k8s!, 'enroll').every((p) => p.version === 'enroll:v1')).toBe(true);
  });

  it('set image to the version already being rolled out says nothing changed', () => {
    const run = stage6Until('s6-rollout');
    const history = [...enroll(run).history];
    const r = cmd(run, 'set image enroll enroll:v2');
    expect(r.out).toContain('바뀐 것 없음');
    expect(enroll(r.run).history).toEqual(history);
  });

  it('changing only the count on the desired board does not abort a rollout', () => {
    let run = stage6Until('s6-rollout');
    run = applyAction(run, (w) => applyDesired(w, 'enroll', 11), ['board:desired']).run;
    expect(enroll(run).replicas).toBe(11);
    expect(enroll(run).rolling?.target).toBe('enroll:v2');
  });

  it('accepts real kubectl forms', () => {
    let run = stage6Start();
    run = cmd(run, 'kubectl scale deployment enroll --replicas=10').run;
    expect(enroll(run).replicas).toBe(10);
    run = cmd(run, 'kubectl scale deploy enroll --replicas 7').run;
    expect(enroll(run).replicas).toBe(7);
    run = cmd(run, 'kubectl scale -n default deployment/enroll --replicas 5').run;
    expect(enroll(run).replicas).toBe(5);
    for (const line of ['kubectl get pod', 'kubectl get node', 'kubectl get deployment', 'kubectl get service', 'get no']) {
      expect(cmd(run, line).red, line).toBe(false);
    }
    const r = cmd(run, 'kubectl set image deployment/enroll enroll=enroll:v2');
    expect(r.red).toBe(false);
    expect(enroll(r.run).rolling?.target).toBe('enroll:v2');
    const undo = cmd(r.run, 'kubectl rollout undo deployment enroll');
    expect(undo.red).toBe(false);
    expect(enroll(undo.run).rolling?.target).toBe('enroll:v1');
  });

  it('set image rejects images that do not exist instead of "fixing" the deploy with them', () => {
    const run = stage6Until('s6-rollout');
    for (const bad of ['banana', 'enroll:v3', 'login:v1', 'enroll:latest']) {
      const r = cmd(run, `set image enroll ${bad}`);
      expect(r.red, bad).toBe(true);
      expect(enroll(r.run).rolling?.target, bad).toBe('enroll:v2');
    }
  });

  it('kubectl rollout undo deployment enroll resolves s6-rollout', () => {
    let run = cmd(stage6Until('s6-rollout'), 'kubectl rollout undo deployment enroll').run;
    for (let i = 0; i < 40 && state(run, 's6-rollout') !== 'resolved'; i++) run = tickRun(run).run;
    expect(state(run, 's6-rollout')).toBe('resolved');
  });
});

describe('rolling update waits for new pods (C31)', () => {
  function cluster(replicas: number): World {
    const w = k8sWorld({ enrollReplicas: replicas });
    w.traffic.rps = replicas * 1000;
    return w;
  }

  it('never drops below the desired number of ready pods and finishes on the new version', () => {
    let w = cluster(10);
    setImage(w.k8s!, 'enroll', 'enroll:v2');
    let finished = -1;
    for (let t = 0; t < 60; t++) {
      w = step(w);
      expect(readyPods(w.k8s!, 'enroll').length, `t=${t}`).toBeGreaterThanOrEqual(10);
      expect(podsOf(w.k8s!, 'enroll').length, `t=${t}`).toBeLessThanOrEqual(11);
      if (!w.k8s!.deployments.enroll.rolling) {
        finished = t;
        break;
      }
    }
    expect(finished).toBeGreaterThan(10); // one pod at a time, each waiting to be ready
    expect(podsOf(w.k8s!, 'enroll').every((p) => p.version === 'enroll:v2')).toBe(true);
    expect(w.k8s!.deployments.enroll.image).toBe('enroll:v2');
  });

  it('a bad version spreads gradually, so an early undo catches it with v1 still serving', () => {
    let run = ticks(stage6Until('s6-rollout'), 4);
    const v2 = podsOf(run.world.k8s!, 'enroll').filter((p) => p.version === 'enroll:v2').length;
    expect(v2).toBeLessThan(enroll(run).replicas / 2);
    run = cmd(run, 'rollout undo enroll').run;
    for (let i = 0; i < 30 && state(run, 's6-rollout') !== 'resolved'; i++) run = tickRun(run).run;
    expect(state(run, 's6-rollout')).toBe('resolved');
  });

  it('still finishes when no node has room for an extra pod', () => {
    let w = k8sWorld({ enrollReplicas: 19 }); // 24 slots: 19 + 5 others = full
    for (let i = 0; i < 4; i++) reconcile(w.k8s!);
    setImage(w.k8s!, 'enroll', 'enroll:v2');
    for (let t = 0; t < 120 && w.k8s!.deployments.enroll.rolling; t++) w = step(w);
    expect(w.k8s!.deployments.enroll.rolling).toBeNull();
    expect(podsOf(w.k8s!, 'enroll').every((p) => p.version === 'enroll:v2')).toBe(true);
  });
});

describe('unschedulable pods wait as Pending (C11, C35, C41, C16)', () => {
  function crowded(): World {
    let w = getStage(7).initialWorld();
    w.cables.c_n3.broken = true;
    w.cooling!.cracOk = false;
    w.k8s!.deployments.enroll.replicas = 12;
    for (let i = 0; i < 30; i++) w = step(w);
    return w;
  }

  it('shows pods that no node can take as Pending with NODE <none>, never Running', () => {
    const w = crowded();
    const k = w.k8s!;
    expect(['n1', 'n2', 'n3'].every((n) => !k.nodes[n].ready)).toBe(true);
    const waiting = k.pods.filter(unscheduled);
    expect(waiting.length).toBeGreaterThan(0);
    expect(waiting.every((p) => p.status === 'Pending' && p.ip === '')).toBe(true);
    expect(podsOf(k, 'enroll').length).toBe(12); // the pod objects exist
    const out = runCommand('pods', w, 'ops', 7).lines.map(strip).join('\n');
    expect(out).toMatch(/Pending\s+0\s+\S+\s+<none>/);
    expect(out).toContain('nodes are available');
    // `nodes` counts only pods that are really on the node.
    expect(runCommand('nodes', w, 'ops', 7).lines.map(strip).join('\n')).toMatch(/n4\s+Ready\s+rack4\s+\S+\s+6/);
  });

  it('places the waiting pods once nodes come back', () => {
    let w = crowded();
    replaceCable(w, 'c_n3');
    repairCrac(w);
    for (let i = 0; i < 30; i++) w = step(w);
    const k = w.k8s!;
    expect(k.pods.some(unscheduled)).toBe(false);
    expect(readyPods(k, 'enroll').length).toBe(12);
    expect(readyPods(k, 'notify').length).toBe(1);
  });

  it('scaling down removes waiting pods before running ones', () => {
    const w = crowded();
    const running = readyPods(w.k8s!, 'enroll').map((p) => p.name);
    w.k8s!.deployments.enroll.replicas = running.length;
    reconcile(w.k8s!);
    expect(podsOf(w.k8s!, 'enroll').map((p) => p.name)).toEqual(running);
  });
});

describe('s6-crash: self-healing is observed, not fixed (S0, C25, C29, C41)', () => {
  it('the pods list has an AGE column that makes the replacement stand out', () => {
    let run = stage6Until('s6-crash');
    const before = new Set(podsOf(run.world.k8s!, 'enroll').map((p) => p.name));
    run = ticks(run, 3);
    const lines = runCommand('pods', run.world, 'ops', 6).lines.map(strip);
    expect(lines[0]).toContain('AGE');
    const fresh = podsOf(run.world.k8s!, 'enroll').find((p) => !before.has(p.name))!;
    const row = (name: string) => lines.find((l) => l.startsWith(name))!;
    const age = (name: string) => Number(row(name).match(/\s(\d+)s\s/)?.[1]);
    const old = [...before][0];
    expect(age(fresh.name)).toBeLessThan(age(old));
  });

  for (const [how, act] of [
    ['deploys', (r: StageRun) => cmd(r, 'deploys').run],
    ['logs of an enroll pod', (r: StageRun) => cmd(r, 'logs enroll').run],
    ['kubectl get pod', (r: StageRun) => cmd(r, 'kubectl get pod').run],
    ['opening the dashboard', (r: StageRun) => recordEvents(r, ['open:dashboard']).run],
  ] as const) {
    it(`resolves when the player checks with ${how}`, () => {
      let run = ticks(stage6Until('s6-crash'), 4);
      run = act(run);
      run = ticks(run, 1);
      expect(state(run, 's6-crash')).toBe('resolved');
    });
  }

  it('closes by itself a little later even if nobody looked, so the stage never stalls', () => {
    let run = stage6Until('s6-crash');
    run = ticks(run, 10);
    expect(state(run, 's6-crash')).toBe('active');
    run = ticks(run, 20);
    expect(state(run, 's6-crash')).toBe('resolved');
  });

  it('hints only mention columns the pods output really has', () => {
    const sc = getStage(6).scenarios.find((s) => s.id === 's6-crash')!;
    expect(sc.hints.join(' ')).not.toContain('나이');
    expect(sc.hints.join(' ')).not.toContain('RESTARTS');
    expect(sc.alert).not.toContain('메모리');
  });
});

describe('s6-ip: COURSE_URL forms (C14, C8)', () => {
  for (const url of ['course-svc', 'course-svc:8000', 'http://course-svc', 'http://course-svc:8000/', 'course-svc.default.svc.cluster.local']) {
    it(`accepts COURSE_URL=${url}`, () => {
      let run = cmd(stage6Until('s6-ip'), `env set enroll COURSE_URL=${url}`).run;
      // The redeployed course pods need a few seconds to come up.
      run = ticks(run, 6);
      expect(state(run, 's6-ip')).toBe('resolved');
    });
  }

  it('a live course pod IP works for now but is flagged, and the incident stays open', () => {
    let run = ticks(stage6Until('s6-ip'), 3);
    const ip = readyPods(run.world.k8s!, 'course')[0].ip;
    run = ticks(cmd(run, `env set enroll COURSE_URL=${ip}`).run, 3);
    expect(state(run, 's6-ip')).toBe('active');
    const h = k8sHealth(run.world);
    expect(h.services.enroll).toBe('degraded');
    expect(h.notes.join(' ')).toContain('IP');
    const logs = cmd(run, 'logs enroll').out;
    expect(logs).toContain('WARN');
  });

  it('a wrong port or a Service of another app is not accepted, and logs say why', () => {
    let run = ticks(stage6Until('s6-ip'), 3);
    run = ticks(cmd(run, 'env set enroll COURSE_URL=course-svc:80').run, 2);
    expect(state(run, 's6-ip')).toBe('active');
    expect(cmd(run, 'logs enroll').out).toContain('refused');
    run = ticks(cmd(run, 'env set enroll COURSE_URL=login-svc').run, 2);
    expect(state(run, 's6-ip')).toBe('active');
    const logs = cmd(run, 'logs enroll').out;
    expect(logs).toContain('404');
    expect(logs).not.toContain('POST /enroll 201');
    expect(k8sHealth(run.world).services.enroll).toBe('down');
  });

  it('the Service name itself is a banned phrase for the AI mentor', () => {
    const sc = getStage(6).scenarios.find((s) => s.id === 's6-ip')!;
    expect(sc.bannedPhrases).toContain('course-svc');
  });
});

describe('stage 7 cooling vs cable (C12, C21)', () => {
  it('repairing the CRAC resolves the cooling incident even while n3 is still down for its cable', () => {
    let run = startStage(7);
    run = ticks(run, 8);
    run = cmd(run, 'scale enroll 12').run;
    while (state(run, 's7-cooling') !== 'active') run = tickRun(run).run;
    run = applyAction(run, repairCrac).run;
    run = ticks(run, 3);
    expect(state(run, 's7-cable')).toBe('active');
    expect(state(run, 's7-cooling')).toBe('resolved');
  });

  it('the cooling incident does not resolve from the cable fix alone', () => {
    let run = startStage(7);
    while (state(run, 's7-cooling') !== 'active') run = tickRun(run).run;
    run = applyAction(run, (w) => replaceCable(w, 'c_n3')).run;
    run = ticks(run, 20);
    expect(state(run, 's7-cooling')).toBe('active');
  });
});

describe('stage 7 survive and postmortem (C16)', () => {
  function playStage7(opts: { idleUntil: number }): StageRun {
    const def = getStage(7);
    let run = startStage(7);
    for (let t = 0; t < 400 && run.ctx.stageTime < 170; t++) {
      run = tickRun(run).run;
      if (run.ctx.stageTime < opts.idleUntil) continue;
      for (const rt of run.scenarios) {
        if (rt.state === 'active') run = solve(run, def.scenarios.find((s) => s.id === rt.id)!.solutionSteps);
      }
    }
    return run;
  }

  it('a report filed before the rush is over does not count', () => {
    let run = recordEvents(startStage(7), ['board:postmortem']).run;
    const def = getStage(7);
    for (let t = 0; t < 170; t++) {
      run = tickRun(run).run;
      for (const rt of run.scenarios) {
        if (rt.state === 'active') run = solve(run, def.scenarios.find((s) => s.id === rt.id)!.solutionSteps);
      }
    }
    expect(run.objectivesDone).toHaveProperty('survive');
    expect(run.objectivesDone).not.toHaveProperty('postmortem');
    expect(isCleared(run)).toBe(false);
    run = recordEvents(run, ['board:postmortem']).run;
    expect(isCleared(run)).toBe(true);
  });

  it('a quick player never sees the collapse alarm', () => {
    const run = playStage7({ idleUntil: 0 });
    expect(state(run, 's7-outage')).toBe('waiting');
  });

  it('letting incidents pile up raises the student-complaint alarm, which clears once things are fixed', () => {
    let run = startStage(7);
    run = ticks(run, 80);
    expect(state(run, 's7-outage')).toBe('active');
    expect(run.world.flags.outage).toBe('active');
    run = cmd(run, 'scale enroll 12').run;
    run = applyAction(run, (w) => replaceCable(w, 'c_n3')).run;
    run = applyAction(run, repairCrac).run;
    run = ticks(run, 30);
    expect(state(run, 's7-outage')).toBe('resolved');
    run = ticks(run, 50);
    expect(run.objectivesDone).toHaveProperty('survive');
    run = recordEvents(run, ['board:postmortem']).run;
    expect(isCleared(run)).toBe(true);
  });

  it('survive waits while the collapse alarm is still open', () => {
    let run = startStage(7);
    run = ticks(run, 80);
    expect(state(run, 's7-outage')).toBe('active');
    // Fix the three root causes but leave enroll short of pods: the service stays down.
    run = applyAction(run, (w) => replaceCable(w, 'c_n3')).run;
    run = applyAction(run, repairCrac).run;
    run = ticks(run, 80);
    expect(run.ctx.stageTime).toBeGreaterThan(150);
    expect(run.objectivesDone).not.toHaveProperty('survive');
  });

  it('the boss no longer claims the server never went down', () => {
    expect(getStage(7).outro.map((l) => l.text).join(' ')).not.toContain('한 번도 완전히 죽지 않았어');
  });
});

describe('content wording (C36, C23)', () => {
  it('rescheduling is described as new pods, not moved pods, and Kakao is not tied to it', () => {
    const sc = getStage(6).scenarios.find((s) => s.id === 's6-crac')!;
    expect([sc.lesson, ...sc.hints].join(' ')).not.toMatch(/옮겨/);
    expect(sc.lesson).toContain('새 pod');
    expect(sc.lesson).not.toContain('이런 대비가 중요했죠');
  });

  it('stage 7 traffic hint about Pending matches what the sim shows', () => {
    const sc = getStage(7).scenarios.find((s) => s.id === 's7-traffic')!;
    expect(sc.hints[2]).toContain('Pending');
  });
});

describe('own-property safety (C1)', () => {
  it('player-typed names like constructor are just unknown apps', () => {
    const run = stage6Start();
    for (const line of ['scale constructor 3', 'rollout undo __proto__', 'set image constructor constructor:v1', 'env constructor', 'env set toString A=B']) {
      const r = cmd(run, line);
      expect(r.red, line).toBe(true);
      expect(r.out, line).not.toContain('처리하지 못했어요');
    }
  });
});

describe('verifier follow-ups', () => {
  it('a rollout in an over-full cluster does not wait forever on a new pod that has no node', () => {
    let w = k8sWorld({ enrollReplicas: 10 });
    w.k8s!.deployments.login.replicas = 12; // 12 + 2 + 10 + 1 = 25 pods wanted, 24 slots
    for (let i = 0; i < 5; i++) w = step(w);
    setImage(w.k8s!, 'enroll', 'enroll:v2');
    for (let i = 0; i < 4; i++) w = step(w);
    w.k8s!.deployments.enroll.replicas = 14; // the extra new-version pods can't be placed
    for (let i = 0; i < 120 && w.k8s!.deployments.enroll.rolling; i++) w = step(w);
    expect(w.k8s!.deployments.enroll.rolling).toBeNull();
    expect(podsOf(w.k8s!, 'enroll').every((p) => p.version === 'enroll:v2')).toBe(true);
  });

  it('s6-rollout still resolves by undo when the player has over-scaled the cluster', () => {
    let run = stage6Until('s6-rollout');
    run = ticks(cmd(run, 'scale login 16').run, 3);
    run = ticks(cmd(run, 'scale enroll 16').run, 3);
    run = cmd(run, 'rollout undo enroll').run;
    for (let i = 0; i < 120 && state(run, 's6-rollout') !== 'resolved'; i++) run = tickRun(run).run;
    expect(state(run, 's6-rollout')).toBe('resolved');
  });

  it('nodes keeps the PODS column aligned when a rack is hot (colour codes are not padding)', () => {
    const w = k8sWorld({ enrollReplicas: 3 });
    w.cooling!.temps.rack1 = 50;
    w.cooling!.temps.rack2 = 33;
    const lines = runCommand('nodes', w, 'ops', 6).lines.map(strip);
    const col = lines[0].indexOf('PODS');
    for (const l of lines.slice(1)) expect(l.slice(col).trim(), l).toMatch(/^\d+$/);
  });

  it('a malformed address is not taken for the Service', () => {
    let run = ticks(stage6Until('s6-ip'), 3);
    run = ticks(cmd(run, 'env set enroll COURSE_URL=course-svc:8000:8000').run, 4);
    expect(state(run, 's6-ip')).toBe('active');
    expect(cmd(run, 'logs enroll').out).toContain('ENOTFOUND');
  });

  it('set image / rollout undo messages read naturally and say when nothing changes', () => {
    const run = stage6Until('s6-rollout');
    expect(cmd(run, 'set image enroll enroll:v2').out).toContain('이미 enroll:v2 버전으로 바꾸는 중');
    expect(cmd(stage6Start(), 'set image enroll enroll:v1').out).toContain('이미 enroll:v1 버전이에요');
    expect(cmd(run, 'rollout undo enroll').out).toContain('enroll:v1 버전으로 되돌리는 중');
  });

  it('the n3 alert shows the symptom, not the cable', () => {
    const sc = getStage(7).scenarios.find((s) => s.id === 's7-cable')!;
    expect(sc.alert).not.toContain('케이블');
    expect(sc.alert).toContain('NotReady');
  });

  it('the collapse alarm bans every answer wording the incidents under it ban, and no hint trips a ban', () => {
    const scs = getStage(7).scenarios;
    const outage = scs.find((s) => s.id === 's7-outage')!;
    for (const id of ['s7-traffic', 's7-cable', 's7-cooling']) {
      for (const b of scs.find((s) => s.id === id)!.bannedPhrases) expect(outage.bannedPhrases, `${id}: ${b}`).toContain(b);
    }
    for (const sc of [...getStage(6).scenarios, ...scs]) {
      for (const h of sc.hints) for (const b of sc.bannedPhrases) expect(h.toLowerCase().includes(b.toLowerCase()), `${sc.id} hint has "${b}"`).toBe(false);
    }
  });
});
