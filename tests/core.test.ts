// WP0 building blocks: topology, clock, scheduler, alarms.
import { describe, expect, it } from 'vitest';
import { dayWorld, STAGES } from '../src/content/days';
import { baseTopology, validateWorld } from '../src/content/topology';
import { nextPoll, updateAlarms } from '../src/sim/alarms';
import { DDAY_CLOCK, WEEKDAY_CLOCK } from '../src/content/days/common';
import { fmtClock, gameSec, parseHms, stageAt, syslogStamp } from '../src/sim/clock';
import { normIf } from '../src/sim/net/ifname';
import { initRuntime, type Scenario } from '../src/sim/scenario';
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
