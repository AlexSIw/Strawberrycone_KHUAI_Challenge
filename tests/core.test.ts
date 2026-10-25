// Engine building blocks: topology, clock, scheduler, alarms, and the day runtime (escalation, ACK/MTTD,
// scoring, clearing) driven with made-up incidents.
import { describe, expect, it } from 'vitest';
import { dayWorld, getStage, STAGES } from '../src/content/days';
import { baseTopology, validateWorld } from '../src/content/topology';
import { nextPoll, updateAlarms } from '../src/sim/alarms';
import { DDAY_CLOCK, WEEKDAY_CLOCK } from '../src/content/days/common';
import { fmtClock, gameSec, parseHms, stageAt, syslogStamp } from '../src/sim/clock';
import { normIf } from '../src/sim/net/ifname';
import {
  ackAlarm,
  applyAction,
  canEscalate,
  clockText,
  escalate,
  isCleared,
  scoreRun,
  startStage,
  tickRun,
  type StageRun,
} from '../src/sim/engine';
import { initRuntime, type Scenario, type Trigger } from '../src/sim/scenario';
import { mulberry32, planDay } from '../src/sim/scheduler';

describe('topology', () => {
  it('the D-Day network is structurally sound', () => {
    expect(validateWorld(baseTopology())).toEqual([]);
  });
  it.each(STAGES.map((d) => [d.label, d.id] as const))('%s starting world is structurally sound', (_l, d) => {
    expect(validateWorld(dayWorld(d))).toEqual([]);
  });
});

describe('interface names', () => {
  it.each([
    ['gi1/0/5', 'Gi1/0/5'],
    ['GigabitEthernet1/0/5', 'Gi1/0/5'],
    ['g 1/0/5', 'Gi1/0/5'],
    ['te1/1/1', 'Te1/1/1'],
    ['hu1/0/1', 'Hu1/0/1'],
    ['po1', 'Po1'],
    ['port-channel 1', 'Po1'],
    ['vlan10', 'Vlan10'],
    ['vl 10', 'Vlan10'],
  ])('%s → %s', (input, out) => expect(normIf(input)).toBe(out));
  it.each(['gi1', 'po1/0/1', 'x1/0/1', 'fastethernet0/1'])('%s is not an interface here', (input) => expect(normIf(input)).toBeNull());
});

describe('clock', () => {
  it('weekdays start at 09:00 and run 30× real time', () => {
    expect(fmtClock(gameSec(WEEKDAY_CLOCK, 0))).toBe('09:00');
    expect(fmtClock(gameSec(WEEKDAY_CLOCK, 120))).toBe('10:00');
  });
  it('D-Day reaches 10:30 after about 9.5 real minutes, slow at the peak', () => {
    expect(stageAt(DDAY_CLOCK, '10:00:00')).toBe(90);
    expect(stageAt(DDAY_CLOCK, '10:30:00')).toBe(570);
    // the 5 peak minutes take 210 real seconds
    expect(stageAt(DDAY_CLOCK, '10:05:00') - stageAt(DDAY_CLOCK, '10:00:00')).toBe(210);
  });
  it('stageAt inverts gameSec, and time only goes forward', () => {
    let prev = -1;
    for (let t = 0; t <= 700; t += 7) {
      const g = gameSec(DDAY_CLOCK, t);
      expect(g).toBeGreaterThan(prev);
      prev = g;
      expect(stageAt(DDAY_CLOCK, fmtClock(g, true))).toBeCloseTo(t, 0);
    }
  });
  it('syslog stamps look like IOS', () => {
    expect(syslogStamp(DDAY_CLOCK, '02-10', 90)).toBe('*Feb 10 10:00:00');
    expect(parseHms('10:05:30')).toBe(36330);
  });
});

describe('scheduler', () => {
  const input = {
    day: 2,
    fixed: [{ template: 'teach', variants: 2, trigger: { type: 'gate' as const, objectives: ['a'] } }],
    extras: [1, 2] as [number, number],
    objectiveIds: ['a', 'b'],
    pool: [
      { template: 'old1', variants: 3, weight: 1, sameDay: false },
      { template: 'old2', variants: 1, weight: 1, sameDay: false },
      { template: 'today', variants: 1, weight: 1, sameDay: true },
    ],
  };
  it('is deterministic per seed', () => {
    expect(planDay(input, 7)).toEqual(planDay(input, 7));
    expect(mulberry32(3)()).toBe(mulberry32(3)());
  });
  it('always has the fixed incident, then 1–2 extras chained one after another, no repeats', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const plan = planDay(input, seed);
      expect(plan[0].id).toMatch(/^teach:[01]$/);
      const extras = plan.slice(1);
      expect(extras.length).toBeGreaterThanOrEqual(1);
      expect(extras.length).toBeLessThanOrEqual(2);
      expect(new Set(extras.map((e) => e.id.split(':')[0])).size).toBe(extras.length);
      extras.forEach((e, i) => {
        expect(e.trigger.type).toBe('gate');
        if (e.trigger.type === 'gate') expect(e.trigger.scenarios).toEqual([plan[i].id]);
      });
    }
  });
  it('over many seeds every pool template and variant shows up', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) planDay(input, seed).forEach((p) => seen.add(p.id));
    expect([...seen].sort()).toEqual(['old1:0', 'old1:1', 'old1:2', 'old2:0', 'teach:0', 'teach:1', 'today:0']);
  });
  it("an extra from today's own pool waits for every mission", () => {
    for (let seed = 1; seed <= 100; seed++) {
      for (const p of planDay(input, seed)) if (p.id === 'today:0' && p.trigger.type === 'gate') expect(p.trigger.objectives).toEqual(['a', 'b']);
    }
  });
});

