// D-1 (점검 · 이중화): the Kubernetes sim on the real network (nodes go NotReady when hot or cut off,
// pods are recreated elsewhere, drain/uncordon), CORE-02 as HSRP standby, and the two teaching incidents:
// the CRAC stops (drain + facilities) and the network-rack fire (HSRP fails over; a trunk missing the K8S
// VLAN cuts K8S-03/04 off). Ported from tests/v1/k8s.test.ts where it still applies.
import { describe, expect, it } from 'vitest';
import { k8sHealth, k8sLayer } from '../src/content/k8sWorld';
import { getStage } from '../src/content/stages';
import { applyDesired, repairCrac } from '../src/sim/actions';
import { runCommand } from '../src/sim/commands';
import { applyAction, applyCommand, recordEvents, scenarioOf, startStage, tickRun, type StageRun } from '../src/sim/engine';
import { podsOf, readyPods, reconcile, setImage, unscheduled } from '../src/sim/k8s';
import { hostDelivery, hsrpActiveFor, lbView, reach, studentDelivery } from '../src/sim/network';
import { initRuntime } from '../src/sim/scenario';
import { step } from '../src/sim/step';
import type { IosMode, World } from '../src/sim/types';
import { apply, AUTOPLAY, RED } from './autoplay';

const D1 = 4;
// eslint-disable-next-line no-control-regex
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

const enroll = (run: StageRun) => run.world.k8s!.deployments.enroll;

function ticks(run: StageRun, n: number): StageRun {
  for (let i = 0; i < n; i++) run = tickRun(run).run;
  return run;
}

function cmd(run: StageRun, line: string, host = 'ops'): { run: StageRun; out: string; red: boolean } {
  const r = applyCommand(run, line, host);
  return { run: r.run, out: r.lines.map(strip).join('\n'), red: r.lines.some((l) => l.startsWith(RED)) };
}

function ios(run: StageRun, host: string, lines: string[]) {
  let mode: IosMode | null = { level: 'user' };
  const out: string[] = [];
  for (const line of lines) {
    const r = applyCommand(run, line, host, mode);
    run = r.run;
    mode = r.mode;
    out.push(...r.lines);
  }
  return { run, out: out.map(strip).join('\n') };
}

/** Do these missions the AUTOPLAY way. */
function missions(...ids: string[]): StageRun {
  let run = startStage(D1);
  for (const id of ids) {
    for (const st of AUTOPLAY[D1][id]) run = apply(run, st, null);
    // Pods take a couple of seconds to come up before `observe` can finish.
    for (let i = 0; i < 10 && !(id in run.objectivesDone); i++) {
      run = tickRun(run).run;
      for (const st of AUTOPLAY[D1][id]) run = apply(run, st, null);
    }
    expect(run.objectivesDone, id).toHaveProperty(id);
  }
  return run;
}

/** Run only this incident from now on: it fires on the next tick. */
function only(run: StageRun, id: string): StageRun {
  run = { ...run, scenarios: initRuntime([{ id, trigger: { type: 'stageStart', delay: run.ctx.stageTime + 1, overlap: true } }]) };
  for (let i = 0; i < 5 && run.scenarios[0].state === 'waiting'; i++) run = tickRun(run).run;
  expect(run.scenarios[0].state, id).toBe('active');
  return run;
}

function solve(run: StageRun, id: string): StageRun {
  const errors: string[] = [];
  for (const st of scenarioOf(getStage(D1), id).solutionSteps) run = apply(run, st, errors);
  expect(errors).toEqual([]);
  return run;
}

const until = (run: StageRun, done: (r: StageRun) => boolean, max = 60) => {
  for (let i = 0; i < max && !done(run); i++) run = tickRun(run).run;
  return run;
};

/** The morning: cluster up, CORE-02 standing by. */
const morning = () => missions('desired', 'observe', 'hsrp');

