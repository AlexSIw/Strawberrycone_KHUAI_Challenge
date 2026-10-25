// D-5 … D-3 (WP5): the starting worlds don't have what later days build yet, every cable an incident's
// solution replaces is one the cable window (CableGame) can reach that day, and missions only count
// what they ask for.
import { describe, expect, it } from 'vitest';
import { bannedFor, leaks } from '../src/ai/leak';
import { dayWorld, getStage } from '../src/content/days';
import { instance, instanceIds, TEMPLATES, validOn } from '../src/content/incidents';
import { cableGameCables } from '../src/game/worldView';
import { applyCommand, scenarioOf, startStage, tickRun, visibleObjectives, type StageRun } from '../src/sim/engine';
import { clone } from '../src/sim/step';
import { LAST_DAY, type StageId, type World } from '../src/sim/types';
import { AUTOPLAY, apply } from './autoplay';

describe('D-5 … D-3 start without what later days build', () => {
  it.each([0, 1, 2] as StageId[])('day %i: no LACP bundle (D-2), no CORE-02 standby for VLAN 10/20 (D-1), no k8s (D-1)', (d) => {
    const w = dayWorld(d);
    for (const id of ['TOR-01', 'CORE-01']) {
      const n = w.devices[id].nd!;
      expect(n.ifs.Po1, `${id} Po1`).toBeUndefined();
      expect(Object.keys(n.ifs).filter((k) => n.ifs[k].group !== undefined), `${id} bundle members`).toEqual([]);
    }
    expect(w.cables['tor1-up2']).toBeUndefined();
    const core2 = Object.keys(w.devices['CORE-02'].nd!.svis).map(Number);
    expect(core2).not.toContain(10);
    expect(core2).not.toContain(20);
    expect(w.k8s).toBeUndefined();
  });
});

/** The day's world with every cable in place: D-5's servers are mounted, powered and cabled first. */
function cabledWorld(day: StageId): World {
  let run: StageRun = { ...startStage(day, 1), scenarios: [] };
  if (day === 0) for (const id of ['mount', 'power', 'cable']) for (const st of AUTOPLAY[0][id]) run = apply(run, st, null);
  return run.world;
}

/** Cables a solution action changes (the ones it replaces). */
function touched(before: World, action: (w: World) => void): string[] {
  const after = clone(before);
  action(after);
  return Object.keys(before.cables).filter((id) => JSON.stringify(before.cables[id]) !== JSON.stringify(after.cables[id]));
}

const cases: [string, StageId][] = [];
for (const t of TEMPLATES) {
  for (let d = t.day; d <= LAST_DAY; d++) {
    const day = d as StageId;
    if (!validOn(t, day)) continue;
    for (const id of instanceIds(t)) if (getStage(day).scenarios.some((s) => s.id === id)) cases.push([id, day]);
  }
}

describe('cable fixes are reachable in the cable window', () => {
  let checked = 0;
  it.each(cases)('%s on day %i', (id, day) => {
    const def = getStage(day);
    const sc = scenarioOf(def, id);
    const w = cabledWorld(day);
    sc.inject(w);
    const modes = Object.values(def.interactions).flatMap((k) => (k?.kind === 'cable' ? [k.mode] : []));
    const reachable = new Set(modes.flatMap((m) => [...cableGameCables(def, w, m)]));
    for (const st of sc.solutionSteps) {
      if (!('action' in st)) continue;
      for (const c of touched(w, st.action)) {
        checked++;
        expect(reachable.has(c), `${id}: cable ${c} isn't in any cable window on ${def.label} (${[...reachable].join(', ')})`).toBe(true);
      }
    }
  });
  it('some solution replaces a cable', () => expect(checked).toBeGreaterThan(0));
});

/** A day's run with its missions done up to (not including) `upTo`, and no incidents. */
function missionsUpTo(day: StageId, upTo: string): StageRun {
  const def = getStage(day);
  let run: StageRun = { ...startStage(day, 1), scenarios: [] };
  for (let i = 0; i < 30; i++) {
    for (const o of visibleObjectives(def, run)) {
      if (o.id in run.objectivesDone || o.id === upTo) continue;
      for (const st of AUTOPLAY[day]?.[o.id] ?? []) run = apply(run, st, null);
    }
    run = tickRun(run).run;
  }
  return run;
}