describe('alarms', () => {
  const sc = (source: 'trap' | 'poll'): Scenario =>
    ({ id: 'x', severity: 'major', alarm: { source, device: 'TOR-01', text: 'x' } }) as unknown as Scenario;
  it('traps show up at once; polled metrics at the next poll; both clear the same way', () => {
    for (const source of ['trap', 'poll'] as const) {
      const rt = initRuntime([{ id: 'x', trigger: { type: 'stageStart' } }]);
      rt[0].state = 'active';
      rt[0].activatedAt = 17;
      const at = source === 'trap' ? 17 : nextPoll(17, 15);
      expect(updateAlarms([], rt, () => sc(source), at - 1).raised).toEqual(source === 'trap' ? [] : []);
      const { alarms, raised } = updateAlarms([], rt, () => sc(source), at);
      expect(raised).toEqual(['x']);
      expect(alarms[0].raisedAt).toBe(at);
      rt[0].state = 'resolved';
      rt[0].resolvedAt = 40;
      const cleared = updateAlarms(alarms, rt, () => sc(source), 50).alarms;
      expect(cleared[0].clearedAt).toBe(source === 'trap' ? 40 : 45);
    }
  });
  it('an incident fixed before the poll saw it never raises an alarm', () => {
    const rt = initRuntime([{ id: 'x', trigger: { type: 'stageStart' } }]);
    Object.assign(rt[0], { state: 'resolved', activatedAt: 16, resolvedAt: 20 });
    expect(updateAlarms([], rt, () => sc('poll'), 60).alarms).toEqual([]);
  });
});

// ---------- engine: escalation, ACK / MTTD, scoring, clearing (made-up incidents on D-5) ----------

/** A made-up incident: inject sets a flag, the fix clears it. */
function synth(id: string, over: Partial<Scenario> = {}): Scenario {
  return {
    id,
    stage: 0,
    title: id,
    alert: `${id} 증상`,
    severity: 'major',
    alarm: { source: 'trap', device: 'CAMPUS-ENG', text: `${id} 경보` },
    room: 'network',
    trigger: { type: 'stageStart' },
    inject: (w) => void (w.flags[id] = true),
    check: (w) => !w.flags[id],
    hints: ['관찰', '방향', '도구'],
    bannedPhrases: [],
    solution: '',
    solutionSteps: [],
    concept: 'datacenter',
    lesson: '',
    ...over,
  };
}

const DAY0 = getStage(0);
let fixes = 0;
DAY0.scenarios.push(
  synth('t-esc', {
    escalate: {
      delay: 30,
      team: '캠퍼스망 담당팀',
      fix: (w) => {
        w.flags['t-esc'] = false;
        fixes += 1;
      },
    },
  }),
  synth('t-poll', { alarm: { source: 'poll', device: 'TOR-01', text: '업링크 사용률 높음' } }),
  synth('t-cond', { optional: true }),
);

/** A D-5 run with only these incidents planned. */
function runWith(plan: { id: string; trigger: Trigger }[]): StageRun {
  return { ...startStage(0), scenarios: initRuntime(plan) };
}
const tickTo = (run: StageRun, t: number) => {
  while (run.ctx.stageTime < t) run = tickRun(run).run;
  return run;
};
const rtOf = (run: StageRun, id: string) => run.scenarios.find((s) => s.id === id)!;
const fix = (run: StageRun, id: string) => applyAction(run, (w) => void (w.flags[id] = false)).run;

describe('escalation (담당팀 이관)', () => {
  it("resolves only after the team's delay, runs the fix once, and the delay counts toward MTTR", () => {
    fixes = 0;
    let run = tickTo(runWith([{ id: 't-esc', trigger: { type: 'stageStart', delay: 5 } }]), 10);
    expect(rtOf(run, 't-esc')).toMatchObject({ state: 'active', activatedAt: 5 });
    expect(canEscalate(run, 't-esc')).toBe(true);
    run = escalate(run, 't-esc');
    expect(rtOf(run, 't-esc').escalatedAt).toBe(10);
    // Handing over also acknowledges the alarm.
    expect(run.alarms.find((a) => a.id === 't-esc')!.ackAt).toBe(10);
    expect(canEscalate(run, 't-esc')).toBe(false);
    expect(escalate(run, 't-esc')).toBe(run);
    run = tickTo(run, 39);
    expect(rtOf(run, 't-esc').state).toBe('active');
    run = tickTo(run, 40);
    expect(rtOf(run, 't-esc')).toMatchObject({ state: 'resolved', resolvedAt: 40 });
    run = tickTo(run, 60);
    expect(fixes).toBe(1);
    const s = scoreRun(run);
    expect(s.mttr).toBe(35);
    expect(s.mttd).toBe(5);
    expect(s.escalated).toBe(1);
  });

  it('only shallow incidents (with an owning team) can be handed over', () => {
    const run = tickTo(runWith([{ id: 't-poll', trigger: { type: 'stageStart', delay: 1 } }]), 3);
    expect(rtOf(run, 't-poll').state).toBe('active');
    expect(canEscalate(run, 't-poll')).toBe(false);
    expect(escalate(run, 't-poll')).toBe(run);
    expect(canEscalate(run, 'nope')).toBe(false);
  });
});

