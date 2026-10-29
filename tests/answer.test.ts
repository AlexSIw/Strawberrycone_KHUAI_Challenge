import { describe, expect, it } from 'vitest';
import { commandLine, formatGuide, incidentGuide, parseGuide } from '../src/ai/answer';
import { bannedFor, leaks } from '../src/ai/leak';
import { allInstances, instance } from '../src/content/incidents';
import { ALL_COMMANDS } from '../src/sim/commands';
import { parseText } from '../src/sim/ios/leak';

describe("쿠사수's three-line answer", () => {
  it('formats and parses back', () => {
    const g = { situation: '서버 한 대가 안 보여요', todo: '포트 VLAN 되돌리기', command: 'show vlan brief' };
    expect(formatGuide(g)).toBe('상황: 서버 한 대가 안 보여요\n할 일: 포트 VLAN 되돌리기\n명령: show vlan brief');
    expect(parseGuide(formatGuide(g))).toEqual(g);
    expect(parseGuide('VLAN은 한 스위치를 여러 방으로 나누는 거예요.')).toBeNull();
  });

  it('the 명령 line goes to the device, looks first, then fixes in config mode with the values blank', () => {
    expect(commandLine(instance('d4-vlan:0'))).toBe(
      'ssh TOR-01 → (확인) show vlan brief, show logging → (고치기) enable → conf t → interface <포트> → switchport access vlan <번호> → end → wr',
    );
    // Already on the switch: no ssh.
    expect(commandLine(instance('d4-vlan:0'), 'TOR-01')).toMatch(/^\(확인\) show vlan brief/);
    // A shell fix on the 관리 PC, asked from another server: back to ops first.
    expect(commandLine(instance('dday-capacity:0'), 'ops')).toBe('(확인) deploys, pods → (고치기) scale <앱> <개수>');
    expect(commandLine(instance('dday-capacity:0'), 'ns1')).toBe('exit (관리 PC로) → (확인) deploys, pods → (고치기) scale <앱> <개수>');
    // The same lines on two switches.
    expect(commandLine(instance('d2-storm:0'), 'ops')).toMatch(/^TOR-01·TOR-02 각각 ssh → /);
    // No command at all: where the fix is done instead.
    expect(commandLine(instance('d3-campus:0'))).toBe('명령 없이 NOC 경보 목록의 "담당팀 이관" 버튼');
  });

  it('every incident has a short 할 일, real checks and a guide that gives no value away', () => {
    const heads = new Set(ALL_COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])].map((n) => n.split(' ')[0])));
    for (const sc of allInstances()) {
      expect(sc.todo.length, sc.id).toBeGreaterThan(0);
      expect(sc.todo.length, sc.id).toBeLessThanOrEqual(40);
      const typed = sc.solutionSteps.some((s) => 'cmd' in s || 'ios' in s);
      if (!typed) expect(sc.fixHow, sc.id).toBeTruthy();
      const iosHosts = new Set(sc.solutionSteps.flatMap((s) => ('ios' in s ? [s.host] : [])));
      for (const c of sc.checks) {
        if (iosHosts.size) expect(parseText(c, 'user')?.ok, `${sc.id}: ${c}`).toBe(true);
        else expect(heads.has(c.split(' ')[0]), `${sc.id}: ${c}`).toBe(true);
      }
      const banned = bannedFor(sc);
      for (const from of [undefined, 'ops', ...sc.solutionSteps.flatMap((s) => ('host' in s ? [s.host] : []))]) {
        const guide = incidentGuide(sc, from);
        expect(parseGuide(guide), sc.id).not.toBeNull();
        expect(leaks(guide, banned), `${sc.id}: ${guide}`).toBe(false);
      }
    }
  });
});
