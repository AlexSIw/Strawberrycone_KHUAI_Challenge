// Fixes from the play-through reviews that live below the UI: what the CLI says (TOR ping, appliance
// ssh, L4 and k8s output, the D-Day DB logs), which concept cards exist, and how the days are planned.
import { describe, expect, it } from 'vitest';
import { missionCards } from '../src/content/cards';
import { CONCEPTS } from '../src/content/concepts';
import { getStage, planIncidents, STAGES } from '../src/content/stages';
import { applyCommand, startStage, tickRun, type StageRun } from '../src/sim/engine';
import { LAST_DAY, type IosMode, type StageId } from '../src/sim/types';
import { sourceName, unsavedGear } from '../src/ui/noc/facility';

// eslint-disable-next-line no-control-regex
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

function sh(run: StageRun, line: string, host = 'ops') {
  const r = applyCommand(run, line, host);
  return { run: r.run, out: r.lines.map(strip).join('\n') };
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

describe('CLI wording', () => {
  it('a ping from a TOR (management address only) says why it fails and where to ping from', () => {
    const run = startStage(1);
    const byIp = ios(run, 'TOR-01', ['ping 10.10.20.11']).out;
    expect(byIp).toContain('Success rate is 0 percent');
    expect(byIp).toContain('관리 PC(ops)에서 ping');
    expect(ios(run, 'TOR-01', ['ping db']).out).toContain('관리 PC(ops)에서 ping');
    // Management addresses answer, with no note; a core (it has SVIs) gets no note either.
    expect(ios(run, 'TOR-01', ['ping 10.10.250.21']).out).not.toContain('관리 PC(ops)에서 ping');
    expect(ios(run, 'CORE-01', ['ping 10.10.99.99']).out).not.toContain('관리 PC(ops)에서 ping');
  });

  it('a shell command typed on the L4 points back to the 관리 PC', () => {
    const run = startStage(2);
    const at = sh(run, 'ssh L4-01').run;
    expect(sh(at, 'ssh TOR-01', 'L4-01').out).toContain('exit로 관리 PC(ops)에 돌아가서');
  });

  it('L4 and web outputs are Korean, with the right particle after the port number', () => {
    let run = startStage(2);
    expect(sh(run, 'lb pool add web 80', 'L4-01').out).toContain('풀에 추가했어요: web:80');
    expect(sh(run, 'lb health set path /health', 'L4-01').out).toContain('헬스체크 경로를 바꿨어요: /health');
    run = sh(run, 'server start', 'web').run;
    expect(sh(run, 'server set port 80', 'web').out).toContain('포트를 80으로 바꾸고');
    expect(sh(run, 'server set port 8081', 'web').out).toContain('포트를 8081로 바꾸고');
  });

  it('show version names no real vendor OS; the NOC PC port has an ASCII description', () => {
    const run = startStage(LAST_DAY);
    expect(ios(run, 'TOR-01', ['show version']).out).toContain('KHU NOS Software');
    expect(ios(run, 'TOR-02', ['show interfaces status']).out).toMatch(/Gi1\/0\/12\s+NOC-PC\s+connected/);
  });

  it('scale says when it clamps; nodes keeps its columns with SchedulingDisabled', () => {
    let run = startStage(4);
    run = sh(run, 'uncordon n1').run;
    expect(sh(run, 'scale enroll 20').out).toContain('최대 16개까지라서 16개로 맞췄어요');
    expect(sh(run, 'scale enroll 3').out).not.toContain('최대 16개');
    run = sh(run, 'cordon n1').run;
    // The table rows (the Korean gloss lines under it start with '(').
    const rows = sh(run, 'nodes').out.split('\n').filter((r) => !r.startsWith('('));
    const rackCol = rows.map((r) => r.indexOf('rack'));
    expect(rows[0].indexOf('RACK')).toBe(rackCol[1]);
    expect(new Set(rackCol.slice(1)).size).toBe(1);
  });

  it('D-Day: enroll logs show the DB-01 connection error while pods × DB_POOL is over the limit', () => {
    let run = startStage(LAST_DAY);
    expect(sh(run, 'logs enroll').out).toContain('GET /enroll 200');
    run = sh(run, 'scale enroll 16').run;
    for (let i = 0; i < 8; i++) run = tickRun(run).run;
    const over = sh(run, 'logs enroll').out;
    expect(over).toContain('ERROR DB-01 연결 실패: too many connections (200/200)');
    expect(over).not.toContain('GET /enroll 200');
    run = sh(run, 'env set enroll DB_POOL=10').run;
    for (let i = 0; i < 8; i++) run = tickRun(run).run;
    expect(sh(run, 'logs enroll').out).toContain('GET /enroll 200');
    run = sh(run, 'env set enroll DB_POOL=abc').run;
    for (let i = 0; i < 8; i++) run = tickRun(run).run;
    expect(sh(run, 'logs enroll').out).toContain('DB_POOL 값을 읽지 못했어요');
  });
});

describe('names and save reminders', () => {
  it('alarm sources read like the alarm list: devices, campus services, places', () => {
    const w = startStage(2).world;
    expect(sourceName(w, 'TOR-01')).toBe('TOR-01');
    expect(sourceName(w, 'library')).toBe('KHU 도서관');
    expect(sourceName(w, 'rack2')).toBe('랙 2');
    expect(sourceName(w, 'net1')).toBe('네트워크실 1번 랙');
  });

  it('unsavedGear lists the gear with changes not written to memory', () => {
    let run = startStage(1);
    expect(unsavedGear(run.world)).toEqual([]);
    run = ios(run, 'TOR-01', ['enable', 'configure terminal', 'vlan 10', 'end']).run;
    expect(unsavedGear(run.world)).toEqual(['TOR-01']);
    run = ios(run, 'TOR-01', ['enable', 'write memory']).run;
    expect(unsavedGear(run.world)).toEqual([]);
  });
});

describe('concept cards and plans', () => {
  it('every concept card can be earned somewhere, and every awarded card exists', () => {
    const used = new Set<string>();
    for (const d of STAGES) {
      for (const o of d.objectives) for (const c of missionCards(o)) used.add(c);
      for (const s of d.scenarios) if (s.concept) used.add(s.concept);
    }
    expect(Object.keys(CONCEPTS).filter((k) => !used.has(k))).toEqual([]);
    expect([...used].filter((k) => !(k in CONCEPTS))).toEqual([]);
  });

  it('D-3 always has the 담당팀 이관 incident after the MSA mission; D-4 draws no extra', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const d3 = planIncidents(getStage(2), seed);
      expect(d3.some((p) => p.id.startsWith('d3-campus:') && p.trigger.type === 'gate' && p.trigger.objectives?.includes('msa'))).toBe(true);
      expect(planIncidents(getStage(1), seed).map((p) => p.id.split(':')[0])).toEqual(['d4-vlan', 'd4-dhcp']);
    }
  });

  it('extras wait 12–31 s after what they follow', () => {
    for (const day of [2, 3, 4] as StageId[]) {
      for (let seed = 1; seed <= 50; seed++) {
        const def = getStage(day);
        for (const p of planIncidents(def, seed).slice(def.id === 2 ? 2 : 0)) {
          if (p.trigger.type !== 'gate' || p.trigger.delay === undefined) continue;
          expect(p.trigger.delay).toBeGreaterThanOrEqual(12);
          expect(p.trigger.delay).toBeLessThanOrEqual(31);
        }
      }
    }
  });
});
