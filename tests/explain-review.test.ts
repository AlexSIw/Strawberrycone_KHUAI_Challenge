// Fixes from the explain-before-do playtests that live below the UI: the radio's offline answers, the
// daily report's 감점 line, CLI messages on the wrong host, and the new Korean glosses.
import { describe, expect, it } from 'vitest';
import { incidentGuide, parseGuide } from '../src/ai/answer';
import { cannedIncident, cannedMission, glossaryIn } from '../src/ai/client';
import { getStage } from '../src/content/stages';
import { applyCommand, scenarioOf, scoreParts, startStage, type Score, type StageRun } from '../src/sim/engine';
import { runIos } from '../src/sim/ios';
import { syslogGloss, TIP } from '../src/sim/ios/gloss';
import { initRuntime } from '../src/sim/scenario';
import { LAST_DAY } from '../src/sim/types';

// eslint-disable-next-line no-control-regex
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const sh = (run: StageRun, line: string, host = 'ops') =>
  applyCommand(run, line, host)
    .lines.map(strip)
    .join('\n');

describe('the radio without AI answers what a word means', () => {
  it('a mission question naming a word with no card of its own (DB) gets its meaning first', () => {
    const run = startStage(2);
    const o = getStage(2).objectives[0];
    const reply = cannedMission(run, o, 'DB가 뭐예요?');
    expect(reply).toContain('창고 서버');
    // Nothing matches: what to do next, in the three lines.
    expect(parseGuide(cannedMission(run, o, '점심 메뉴 뭐예요?'))).not.toBeNull();
  });

  it("during an incident a word question gets the word's card, never the incident's own card; anything else the three lines", () => {
    let run = startStage(3);
    run = { ...run, scenarios: initRuntime([{ id: 'd2-uplink:0', trigger: { type: 'stageStart', delay: 0, overlap: true } }]) };
    const sc = scenarioOf(getStage(3), 'd2-uplink:0');
    expect(cannedIncident(run, sc, 'VLAN이 뭐예요?')).toContain('VLAN');
    // A card that belongs to one of today's incidents: the glossary's one-liner instead.
    expect(cannedIncident(run, sc, 'STP가 뭐예요?')).toContain('예비 길');
    // "How do I fix it", or the 힌트 받기 button: situation, what to do, the commands with the values blank.
    expect(cannedIncident(run, sc, '어떻게 고쳐요?', 'ops')).toBe(incidentGuide(sc, 'ops'));
    expect(cannedIncident(run, sc)).toContain('명령: TOR-01·CORE-01 각각 ssh → (확인) show etherchannel summary');
  });

  it('Latin words match whole words only', () => {
    expect(glossaryIn('DB-01이 뭐예요?')).toContain('창고');
    expect(glossaryIn('dbdata 볼륨')).toBeUndefined();
  });
});

describe('daily report', () => {
  it('the 감점 parts add up to 100 − the score, biggest first', () => {
    const score: Score = { stars: 3, points: 88, availability: 1, mttd: 25, mttr: 66, revealed: 0, escalated: 0 };
    const parts = scoreParts(score);
    expect(parts.map((p) => p.key)).toEqual(['mttr', 'mttd']);
    expect(parts.reduce((a, p) => a + p.points, 0)).toBe(12);
    expect(scoreParts({ ...score, points: 100, mttd: null, mttr: null })).toEqual([]);
  });
});

describe('CLI on the wrong host', () => {
  it('ops-only commands on the L4 point back to the 관리 PC; its help lists exit once', () => {
    const run = startStage(LAST_DAY);
    expect(sh(run, 'pods', 'L4-01')).toContain('exit로 관리 PC(ops)');
    expect(sh(run, 'help', 'L4-01').match(/^\s+exit\b/gm)).toHaveLength(1);
  });

  it('dns / dhcp on a switch name the server they belong on; clear clears the screen there too', () => {
    const w = startStage(1).world;
    const tip = (line: string) => runIos(line, w, 'TOR-01', { level: 'exec' }, 1).lines.map(strip).at(-1);
    expect(tip('dns add web 10.10.10.11')).toBe(TIP.dnsHost);
    expect(tip('dhcp pool list')).toBe(TIP.dhcpHost);
    const r = applyCommand(startStage(1), 'clear', 'TOR-01', { level: 'exec' });
    expect(r.clear).toBe(true);
  });
});

describe('new glosses', () => {
  it('env says what a setting is, never what it should be', () => {
    const out = sh(startStage(LAST_DAY), 'env enroll');
    expect(out).toContain('DB_POOL = pod 하나가 DB-01과 미리 열어 두는 연결 수');
    const glosses = out.split('\n').filter((l) => l.startsWith('('));
    expect(glosses.length).toBeGreaterThanOrEqual(2);
    expect(glosses.join(' ')).not.toMatch(/=\s*\d/);
  });

  it('syslog lines get a plain line in the NOC device pane', () => {
    expect(syslogGloss('SYS-5-CONFIG_I', 'Configured from console by admin on vty0 (10.10.100.23)')).toContain('10.10.100.23');
    expect(syslogGloss('LINK-3-UPDOWN', 'Interface Gi1/0/1, changed state to up')).toBe('포트 연결이 켜졌어요');
    expect(syslogGloss('SW_MATM-4-MACFLAP_NOTIF', 'Host … is flapping')).toContain('번갈아');
    expect(syslogGloss('XYZ-6-OTHER', 'x')).toBeNull();
  });
});