const objective = (day: StageId, id: string) => getStage(day).objectives.find((o) => o.id === id)!;

describe('missions count only what they ask for', () => {
  it('D-4 dhcp: the pool list has to be typed on dhcp01, not on the 관리 PC before getting there', () => {
    const o = objective(1, 'dhcp');
    let run = missionsUpTo(1, 'dhcp');
    run = applyCommand(run, 'dhcp pool list', 'ops').run;
    run = applyCommand(run, 'ssh dhcp01', 'ops').run;
    expect(o.done(run.world, run.ctx)).toBe(false);
    run = applyCommand(run, 'dhcp pool list', 'dhcp01').run;
    expect(o.done(run.world, run.ctx)).toBe(true);
  });

  it('D-3 curl: a 200 straight from web plus a 503 through sugang is not a 200 through sugang', () => {
    const o = objective(2, 'curl');
    let run = missionsUpTo(2, 'l4');
    run = applyCommand(run, 'curl http://sugang/enroll', 'ops').run;
    run = tickRun(run).run;
    run = applyCommand(run, 'curl http://web/enroll', 'ops').run;
    run = tickRun(run).run;
    for (const st of AUTOPLAY[2].l4) run = apply(run, st, null);
    run = tickRun(run).run;
    expect(o.done(run.world, run.ctx)).toBe(false);
    run = applyCommand(run, 'curl http://sugang/enroll', 'ops').run;
    expect(o.done(run.world, run.ctx)).toBe(true);
  });
});

describe('D-3 monitoring sees web → db', () => {
  it.each(['d4-vlan:0', 'd4-dns:0', 'd4-svi:0', 'd4-svi:1'])('%s on D-3 shows in the service health', (id) => {
    const def = getStage(2);
    let run = missionsUpTo(2, '');
    expect(run.health.availability).toBeGreaterThan(0.99);
    const w = clone(run.world);
    scenarioOf(def, id).inject(w);
    run = tickRun({ ...run, world: w }).run;
    expect(run.health.services['web → db']).toBe('down');
    expect(run.health.availability).toBeLessThan(0.5);
  });

  it.each(['d3-uplink:0', 'd3-uplink:1'])('%s on D-3: students notice nothing (the text says so)', (id) => {
    const def = getStage(2);
    let run = missionsUpTo(2, '');
    const w = clone(run.world);
    scenarioOf(def, id).inject(w);
    run = tickRun({ ...run, world: w }).run;
    expect(scenarioOf(def, id).check(run.world, run.ctx, run.health)).toBe(false);
    expect(run.health.availability).toBeGreaterThan(0.99);
  });
});

describe('the 사수 can not give the fix away in plain words', () => {
  const said = (id: string, reply: string) => leaks(reply, bannedFor(instance(id)));
  it.each([
    ['d3-l4health:0', '헬스체크 경로를 /health 로 바꿔봐'],
    ['d3-l4health:1', '헬스체크 포트를 80으로 맞춰'],
    ['d3-notify:0', 'notify 서비스만 재시작해'],
    ['d3-notify:0', '알림 서비스를 다시 시작해봐'],
    ['d4-errdisable:0', '그 포트를 한 번 껐다가 다시 켜면 돼'],
    ['d4-svi:0', '그 인터페이스를 다시 켜면 돼'],
  ])('%s: "%s" is caught', (id, reply) => expect(said(id, reply)).toBe(true));
  it.each([
    ['d3-l4health:0', '헬스체크 설정을 서버가 실제로 가진 경로와 비교해봐'],
    ['d3-l4health:1', '대표 주소 10.10.30.100 으로 들어오는 요청을 봐'],
  ])('%s: "%s" passes', (id, reply) => expect(said(id, reply)).toBe(false));
});