describe('D-1 starting world', () => {
  it('has the cluster with no enroll pods, so students get nothing until the desired state is written', () => {
    const run = startStage(D1);
    const k = run.world.k8s!;
    expect(k.deployments.enroll.replicas).toBe(0);
    expect(Object.values(k.nodes).every((n) => n.ready)).toBe(true);
    expect(lbView(run.world).members.map((m) => `${m.host}:${m.port}`)).toEqual(['n1:30080', 'n2:30080', 'n3:30080', 'n4:30080']);
    expect(studentDelivery(run.world).ok).toBe(0);
    expect(run.world.traffic.rps).toBe(1500);
  });

  it('CORE-02 has no VLAN 10/40 gateway yet (its other SVIs are there), and TOR-02’s uplink to CORE-02 lacks VLAN 40', () => {
    const w = startStage(D1).world;
    expect(Object.keys(w.devices['CORE-02'].nd!.svis).map(Number)).toEqual([20, 30, 50, 100]);
    expect(w.devices['TOR-02'].nd!.ifs['Te1/1/3'].allowed).toEqual([50, 100]);
    expect(w.devices['TOR-02'].nd!.dirty).toBe(false);
    // The earlier days have no cluster at all.
    for (const d of [0, 1, 2, 3] as const) expect(startStage(d).world.k8s, `day ${d}`).toBeUndefined();
  });

  it('the desired state brings pods up and the NodePort pool healthy', () => {
    const run = missions('desired', 'observe');
    expect(readyPods(run.world.k8s!, 'enroll').length).toBe(3);
    expect(lbView(run.world).members.every((m) => m.healthy)).toBe(true);
    expect(studentDelivery(run.world).ok).toBeGreaterThan(0.99);
    expect(run.health.availability).toBeGreaterThan(0.99);
  });
});

describe('HSRP mission: CORE-02 joins as standby', () => {
  it('done with .3, standby 1 ip .1, priority 100, preempt, saved; CORE-01 stays Active', () => {
    const run = morning();
    expect(hsrpActiveFor(run.world, 10)).toBe('CORE-01');
    expect(hsrpActiveFor(run.world, 40)).toBe('CORE-01');
    const out = ios(run, 'CORE-02', ['enable', 'show standby brief']).out;
    expect(out).toMatch(/Vl10\s+1\s+100 P Standby\s+10\.10\.10\.2\s+local\s+10\.10\.10\.1/);
    expect(ios(run, 'CORE-01', ['enable', 'show standby brief']).out).toMatch(/Vl40\s+1\s+110 P Active\s+local\s+10\.10\.40\.3/);
  });

  it('a priority above CORE-01’s, or no preempt, does not count', () => {
    let run = missions('desired', 'observe');
    const base = ['enable', 'configure terminal', 'interface vlan 10', 'ip address 10.10.10.3 255.255.255.0', 'standby 1 ip 10.10.10.1'];
    run = ios(run, 'CORE-02', [...base, 'standby 1 priority 120', 'standby 1 preempt', 'interface vlan 40', 'ip address 10.10.40.3 255.255.255.0', 'standby 1 ip 10.10.40.1', 'end', 'write memory']).run;
    expect(run.objectivesDone).not.toHaveProperty('hsrp');
    // 120 with preempt takes Active away from CORE-01: not what a standby is for.
    run = ticks(run, 1);
    expect(hsrpActiveFor(run.world, 10)).toBe('CORE-02');
    run = ios(run, 'CORE-02', ['enable', 'configure terminal', 'interface vlan 10', 'standby 1 priority 100', 'interface vlan 40', 'standby 1 priority 100', 'end', 'write memory']).run;
    expect(run.objectivesDone, 'vlan 40 has no preempt yet').not.toHaveProperty('hsrp');
    run = ios(run, 'CORE-02', ['enable', 'configure terminal', 'interface vlan 40', 'standby 1 preempt', 'end', 'write memory']).run;
    expect(run.objectivesDone).toHaveProperty('hsrp');
  });
});

describe('d1-heat: the CRAC stops', () => {
  const atIncident = () => only(morning(), 'd1-heat:0');

  it('nodes in the hot rack go NotReady, their pods are recreated elsewhere, and the incident stays open', () => {
    let run = atIncident();
    run = ticks(run, 25);
    const k = run.world.k8s!;
    expect(k.nodes.n1.ready).toBe(false);
    expect(k.nodes.n2.ready).toBe(false);
    expect(k.pods.every((p) => p.node === 'n3' || p.node === 'n4')).toBe(true);
    expect(readyPods(k, 'enroll').length).toBe(3);
    run = ticks(run, 60);
    expect(run.scenarios[0].state).toBe('active');
    expect(cmd(run, 'nodes').out).toMatch(/n1\s+NotReady/);
  });

  it('draining the hot nodes resolves it, facilities then fix the CRAC, and the nodes come back', () => {
    let run = atIncident();
    run = ticks(solve(run, 'd1-heat:0'), 4);
    expect(run.scenarios[0].state).toBe('resolved');
    expect(run.world.cooling!.cracOk).toBe(true);
    const k = run.world.k8s!;
    expect(k.pods.some((p) => p.node === 'n1' || p.node === 'n2')).toBe(false);
    run = until(run, (r) => r.world.k8s!.nodes.n1.ready && r.world.k8s!.nodes.n2.ready);
    expect(cmd(run, 'nodes').out).toMatch(/n1\s+Ready,SchedulingDisabled/);
    // The uncordon mission opens them again.
    for (const st of AUTOPLAY[D1].uncordon) run = apply(run, st, null);
    expect(run.objectivesDone).toHaveProperty('uncordon');
  });

  it('draining one node is not enough', () => {
    let run = atIncident();
    run = ticks(cmd(run, 'kubectl drain n1').run, 30);
    expect(run.scenarios[0].state).toBe('active');
  });

  it('drain prints the evictions and kubectl cordon / uncordon forms work', () => {
    const run = morning();
    const r = cmd(run, 'kubectl drain node/n3');
    expect(r.red).toBe(false);
    expect(r.out).toContain('node/n3 drained');
    expect(r.out).toContain('evicted');
    expect(cmd(r.run, 'uncordon n3').out).toContain('uncordoned');
    expect(cmd(run, 'cordon n9').red).toBe(true);
  });
});