describe('ACK and MTTD', () => {
  it('a polled alarm shows up at the next poll; ACK stops MTTD; the alarm clears at the poll after the fix', () => {
    let run = tickTo(runWith([{ id: 't-poll', trigger: { type: 'stageStart', delay: 17 } }]), 29);
    expect(rtOf(run, 't-poll').activatedAt).toBe(17);
    expect(run.alarms).toEqual([]);
    const t = tickRun(run);
    expect(t.raised).toEqual(['t-poll']);
    run = tickTo(t.run, 33);
    const before = run;
    run = ackAlarm(run, 't-poll');
    // The run is copied: the earlier one still has its alarm unacknowledged.
    expect(before.alarms[0].ackAt).toBeNull();
    expect(run.alarms[0]).toMatchObject({ raisedAt: 30, ackAt: 33 });
    // A second ACK (or an unknown id) changes nothing.
    expect(ackAlarm(tickTo(run, 36), 't-poll').alarms[0].ackAt).toBe(33);
    expect(ackAlarm(run, 'nope').alarms).toEqual(run.alarms);
    run = tickTo(fix(tickTo(run, 39), 't-poll'), 40);
    expect(rtOf(run, 't-poll').resolvedAt).toBe(40);
    expect(run.alarms[0].clearedAt).toBeNull();
    run = tickTo(run, 45);
    expect(run.alarms[0].clearedAt).toBe(45);
    expect(scoreRun(run).mttd).toBe(16);
    expect(scoreRun(run).mttr).toBe(23);
  });
});

describe('scoreRun', () => {
  /** One incident that started at 100 and was fixed 40 s later, acknowledged `ack` s in (or never). */
  const scored = (ack: number | null) => {
    const run = runWith([{ id: 't-esc', trigger: { type: 'stageStart' } }]);
    Object.assign(run.scenarios[0], { state: 'resolved', activatedAt: 100, resolvedAt: 140 });
    run.alarms = [
      { id: 't-esc', scenarioId: 't-esc', sev: 'major', device: 'x', text: 'x', source: 'trap', raisedAt: 100, ackAt: ack === null ? null : 100 + ack, clearedAt: 140 },
    ];
    return scoreRun(run);
  };
  it('MTTD weighs little: free up to 15 s, then −1 per 2 s, at most −10', () => {
    expect(scored(10)).toMatchObject({ mttd: 10, mttr: 40, points: 100, stars: 3 });
    expect(scored(15).points).toBe(100);
    expect(scored(25).points).toBe(95);
    expect(scored(35).points).toBe(90);
    // Never acknowledged: detection counts until the fix (40 s), capped.
    expect(scored(null)).toMatchObject({ mttd: 40, points: 90 });
  });
});

describe('isCleared', () => {
  const allMissions = (run: StageRun): StageRun => ({ ...run, objectivesDone: Object.fromEntries(DAY0.objectives.map((o) => [o.id, 0])) });
  const never: Trigger = { type: 'condition', when: () => false };
  it("optional incidents that never fired don't block the day; ones that fired must be fixed", () => {
    expect(isCleared(allMissions(runWith([{ id: 't-cond', trigger: never }])))).toBe(true);
    // A condition trigger is optional even if the scenario doesn't say so (the scheduler never gates on it).
    expect(isCleared(allMissions(runWith([{ id: 't-poll', trigger: never }])))).toBe(true);
    expect(isCleared(allMissions(runWith([{ id: 't-poll', trigger: { type: 'stageStart', delay: 100 } }])))).toBe(false);
    const fired = allMissions(tickTo(runWith([{ id: 't-cond', trigger: { type: 'condition', when: () => true } }]), 2));
    expect(rtOf(fired, 't-cond').state).toBe('active');
    expect(isCleared(fired)).toBe(false);
  });
  it('every mission has to be done', () => {
    expect(isCleared(runWith([]))).toBe(DAY0.objectives.length === 0);
  });
});

describe('clockText', () => {
  it('weekdays show HH:MM from 09:00; D-Day shows seconds', () => {
    expect(clockText(startStage(1))).toBe('09:00');
    expect(clockText(startStage(5))).toBe('09:50:00');
  });
});