describe('d1-fire: network rack 1 loses power', () => {
  /** After the heat incident and its uncordon, at the checklist. */
  const atIncident = () => only(missions('desired', 'observe', 'hsrp'), 'd1-fire:0');

  it('CORE-02 takes every gateway (the standby built this morning) but K8S-03/04 drop off', () => {
    let run = atIncident();
    run = ticks(run, 4);
    const w = run.world;
    expect(hsrpActiveFor(w, 10)).toBe('CORE-02');
    expect(hsrpActiveFor(w, 40)).toBe('CORE-02');
    expect(w.devices['CORE-02'].nd!.log.some((e) => e.msg === 'Vlan40 Grp 1 state Standby -> Active')).toBe(true);
    expect(lbView(w).active).toBe('L4-02');
    expect(reach(w, 'ops', '10.10.40.13').ok).toBe(false);
    expect(hostDelivery(w, 'ops', 'n4').ok).toBe(0);
    expect(w.k8s!.nodes.n3.ready).toBe(false);
    // Pods find room on K8S-01/02 behind TOR-01, whose uplink to CORE-02 carries VLAN 40.
    const ready = readyPods(w.k8s!, 'enroll');
    expect(ready).toHaveLength(3);
    expect(ready.every((p) => p.node === 'n1' || p.node === 'n2')).toBe(true);
    expect(reach(w, 'ops', '10.10.40.11').ok).toBe(true);
    // TOR-02's trunk to CORE-02 shows what's missing.
    const trunk = ios(run, 'TOR-02', ['enable', 'show interfaces trunk']).out;
    expect(trunk).toMatch(/Te1\/1\/3\s+50,100/);
    expect(run.scenarios[0].state).toBe('active');
  });

  it('adding the K8S VLAN to that trunk resolves it; facilities restore the rack a little later and CORE-01 takes Active back', () => {
    let run = atIncident();
    run = ticks(solve(run, 'd1-fire:0'), 6);
    expect(run.scenarios[0].state).toBe('resolved');
    // Right after the fix the rack is still dark: checking the fix shows the backup trunk at work.
    expect(run.world.power!.racksDown).toEqual(['net1']);
    const trunk = ios(run, 'TOR-02', ['enable', 'show interfaces trunk']).out;
    expect(trunk).not.toMatch(/Te1\/1\/1\s/);
    expect(trunk).toMatch(/forwarding state[^]*Te1\/1\/3\s+40,50,100/);
    run = ticks(run, 30);
    expect(run.world.power!.racksDown).toEqual([]);
    run = ticks(run, 2);
    expect(hsrpActiveFor(run.world, 40)).toBe('CORE-01');
    expect(run.world.k8s!.nodes.n3.ready).toBe(true);
    expect(reach(run.world, 'ops', '10.10.40.13').ok).toBe(true);
  });

  it('fixing the trunk before the fire leaves nothing to break (the careful player is rewarded)', () => {
    let run = missions('desired', 'observe', 'hsrp');
    run = ios(run, 'TOR-02', ['enable', 'configure terminal', 'interface te1/1/3', 'switchport trunk allowed vlan add 40', 'end']).run;
    run = only(run, 'd1-fire:0');
    run = ticks(run, 3);
    expect(run.scenarios[0].state).toBe('resolved');
  });
});

describe('set image / rollout (d1-rollout)', () => {
  const atRollout = () => only(missions('desired', 'observe'), 'd1-rollout:0');

  it('set image back to the running version mid-rollout retargets it and fixes it', () => {
    let run = ticks(atRollout(), 3);
    expect(enroll(run).rolling?.target).toBe('enroll:v2');
    const r = cmd(run, 'set image enroll enroll:v1');
    expect(r.out).toContain('rolling update 시작');
    run = until(r.run, (x) => x.scenarios[0].state === 'resolved', 40);
    expect(run.scenarios[0].state).toBe('resolved');
    expect(podsOf(run.world.k8s!, 'enroll').every((p) => p.version === 'enroll:v1')).toBe(true);
  });

  it('kubectl rollout undo deployment enroll resolves it; bad versions show in health and logs', () => {
    let run = ticks(atRollout(), 6);
    expect(k8sHealth(run.world).notes.join(' ')).toContain('500');
    expect(cmd(run, 'logs enroll').out + cmd(run, 'pods').out).toContain('enroll:v2');
    run = until(cmd(run, 'kubectl rollout undo deployment enroll').run, (x) => x.scenarios[0].state === 'resolved', 40);
    expect(run.scenarios[0].state).toBe('resolved');
  });

  it('set image rejects images that do not exist instead of "fixing" the deploy with them', () => {
    const run = atRollout();
    for (const bad of ['banana', 'enroll:v3', 'login:v1', 'enroll:latest']) {
      const r = cmd(run, `set image enroll ${bad}`);
      expect(r.red, bad).toBe(true);
      expect(enroll(r.run).rolling?.target, bad).toBe('enroll:v2');
    }
  });

  it('accepts real kubectl forms', () => {
    let run = missions('desired', 'observe');
    run = cmd(run, 'kubectl scale deployment enroll --replicas=10').run;
    expect(enroll(run).replicas).toBe(10);
    run = cmd(run, 'kubectl scale -n default deployment/enroll --replicas 5').run;
    expect(enroll(run).replicas).toBe(5);
    for (const line of ['kubectl get pod', 'kubectl get node', 'kubectl get deployment', 'kubectl get service', 'get no']) expect(cmd(run, line).red, line).toBe(false);
  });
});

describe('rolling update waits for new pods', () => {
  function cluster(replicas: number): World {
    const w = startStage(D1).world;
    w.k8s = k8sLayer({ n1: 'rack2', n2: 'rack2', n3: 'rack3', n4: 'rack3' }, { enrollReplicas: replicas });
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
      if (!w.k8s!.deployments.enroll.rolling) {
        finished = t;
        break;
      }
    }
    expect(finished).toBeGreaterThan(10);
    expect(podsOf(w.k8s!, 'enroll').every((p) => p.version === 'enroll:v2')).toBe(true);
  });

  it('still finishes when no node has room for an extra pod', () => {
    const w0 = cluster(19); // 24 slots: 19 + 5 others = full
    for (let i = 0; i < 4; i++) reconcile(w0.k8s!);
    setImage(w0.k8s!, 'enroll', 'enroll:v2');
    let w = w0;
    for (let t = 0; t < 120 && w.k8s!.deployments.enroll.rolling; t++) w = step(w);
    expect(w.k8s!.deployments.enroll.rolling).toBeNull();
  });
});

describe('unschedulable pods wait as Pending', () => {
  /** K8S-03 cut off (its cable) and the CRAC down: only K8S-04 is left. */
  function crowded(): World {
    let w = startStage(D1).world;
    w.cables.c_n3.broken = true;
    w.cooling!.cracOk = false;
    w.k8s!.deployments.enroll.replicas = 12;
    for (let i = 0; i < 30; i++) w = step(w);
    return w;
  }

  it('shows pods that no node can take as Pending with NODE <none>', () => {
    const w = crowded();
    const k = w.k8s!;
    expect(['n1', 'n2', 'n3'].every((n) => !k.nodes[n].ready)).toBe(true);
    const waiting = k.pods.filter(unscheduled);
    expect(waiting.length).toBeGreaterThan(0);
    expect(waiting.every((p) => p.status === 'Pending' && p.ip === '')).toBe(true);
    const out = runCommand('pods', w, 'ops', D1).lines.map(strip).join('\n');
    expect(out).toMatch(/Pending\s+0\s+\S+\s+<none>/);
    expect(out).toContain('nodes are available');
  });

  it('places the waiting pods once nodes come back', () => {
    let w = crowded();
    w.cables.c_n3.broken = false;
    repairCrac(w);
    for (let i = 0; i < 30; i++) w = step(w);
    expect(w.k8s!.pods.some(unscheduled)).toBe(false);
    expect(readyPods(w.k8s!, 'enroll').length).toBe(12);
  });
});

describe('d1-ip: COURSE_URL forms', () => {
  const atIp = () => ticks(only(missions('desired', 'observe'), 'd1-ip:0'), 3);

  for (const url of ['course-svc', 'course-svc:8000', 'http://course-svc', 'http://course-svc:8000/', 'course-svc.default.svc.cluster.local']) {
    it(`accepts COURSE_URL=${url}`, () => {
      const run = ticks(cmd(atIp(), `env set enroll COURSE_URL=${url}`).run, 6);
      expect(run.scenarios[0].state).toBe('resolved');
    });
  }

  it('a live course pod IP works for now but is flagged, and the incident stays open', () => {
    let run = atIp();
    const ip = readyPods(run.world.k8s!, 'course')[0].ip;
    run = ticks(cmd(run, `env set enroll COURSE_URL=${ip}`).run, 3);
    expect(run.scenarios[0].state).toBe('active');
    expect(k8sHealth(run.world).services.enroll).toBe('degraded');
    expect(cmd(run, 'logs enroll').out).toContain('WARN');
  });

  it('a wrong port or a Service of another app is not accepted, and logs say why', () => {
    let run = atIp();
    run = ticks(cmd(run, 'env set enroll COURSE_URL=course-svc:80').run, 2);
    expect(run.scenarios[0].state).toBe('active');
    expect(cmd(run, 'logs enroll').out).toContain('refused');
    run = ticks(cmd(run, 'env set enroll COURSE_URL=login-svc').run, 2);
    expect(run.scenarios[0].state).toBe('active');
    expect(cmd(run, 'logs enroll').out).toContain('404');
  });
});

describe('own-property safety', () => {
  it('player-typed names like constructor are just unknown apps or nodes', () => {
    const run = missions('desired');
    for (const line of ['scale constructor 3', 'rollout undo __proto__', 'set image constructor constructor:v1', 'env constructor', 'env set toString A=B', 'drain constructor', 'uncordon __proto__']) {
      const r = cmd(run, line);
      expect(r.red, line).toBe(true);
      expect(r.out, line).not.toContain('처리하지 못했어요');
    }
  });
});

describe('the desired-state board', () => {
  it('only a count of 2 or more finishes the mission', () => {
    let run = startStage(D1);
    run = applyAction(run, (w) => applyDesired(w, 'enroll', 1, 'enroll:v1')).run;
    expect(run.objectivesDone).not.toHaveProperty('desired');
    run = applyAction(run, (w) => applyDesired(w, 'enroll', 2)).run;
    expect(run.objectivesDone).toHaveProperty('desired');
  });
});

describe('missions count what the player does once they are shown', () => {
  const objective = (id: string) => getStage(D1).objectives.find((o) => o.id === id)!;

  it('a `pods` look at the empty list before the desired state does not finish observe', () => {
    let run = cmd(startStage(D1), 'pods').run;
    run = applyAction(run, (w) => applyDesired(w, 'enroll', 3, 'enroll:v1')).run;
    run = ticks(run, 10);
    expect(readyPods(run.world.k8s!, 'enroll')).toHaveLength(3);
    expect(run.objectivesDone).toHaveProperty('desired');
    expect(run.objectivesDone).not.toHaveProperty('observe');
    run = cmd(run, 'pods').run;
    expect(run.objectivesDone).toHaveProperty('observe');
  });

  it('the checklist opens at 0/3: looks during the HSRP mission or the heat incident do not count', () => {
    let run = morning();
    run = ios(run, 'CORE-02', ['enable', 'show standby brief']).run;
    run = ios(run, 'TOR-01', ['enable', 'show etherchannel summary']).run;
    run = recordEvents(run, ['noc:fms']).run;
    run = ticks(solve(only(run, 'd1-heat:0'), 'd1-heat:0'), 4);
    run = until(run, (r) => r.world.k8s!.nodes.n1.ready && r.world.k8s!.nodes.n2.ready);
    for (const st of AUTOPLAY[D1].uncordon) run = apply(run, st, null);
    expect(run.objectivesDone).toHaveProperty('uncordon');
    run = ticks(run, 2);
    expect(run.objectivesDone).not.toHaveProperty('checklist');
    expect(objective('checklist').progress!(run.world, run.ctx)).toBe('0/3');
    for (const st of AUTOPLAY[D1].checklist) run = apply(run, st, null);
    expect(run.objectivesDone).toHaveProperty('checklist');
  });
});
