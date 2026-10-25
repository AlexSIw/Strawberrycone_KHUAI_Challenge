// IOS CLI: parser (abbreviations, ambiguity, caret, incomplete), modes and prompts, ?/Tab, config
// commands, save, canonical forms and the leak-guard regex. Show outputs that come only from config are
// snapshotted; the ones that depend on live network state are checked for structure.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { baseTopology } from '../src/content/topology';
import { runCommand } from '../src/sim/commands';
import { canonicalize, iosCheatSheet, iosComplete, iosHelp, iosPrompt, iosScript, iosVariantsRegex, runIos, type IosResult } from '../src/sim/ios';
import type { IosLevel, IosMode, World } from '../src/sim/types';

const RED = '\x1b[31m';
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const text = (r: IosResult) => r.lines.map(strip).join('\n');

const EXEC: IosMode = { level: 'exec' };
const CONFIG: IosMode = { level: 'config' };
const ifMode = (k: string): IosMode => ({ level: 'config-if', ifs: [k], ...(k.startsWith('Vlan') ? { vlan: parseInt(k.slice(4), 10) } : {}) });

/** Type lines one after another from `mode`; returns every result and the final mode. */
function type(w: World, host: string, lines: string[], mode: IosMode = { level: 'user' }) {
  const results: IosResult[] = [];
  let m: IosMode | null = mode;
  for (const l of lines) {
    if (!m) throw new Error(`session already closed before "${l}"`);
    const r = runIos(l, w, host, m, 1);
    results.push(r);
    m = r.mode;
  }
  return { results, mode: m, last: results[results.length - 1] };
}

describe('abbreviations expand to the full command', () => {
  const cases: [IosMode, string, string][] = [
    [EXEC, 'sh ip int br', 'show ip interface brief'],
    [EXEC, 'show ip interface brief', 'show ip interface brief'],
    [EXEC, 'sh int status', 'show interfaces status'],
    [EXEC, 'sh int count err', 'show interfaces counters errors'],
    [EXEC, 'sh vlan br', 'show vlan brief'],
    [EXEC, 'sh eth sum', 'show etherchannel summary'],
    [EXEC, 'sh stan br', 'show standby brief'],
    [EXEC, 'sh span vlan 10', 'show spanning-tree vlan 10'],
    [EXEC, 'sh run', 'show running-config'],
    [EXEC, 'sh run int gi1/0/1', 'show running-config interface Gi1/0/1'],
    [EXEC, 'SH INT GI1/0/1', 'show interfaces Gi1/0/1'],
    [EXEC, 'conf t', 'configure terminal'],
    [EXEC, 'wr', 'write memory'],
    [EXEC, 'copy run start', 'copy running-config startup-config'],
    [CONFIG, 'int gi1/0/5', 'interface Gi1/0/5'],
    [CONFIG, 'int gi 1/0/5', 'interface Gi1/0/5'],
    [CONFIG, 'interface GigabitEthernet1/0/5', 'interface Gi1/0/5'],
    [CONFIG, 'int te1/1/4', 'interface Te1/1/4'],
    [CONFIG, 'int port-channel 1', 'interface Po1'],
    [CONFIG, 'int vlan 10', 'interface Vlan10'],
    [CONFIG, 'no span vlan 10', 'no spanning-tree vlan 10'],
    [ifMode('Gi1/0/5'), 'sw acc vl 20', 'switchport access vlan 20'],
    [ifMode('Gi1/0/5'), 'sw mo tr', 'switchport mode trunk'],
    [ifMode('Gi1/0/5'), 'no sh', 'no shutdown'],
    [ifMode('Gi1/0/5'), 'sh', 'shutdown'],
    [ifMode('Te1/1/4'), 'channel-g 1 mo act', 'channel-group 1 mode active'],
    [ifMode('Te1/1/3'), 'sw tr all vl add 100', 'switchport trunk allowed vlan add 100'],
  ];
  it.each(cases)('%j: %s', (mode, line, canonical) => {
    const r = runIos(line, baseTopology(), 'TOR-01', mode, 1);
    expect(r.lines.filter((l) => l.startsWith(RED))).toEqual([]);
    expect(r.canonical).toBe(canonical);
    expect(r.events[0]).toBe(`ios:TOR-01:${canonical}`);
  });
});

describe('parser errors', () => {
  it('bare "s" is ambiguous (decoy keywords) while "sh" is show', () => {
    for (const mode of [{ level: 'user' }, EXEC] as IosMode[]) {
      const r = runIos('s', baseTopology(), 'TOR-01', mode, 1);
      expect(r.lines).toEqual([`${RED}% Ambiguous command:  "s"\x1b[0m`]);
      expect(r.canonical).toBeNull();
      expect(r.events).toEqual([]);
    }
    expect(runIos('sh vlan br', baseTopology(), 'TOR-01', EXEC, 1).canonical).toBe('show vlan brief');
  });

  it('puts the caret under the first bad token (prompt width + column)', () => {
    const w = baseTopology();
    // 'TOR-01# ' is 8 columns; 'foo' starts at column 5 of the line
    const r = runIos('show foo', w, 'TOR-01', EXEC, 1);
    expect(r.lines[0]).toBe(`${' '.repeat(8 + 5)}^`);
    expect(r.lines[1]).toBe(`${RED}% Invalid input detected at '^' marker.\x1b[0m`);
    // 'TOR-01(config-if)# ' is 19 columns; '30x' starts at column 23
    const r2 = runIos('switchport access vlan 30x', w, 'TOR-01', ifMode('Gi1/0/9'), 1);
    expect(r2.lines[0]).toBe(`${' '.repeat(19 + 23)}^`);
    // a port that doesn't exist on this switch is invalid input too
    const r3 = runIos('interface gi1/0/40', w, 'TOR-01', CONFIG, 1);
    expect(r3.lines[0]).toBe(`${' '.repeat(16 + 10)}^`);
  });

  it('reports incomplete commands', () => {
    const w = baseTopology();
    expect(text(runIos('switchport access vlan', w, 'TOR-01', ifMode('Gi1/0/9'), 1))).toBe('% Incomplete command.');
    expect(text(runIos('sh ip', w, 'TOR-01', EXEC, 1))).toBe('% Incomplete command.');
    expect(text(runIos('show', w, 'TOR-01', EXEC, 1))).toBe('% Type "show ?" for a list of subcommands');
    expect(runIos('no', w, 'TOR-01', CONFIG, 1).lines[0].startsWith(RED)).toBe(true);
  });

  it('plain show in config mode is invalid, with a tip about do', () => {
    const r = runIos('show vlan brief', baseTopology(), 'TOR-01', CONFIG, 1);
    expect(r.lines[1]).toContain('% Invalid input');
    expect(strip(r.lines[2])).toContain('do show');
  });

  it('privileged commands are invalid at the > prompt, with a tip about enable', () => {
    const r = runIos('conf t', baseTopology(), 'TOR-01', { level: 'user' }, 1);
    expect(r.lines[1]).toContain('% Invalid input');
    expect(strip(r.lines[2])).toContain('enable');
    expect(runIos('sh run', baseTopology(), 'TOR-01', { level: 'user' }, 1).canonical).toBeNull();
  });
});

describe('modes, prompts, exit/end', () => {
  it('walks the prompt chain and back', () => {
    const w = baseTopology();
    const seen: string[] = [];
    let m: IosMode | null = { level: 'user' };
    const steps = ['enable', 'configure terminal', 'interface gi1/0/9', 'exit', 'vlan 30', 'exit', 'interface vlan 30', 'end', 'disable', 'exit'];
    seen.push(iosPrompt(w, 'TOR-01', m));
    for (const l of steps) {
      m = runIos(l, w, 'TOR-01', m!, 1).mode;
      seen.push(m ? iosPrompt(w, 'TOR-01', m) : '(left)');
    }
    expect(seen).toEqual([
      'TOR-01>',
      'TOR-01#',
      'TOR-01(config)#',
      'TOR-01(config-if)#',
      'TOR-01(config)#',
      'TOR-01(config-vlan)#',
      'TOR-01(config)#',
      'TOR-01(config-if)#',
      'TOR-01#',
      'TOR-01>',
      '(left)',
    ]);
  });

  it('end (Ctrl+Z) returns to exec from any config level and is harmless at exec', () => {
    for (const m of [CONFIG, ifMode('Gi1/0/1'), { level: 'config-vlan', vlan: 10 } as IosMode]) {
      expect(runIos('end', baseTopology(), 'TOR-01', m, 1).mode).toEqual({ level: 'exec' });
    }
    const r = runIos('end', baseTopology(), 'TOR-01', EXEC, 1);
    expect(r.mode).toEqual(EXEC);
    expect(r.lines).toEqual([]);
  });

  it('exit / logout at exec or user leaves the device', () => {
    expect(runIos('exit', baseTopology(), 'TOR-01', EXEC, 1).mode).toBeNull();
    expect(runIos('logout', baseTopology(), 'TOR-01', { level: 'user' }, 1).mode).toBeNull();
    const out = runCommand('exit', baseTopology(), 'TOR-01', 1, EXEC);
    expect(out.host).toBe('ops');
    expect(out.mode).toBeNull();
  });

  it('do runs exec commands in config modes', () => {
    const r = runIos('do sh vlan br', baseTopology(), 'TOR-01', ifMode('Gi1/0/1'), 1);
    expect(r.canonical).toBe('do show vlan brief');
    expect(text(r)).toContain('VLAN Name');
    expect(r.events).toContain('ios:TOR-01:show vlan brief');
    expect(r.mode).toEqual(ifMode('Gi1/0/1'));
  });

  it('a line that fails in config-if is retried at config level (and leaves config-if)', () => {
    const w = baseTopology();
    const r = runIos('interface gi1/0/2', w, 'TOR-01', ifMode('Gi1/0/1'), 1);
    expect(r.mode).toEqual(ifMode('Gi1/0/2'));
    const r2 = runIos('vlan 30', w, 'TOR-01', ifMode('Gi1/0/1'), 1);
    expect(r2.mode?.level).toBe('config-vlan');
    expect(w.devices['TOR-01'].nd!.vlans[30]).toBe('VLAN0030');
    const r3 = runIos('no spanning-tree vlan 10', w, 'TOR-01', ifMode('Gi1/0/1'), 1);
    expect(r3.mode?.level).toBe('config');
    expect(w.devices['TOR-01'].nd!.stpOff).toEqual([10]);
  });

  it('logs %SYS-5-CONFIG_I when leaving config mode after a change, not without one', () => {
    const w = baseTopology();
    const nd = w.devices['TOR-01'].nd!;
    type(w, 'TOR-01', ['enable', 'conf t', 'end']);
    expect(nd.log.filter((e) => e.tag === 'SYS-5-CONFIG_I')).toHaveLength(0);
    expect(nd.dirty).toBe(false);
    type(w, 'TOR-01', ['enable', 'conf t', 'int gi1/0/9', 'description spare', 'exit', 'exit']);
    expect(nd.log.filter((e) => e.tag === 'SYS-5-CONFIG_I')).toHaveLength(1);
    expect(nd.log.at(-1)!.msg).toContain('Configured from console by admin on vty0');
    expect(nd.dirty).toBe(true);
  });
});

describe('? and Tab', () => {
  it('"foo?" lists keywords starting with foo', () => {
    const w = baseTopology();
    expect(iosHelp(w, 'TOR-01', EXEC, 's').map(strip)).toEqual(['send  setup  show  ssh  start-chat  systat']);
    expect(iosHelp(w, 'TOR-01', EXEC, 'show int').map(strip)).toEqual(['interfaces']);
    expect(iosHelp(w, 'TOR-01', ifMode('Gi1/0/1'), 'sw').map(strip)).toEqual(['switchport']);
    expect(iosHelp(w, 'TOR-01', EXEC, 'xyz')[0]).toContain('% Unrecognized command');
  });

  it('"foo ?" lists what can follow, with help and Korean gloss, and <cr> when runnable', () => {
    const w = baseTopology();
    const show = iosHelp(w, 'TOR-01', EXEC, 'show ').map(strip);
    expect(show.some((l) => /^ {2}interfaces\s+Interface status and configuration\s+포트/.test(l))).toBe(true);
    expect(show).not.toContain('  <cr>');
    const vlan = iosHelp(w, 'TOR-01', EXEC, 'show vlan ').map(strip);
    expect(vlan.some((l) => l.startsWith('  brief'))).toBe(true);
    expect(vlan.at(-1)).toBe('  <cr>');
    const intf = iosHelp(w, 'TOR-01', CONFIG, 'interface ').map(strip);
    expect(intf.some((l) => l.startsWith('  GigabitEthernet'))).toBe(true);
    expect(intf.some((l) => l.startsWith('  HundredGigE'))).toBe(false); // TOR-01 has no 100G ports
    // config-if on an access port offers switchport, not standby; on an SVI the other way round
    const l2 = iosHelp(w, 'TOR-01', ifMode('Gi1/0/1'), '').map(strip).join('\n');
    expect(l2).toContain('switchport');
    expect(l2).not.toContain('standby');
    const svi = iosHelp(w, 'CORE-01', ifMode('Vlan10'), '').map(strip).join('\n');
    expect(svi).toContain('standby');
    expect(svi).not.toContain('switchport');
    // a line ending in ? typed into runIos is a help request
    expect(runIos('show vlan ?', w, 'TOR-01', EXEC, 1).lines.map(strip).at(-1)).toBe('  <cr>');
  });

  it('Tab completes a unique keyword prefix, else null', () => {
    const w = baseTopology();
    expect(iosComplete(w, 'TOR-01', EXEC, 'sh')).toBe('show ');
    expect(iosComplete(w, 'TOR-01', EXEC, 's')).toBeNull();
    expect(iosComplete(w, 'TOR-01', EXEC, 'show int')).toBe('show interfaces ');
    expect(iosComplete(w, 'TOR-01', EXEC, 'conf')).toBe('configure ');
    expect(iosComplete(w, 'TOR-01', ifMode('Gi1/0/1'), 'switchport acc')).toBe('switchport access ');
    expect(iosComplete(w, 'TOR-01', EXEC, 'show ')).toBeNull();
  });

  it('cheat sheets are mode-aware', () => {
    expect(iosCheatSheet({ level: 'user' })[0][0]).toBe('enable');
    expect(iosCheatSheet(EXEC).map(([c]) => c)).toContain('write memory');
    expect(iosCheatSheet(ifMode('Gi1/0/1')).map(([c]) => c)).toContain('switchport access vlan <N>');
    expect(iosCheatSheet(ifMode('Vlan10')).map(([c]) => c)).toContain('standby 1 ip <가상 IP>');
    for (const lvl of ['user', 'exec', 'config', 'config-if', 'config-vlan'] as IosLevel[]) {
      for (const [cmd, ko] of iosCheatSheet({ level: lvl })) expect(cmd && ko).toBeTruthy();
    }
  });
});

describe('config commands', () => {
  it('switchport access vlan moves the port, creates a missing VLAN and marks the config dirty', () => {
    const w = baseTopology();
    const nd = w.devices['TOR-01'].nd!;
    const { last } = type(w, 'TOR-01', ['sw acc vl 20'], ifMode('Gi1/0/9'));
    expect(nd.ifs['Gi1/0/9'].accessVlan).toBe(20);
    expect(nd.dirty).toBe(true);
    expect(last.lines).toEqual([]);
    const r = runIos('switchport access vlan 77', w, 'TOR-01', ifMode('Gi1/0/9'), 1);
    expect(nd.ifs['Gi1/0/9'].accessVlan).toBe(77);
    expect(nd.vlans[77]).toBe('VLAN0077');
    expect(strip(r.lines[0])).toBe('% Access VLAN does not exist. Creating vlan 77');
    expect(r.lines[0].startsWith(RED)).toBe(false); // informational, not an error
    runIos('no switchport access vlan', w, 'TOR-01', ifMode('Gi1/0/9'), 1);
    expect(nd.ifs['Gi1/0/9'].accessVlan).toBe(1);
  });

  it('vlan / name / no vlan', () => {
    const w = baseTopology();
    const nd = w.devices['TOR-02'].nd!;
    const { mode } = type(w, 'TOR-02', ['vlan 60', 'name STORAGE', 'exit'], CONFIG);
    expect(nd.vlans[60]).toBe('STORAGE');
    expect(mode).toEqual({ level: 'config', changed: true });
    runIos('no vlan 60', w, 'TOR-02', CONFIG, 1);
    expect(60 in nd.vlans).toBe(false);
  });

  it('trunk allowed vlan: set, add, remove, all', () => {
    const w = baseTopology();
    const f = w.devices['TOR-01'].nd!.ifs['Te1/1/3'];
    const m = ifMode('Te1/1/3');
    runIos('switchport trunk allowed vlan 10,20', w, 'TOR-01', m, 1);
    expect(f.allowed).toEqual([10, 20]);
    runIos('switchport trunk allowed vlan add 40-41', w, 'TOR-01', m, 1);
    expect(f.allowed).toEqual([10, 20, 40, 41]);
    runIos('switchport trunk allowed vlan remove 20', w, 'TOR-01', m, 1);
    expect(f.allowed).toEqual([10, 40, 41]);
    runIos('switchport trunk allowed vlan all', w, 'TOR-01', m, 1);
    expect(f.allowed).toBe('all');
  });

  it('shutdown / no shutdown; err-disabled needs shut then no shut', () => {
    const w = baseTopology();
    const f = w.devices['TOR-01'].nd!.ifs['Gi1/0/5'];
    runIos('shutdown', w, 'TOR-01', ifMode('Gi1/0/5'), 1);
    expect(f.shutdown).toBe(true);
    runIos('no shutdown', w, 'TOR-01', ifMode('Gi1/0/5'), 1);
    expect(f.shutdown).toBe(false);
    f.errDisabled = 'bpduguard';
    runIos('no shutdown', w, 'TOR-01', ifMode('Gi1/0/5'), 1);
    expect(f.errDisabled).toBe('bpduguard');
    runIos('shutdown', w, 'TOR-01', ifMode('Gi1/0/5'), 1);
    runIos('no shutdown', w, 'TOR-01', ifMode('Gi1/0/5'), 1);
    expect(f.errDisabled).toBeNull();
    expect(f.shutdown).toBe(false);
  });

  it('SVI: ip address, standby ip / priority / preempt, helper, no standby', () => {
    const w = baseTopology();
    const nd = w.devices['CORE-02'].nd!;
    const { results } = type(
      w,
      'CORE-02',
      ['enable', 'conf t', 'int vlan 60', 'ip address 10.10.60.3 255.255.255.0', 'standby 1 ip 10.10.60.1', 'standby 1 priority 90', 'standby 1 preempt', 'ip helper-address 10.10.50.21', 'end'],
    );
    expect(results.flatMap((r) => r.lines).filter((l) => l.startsWith(RED))).toEqual([]);
    expect(nd.svis[60]).toEqual({ ip: '10.10.60.3', mask: 24, shutdown: false, helper: '10.10.50.21', hsrp: { group: 1, vip: '10.10.60.1', priority: 90, preempt: true } });
    runIos('no standby 1 preempt', w, 'CORE-02', ifMode('Vlan60'), 1);
    expect(nd.svis[60].hsrp!.preempt).toBe(false);
    runIos('no standby 1', w, 'CORE-02', ifMode('Vlan60'), 1);
    expect(nd.svis[60].hsrp).toBeUndefined();
    // a VIP outside the SVI's subnet is refused
    const bad = runIos('standby 1 ip 10.10.70.1', w, 'CORE-02', ifMode('Vlan60'), 1);
    expect(bad.lines[0].startsWith(RED)).toBe(true);
    expect(nd.svis[60].hsrp).toBeUndefined();
  });

  it('ip address is refused on L2 ports and on overlapping subnets; bad masks are rejected', () => {
    const w = baseTopology();
    expect(strip(runIos('ip address 10.1.1.1 255.255.255.0', w, 'TOR-01', ifMode('Gi1/0/9'), 1).lines[0])).toBe('% IP addresses may not be configured on L2 links.');
    expect(strip(runIos('ip address 10.10.20.9 255.255.255.0', w, 'CORE-01', ifMode('Vlan10'), 1).lines[0])).toContain('overlaps with Vlan20');
    expect(strip(runIos('ip address 10.10.10.2 255.0.255.0', w, 'CORE-01', ifMode('Vlan10'), 1).lines[0])).toContain('Bad mask');
  });

  it('channel-group creates the port-channel with the member settings; new members take the bundle settings', () => {
    const w = baseTopology();
    const nd = w.devices['TOR-02'].nd!;
    const r = runIos('channel-group 2 mode active', w, 'TOR-02', ifMode('Te1/1/1'), 1);
    expect(text(r)).toBe('Creating a port-channel interface Port-channel 2');
    expect(nd.ifs.Po2).toMatchObject({ mode: 'trunk', allowed: [40, 50, 100], speed: 10000, shutdown: false });
    expect(nd.ifs['Te1/1/1']).toMatchObject({ group: 2, chMode: 'active' });
    nd.ifs['Te1/1/4'].allowed = [40];
    runIos('channel-group 2 mode active', w, 'TOR-02', ifMode('Te1/1/4'), 1);
    expect(nd.ifs['Te1/1/4']).toMatchObject({ group: 2, allowed: [40, 50, 100] });
    runIos('no channel-group', w, 'TOR-02', ifMode('Te1/1/4'), 1);
    expect(nd.ifs['Te1/1/4'].group).toBeUndefined();
    // switchport changes on the Po reach its members
    runIos('switchport trunk allowed vlan add 10', w, 'TOR-02', ifMode('Po2'), 1);
    expect(nd.ifs['Te1/1/1'].allowed).toEqual([10, 40, 50, 100]);
  });

  it('spanning-tree vlan on/off and bpduguard', () => {
    const w = baseTopology();
    const nd = w.devices['CORE-01'].nd!;
    runIos('no spanning-tree vlan 10,20', w, 'CORE-01', CONFIG, 1);
    expect(nd.stpOff).toEqual([10, 20]);
    runIos('spanning-tree vlan 10', w, 'CORE-01', CONFIG, 1);
    expect(nd.stpOff).toEqual([20]);
    const t = w.devices['TOR-01'].nd!;
    runIos('no spanning-tree bpduguard', w, 'TOR-01', ifMode('Gi1/0/1'), 1);
    expect(t.ifs['Gi1/0/1'].bpduguard).toBe(false);
    runIos('spanning-tree bpduguard enable', w, 'TOR-01', ifMode('Gi1/0/1'), 1);
    expect(t.ifs['Gi1/0/1'].bpduguard).toBe(true);
  });

  it('hostname is not supported', () => {
    expect(runIos('hostname X', baseTopology(), 'TOR-01', CONFIG, 1).lines[1]).toContain('% Invalid input');
  });
});

describe('saving the config', () => {
  it.each(['wr', 'write memory', 'write', 'copy run start', 'copy running-config startup-config'])('%s saves', (line) => {
    const w = baseTopology();
    const nd = w.devices['TOR-01'].nd!;
    runIos('description x', w, 'TOR-01', ifMode('Gi1/0/9'), 1);
    expect(nd.dirty).toBe(true);
    const before = nd.startup;
    const r = runIos(line, w, 'TOR-01', EXEC, 1);
    expect(r.lines).toContain('[OK]');
    expect(nd.dirty).toBe(false);
    expect(nd.startup).not.toBe(before);
    expect(JSON.parse(nd.startup!).ifs['Gi1/0/9'].desc).toBe('x');
    expect(r.events).toContain('ios:TOR-01:write memory');
  });

  it('do wr works from config mode', () => {
    const w = baseTopology();
    w.devices['TOR-01'].nd!.dirty = true;
    runIos('do wr', w, 'TOR-01', CONFIG, 1);
    expect(w.devices['TOR-01'].nd!.dirty).toBe(false);
  });
});

describe('canonical forms and the leak-guard regex', () => {
  const cases: [string, IosLevel, string | null][] = [
    ['sh ip int br', 'exec', 'show ip interface brief'],
    ['conf t', 'exec', 'configure terminal'],
    ['conf', 'exec', 'configure terminal'],
    ['wr', 'exec', 'write memory'],
    ['int gi 1/0/5', 'config', 'interface Gi1/0/5'],
    ['sw acc vl 20', 'config-if', 'switchport access vlan 20'],
    ['stand 1 ip 10.10.10.1', 'config-if', 'standby 1 ip 10.10.10.1'],
    ['ip add 10.10.10.2 255.255.255.0', 'config-if', 'ip address 10.10.10.2 255.255.255.0'],
    ['int gi1/0/2', 'config-if', 'interface Gi1/0/2'], // config-if → config fallback
    ['do sh vlan br', 'config-vlan', 'do show vlan brief'],
    ['s', 'exec', null],
    ['show nonsense', 'exec', null],
  ];
  it.each(cases)('canonicalize(%s, %s)', (line, level, want) => {
    expect(canonicalize(line, level)).toBe(want);
  });

  it('iosScript follows the levels of a keystroke script', () => {
    const s = iosScript(['en', 'conf t', 'int gi1/0/1', 'sw acc vl 10', 'int gi1/0/2', 'vlan 30', 'name X', 'end', 'wr', 'exit']);
    expect(s.map((x) => `${x.level}: ${x.canonical}`)).toEqual([
      'user: enable',
      'exec: configure terminal',
      'config: interface Gi1/0/1',
      'config-if: switchport access vlan 10',
      'config-if: interface Gi1/0/2',
      'config-if: vlan 30',
      'config-vlan: name X',
      'config-vlan: end',
      'exec: write memory',
      'exec: exit',
    ]);
    for (const x of s) expect(`so type ${x.line}`).toMatch(iosVariantsRegex(x.canonical!, x.level));
  });

  it('matches every typed form of a line and nothing else', () => {
    const re = iosVariantsRegex('switchport access vlan 20', 'config-if');
    for (const s of ['sw acc vl 20', 'switchport access vlan 20', 'SWITCHP ACCESS VLAN 20', 'then type `sw access vlan 20` there']) expect(s).toMatch(re);
    for (const s of ['switchport access vlan 200', 'switchport access vlan 2', 'switchport mode access']) expect(s).not.toMatch(re);

    const intf = iosVariantsRegex('interface Gi1/0/5', 'config');
    for (const s of ['int gi1/0/5', 'int gi 1/0/5', 'interface GigabitEthernet1/0/5', 'i g1/0/5', 'INT GIGABITETHERNET 1/0/5']) expect(s).toMatch(intf);
    for (const s of ['int gi1/0/50', 'int gi1/0/6', 'int te1/0/5']) expect(s).not.toMatch(intf);

    const sb = iosVariantsRegex('standby 1 ip 10.10.10.1', 'config-if');
    for (const s of ['standby 1 ip 10.10.10.1', 'stan 1 ip 10.10.10.1', 'st 1 i 10.10.10.1']) expect(s).toMatch(sb);
    expect('standby 1 ip 10.10.10.10').not.toMatch(sb);

    const wr = iosVariantsRegex('write memory', 'exec');
    for (const s of ['wr', 'write', 'write memory', 'wr mem']) expect(s).toMatch(wr);
  });
});

describe('show output', () => {
  const show = (host: string, line: string) => runIos(line, baseTopology(), host, EXEC, 1);

  it('vlan brief (snapshot)', () => {
    expect(text(show('TOR-01', 'show vlan brief'))).toMatchSnapshot();
  });

  it('running-config (snapshot)', () => {
    expect(text(show('TOR-01', 'show running-config'))).toMatchSnapshot();
    expect(text(show('CORE-01', 'show running-config interface vlan 10'))).toMatchSnapshot();
  });

  it('standby brief (snapshot)', () => {
    expect(text(show('CORE-01', 'show standby brief'))).toMatchSnapshot();
  });

  it('startup-config follows write memory', () => {
    const w = baseTopology();
    runIos('description uplink', w, 'TOR-01', ifMode('Te1/1/4'), 1);
    expect(text(runIos('show startup-config', w, 'TOR-01', EXEC, 1))).not.toContain('description uplink');
    runIos('wr', w, 'TOR-01', EXEC, 1);
    expect(text(runIos('show startup-config', w, 'TOR-01', EXEC, 1))).toContain('description uplink');
  });

  it('interfaces status: one line per port, fits a screen on a 16-port TOR', () => {
    const lines = text(show('TOR-01', 'show interfaces status')).split('\n');
    expect(lines[0]).toMatch(/^Port\s+Name\s+Status\s+Vlan\s+Duplex\s+Speed Type$/);
    expect(lines.length).toBeLessThanOrEqual(20);
    expect(lines.find((l) => l.startsWith('Gi1/0/1 '))).toMatch(/Gi1\/0\/1\s+WEB-01\s+connected\s+10\s/);
    expect(lines.find((l) => l.startsWith('Te1/1/4 '))).toContain('disabled');
    expect(lines.find((l) => l.startsWith('Te1/1/1 '))).toContain('trunk');
    for (const l of show('TOR-01', 'show interfaces status').lines) expect(l.startsWith(RED)).toBe(false);
  });

  it('err-disabled and inactive VLANs show in interfaces status', () => {
    const w = baseTopology();
    w.devices['TOR-01'].nd!.ifs['Gi1/0/5'].errDisabled = 'bpduguard';
    w.devices['TOR-01'].nd!.ifs['Gi1/0/1'].accessVlan = 99;
    const lines = text(runIos('sh int status', w, 'TOR-01', EXEC, 1)).split('\n');
    expect(lines.find((l) => l.startsWith('Gi1/0/5 '))).toContain('err-disabled');
    expect(lines.find((l) => l.startsWith('Gi1/0/1 '))).toContain('inactive');
    expect(text(runIos('sh int gi1/0/5', w, 'TOR-01', EXEC, 1))).toContain('GigabitEthernet1/0/5 is down, line protocol is down (err-disabled)');
  });

  it('ip interface brief, interfaces, counters errors', () => {
    const brief = text(show('CORE-01', 'show ip interface brief')).split('\n');
    expect(brief[0]).toMatch(/^Interface\s+IP-Address\s+OK\? Method Status\s+Protocol$/);
    expect(brief.find((l) => l.startsWith('Vlan10 '))).toMatch(/10\.10\.10\.2\s+YES manual/);
    expect(brief.find((l) => l.startsWith('TenGigabitEthernet1/0/5 '))).toContain('administratively down');
    const one = text(show('TOR-01', 'show interfaces gi1/0/1')).split('\n');
    expect(one[0]).toBe('GigabitEthernet1/0/1 is up, line protocol is up (connected)');
    expect(one.join('\n')).toMatch(/txload \d+\/255/);
    expect(one.join('\n')).toMatch(/\d+ input errors, \d+ CRC/);
    const w = baseTopology();
    w.devices['TOR-01'].nd!.ifs['Gi1/0/3'].crc = 1234;
    const errs = text(runIos('show interfaces counters errors', w, 'TOR-01', EXEC, 1)).split('\n');
    expect(errs[0]).toMatch(/^Port\s+Align-Err\s+FCS-Err/);
    expect(errs.find((l) => l.startsWith('Gi1/0/3 '))).toMatch(/1234\s+0\s+1234/);
    runIos('clear counters', w, 'TOR-01', EXEC, 1);
    expect(w.devices['TOR-01'].nd!.ifs['Gi1/0/3'].crc).toBe(0);
  });

  it('etherchannel summary and spanning-tree have the IOS layout', () => {
    const ec = text(show('TOR-01', 'show etherchannel summary'));
    expect(ec).toContain('Number of channel-groups in use: 1');
    expect(ec).toMatch(/^1\s+Po1\(S[UD]\)\s+LACP\s+Te1\/1\/1\([PDsI]\)\s+Te1\/1\/2\([PDsI]\)$/m);
    const st = text(show('CORE-01', 'show spanning-tree vlan 10'));
    expect(st).toContain('VLAN0010');
    expect(st).toMatch(/Root ID\s+Priority/);
    expect(st).toMatch(/Bridge ID\s+Priority\s+4106\s+\(priority 4096 sys-id-ext 10\)/);
    expect(st).toMatch(/^Interface\s+Role Sts Cost/m);
    const w = baseTopology();
    w.devices['CORE-01'].nd!.stpOff = [10];
    expect(text(runIos('sh span vlan 10', w, 'CORE-01', EXEC, 1))).toBe('Spanning tree instance(s) for vlan 10 does not exist.');
  });

  it('logging shows syslog lines with the day clock', () => {
    const w = baseTopology();
    w.devices['TOR-01'].nd!.log.push({ t: 60, tag: 'LINK-3-UPDOWN', msg: 'Interface GigabitEthernet1/0/5, changed state to down' });
    const out = text(runIos('show logging', w, 'TOR-01', EXEC, 1));
    // D-4 (day 1) starts at 09:00 and runs 30 game seconds per real second
    expect(out).toMatch(/\*\w{3} +\d+ 09:30:00: %LINK-3-UPDOWN: Interface GigabitEthernet1\/0\/5, changed state to down$/m);
  });

  it('ping uses IOS ! / . marks', () => {
    const out = text(show('CORE-01', 'ping 10.10.10.11'));
    expect(out).toContain('Sending 5, 100-byte ICMP Echos to 10.10.10.11, timeout is 2 seconds:');
    expect(out).toMatch(/^[!.]{5}$/m);
    expect(out).toMatch(/Success rate is \d+ percent \(\d\/5\)/);
  });

  it('no show output line starts in red (only % errors do)', () => {
    const w = baseTopology();
    w.devices['TOR-01'].nd!.ifs['Gi1/0/5'].errDisabled = 'bpduguard';
    for (const l of ['sh int status', 'sh ip int br', 'sh int', 'sh vlan br', 'sh eth sum', 'sh span', 'sh log', 'sh run', 'sh int count err']) {
      for (const line of runIos(l, w, 'TOR-01', EXEC, 1).lines) expect(line.startsWith(RED)).toBe(false);
    }
  });
});

describe('tier 2', () => {
  it('interface range configures several ports at once', () => {
    const w = baseTopology();
    const nd = w.devices['TOR-01'].nd!;
    const r = runIos('int range gi1/0/9 - 11 , gi 1/0/12', w, 'TOR-01', CONFIG, 1);
    expect(r.canonical).toBe('interface range Gi1/0/9 - 11 , Gi1/0/12');
    expect(r.mode).toEqual({ level: 'config-if', ifs: ['Gi1/0/9', 'Gi1/0/10', 'Gi1/0/11', 'Gi1/0/12'] });
    runIos('switchport access vlan 50', w, 'TOR-01', r.mode!, 1);
    expect(['Gi1/0/9', 'Gi1/0/10', 'Gi1/0/11', 'Gi1/0/12'].map((k) => nd.ifs[k].accessVlan)).toEqual([50, 50, 50, 50]);
    expect(runIos('int range gi1/0/9 - 40', w, 'TOR-01', CONFIG, 1).canonical).toBeNull();
  });

  it('show interfaces trunk lists trunks and their VLANs', () => {
    const w = baseTopology();
    w.devices['TOR-02'].nd!.ifs['Te1/1/3'].allowed = [40, 50];
    const out = text(runIos('sh int trunk', w, 'TOR-02', EXEC, 1));
    expect(out).toMatch(/^Port\s+Mode\s+Encapsulation\s+Status\s+Native vlan$/m);
    expect(out).toMatch(/^Te1\/1\/3\s+on\s+802\.1q\s+trunking\s+1$/m);
    expect(out).toMatch(/Vlans allowed on trunk\n(.*\n)*Te1\/1\/3\s+40,50$/m);
  });

  it('show cdp neighbors lists the network gear on each port', () => {
    const out = text(runIos('show cdp neighbors', baseTopology(), 'TOR-01', EXEC, 1));
    expect(out).toMatch(/^CORE-01\s+Ten 1\/1\/1\s+\d+\s+R S I\s+KHU-SW950\s+Ten 1\/0\/3$/m);
    expect(out).toMatch(/^CORE-02\s+Ten 1\/1\/3/m);
    expect(out).not.toContain('WEB-01'); // servers don't speak CDP
  });

  it('show … | include / exclude / begin / section', () => {
    const w = baseTopology();
    const inc = runIos('sh run | i access vlan 20', w, 'TOR-01', EXEC, 1);
    expect(inc.canonical).toBe('show running-config');
    expect(inc.lines).toEqual([' switchport access vlan 20', ' switchport access vlan 20']);
    expect(text(runIos('sh int status | exc notconnect', w, 'TOR-01', EXEC, 1))).not.toContain('notconnect');
    expect(runIos('sh run | begin interface Vlan', w, 'CORE-01', EXEC, 1).lines[0]).toBe('interface Vlan10');
    expect(runIos('sh run | section interface Vlan10$', w, 'CORE-01', EXEC, 1).lines).toEqual([
      'interface Vlan10',
      ' ip address 10.10.10.2 255.255.255.0',
      ' standby 1 ip 10.10.10.1',
      ' standby 1 priority 110',
      ' standby 1 preempt',
    ]);
    expect(runIos('sh run | foo bar', w, 'TOR-01', EXEC, 1).lines[1]).toContain('% Invalid input');
    // not a pipe outside show: a description may contain '|'
    runIos('description web | db', w, 'TOR-01', ifMode('Gi1/0/9'), 1);
    expect(w.devices['TOR-01'].nd!.ifs['Gi1/0/9'].desc).toBe('web | db');
  });

  it('Tab in config-if completes config-level words too', () => {
    expect(iosComplete(baseTopology(), 'TOR-01', ifMode('Gi1/0/1'), 'inter')).toBe('interface ');
  });
});

describe('solution scripts (as content writes them) run clean through the command layer', () => {
  /** Thread a keystroke script like tests/autoplay.ts does; collect red lines. */
  function play(w: World, host: string, lines: string[]) {
    let mode: IosMode | null = { level: 'user' };
    const red: string[] = [];
    for (const l of lines) {
      const out = runCommand(l, w, host, 5, mode);
      red.push(...out.lines.filter((x) => x.startsWith(RED)).map((x) => `${l} → ${strip(x)}`));
      w = out.world;
      mode = out.mode ?? null;
    }
    return { w, red, mode };
  }

  it('VLAN + access port', () => {
    const w0 = baseTopology();
    delete w0.devices['TOR-01'].nd!.vlans[10];
    w0.devices['TOR-01'].nd!.ifs['Gi1/0/1'].accessVlan = 1;
    const { w, red, mode } = play(w0, 'TOR-01', ['enable', 'configure terminal', 'vlan 10', 'name WEB', 'exit', 'interface gi1/0/1', 'switchport mode access', 'switchport access vlan 10', 'end', 'write memory']);
    expect(red).toEqual([]);
    expect(mode).toEqual({ level: 'exec' });
    const nd = w.devices['TOR-01'].nd!;
    expect([nd.vlans[10], nd.ifs['Gi1/0/1'].accessVlan, nd.dirty]).toEqual(['WEB', 10, false]);
    expect(nd.log.some((e) => e.tag === 'SYS-5-CONFIG_I')).toBe(true);
  });

  it('SVI gateway with HSRP and DHCP relay', () => {
    const w0 = baseTopology();
    delete w0.devices['CORE-02'].nd!.svis[10];
    const { w, red } = play(w0, 'CORE-02', [
      'enable',
      'configure terminal',
      'interface vlan 10',
      'ip address 10.10.10.3 255.255.255.0',
      'standby 1 ip 10.10.10.1',
      'standby 1 priority 100',
      'standby 1 preempt',
      'ip helper-address 10.10.50.21',
      'no shutdown',
      'end',
      'write memory',
    ]);
    expect(red).toEqual([]);
    expect(w.devices['CORE-02'].nd!.svis[10]).toMatchObject({ ip: '10.10.10.3', mask: 24, shutdown: false, helper: '10.10.50.21', hsrp: { group: 1, vip: '10.10.10.1', priority: 100, preempt: true } });
  });

  it('LACP member on both ends, err-disabled recovery, STP back on', () => {
    const w0 = baseTopology();
    delete w0.devices['TOR-01'].nd!.ifs['Te1/1/2'].group;
    delete w0.devices['CORE-01'].nd!.ifs['Te1/0/4'].group;
    w0.devices['TOR-01'].nd!.ifs['Gi1/0/5'].errDisabled = 'bpduguard';
    w0.devices['TOR-01'].nd!.stpOff = [10];
    let { w, red } = play(w0, 'TOR-01', ['en', 'conf t', 'int te1/1/2', 'channel-group 1 mode active', 'int gi1/0/5', 'shutdown', 'no shutdown', 'exit', 'spanning-tree vlan 10', 'end', 'wr']);
    expect(red).toEqual([]);
    ({ w, red } = play(w, 'CORE-01', ['en', 'conf t', 'int te1/0/4', 'channel-group 1 mode active', 'end', 'wr']));
    expect(red).toEqual([]);
    const tor = w.devices['TOR-01'].nd!;
    expect([tor.ifs['Te1/1/2'].group, tor.ifs['Gi1/0/5'].errDisabled, tor.stpOff, w.devices['CORE-01'].nd!.ifs['Te1/0/4'].group]).toEqual([1, null, [], 1]);
  });
});

describe('command layer integration', () => {
  it('routes IOS hosts to runIos with the mode, returns the new mode', () => {
    const out = runCommand('en', baseTopology(), 'CORE-01', 1, { level: 'user' });
    expect(out.mode).toEqual(EXEC);
    expect(out.events).toContain('ios:CORE-01:enable');
    const cfg = runCommand('sw acc vl 20', baseTopology(), 'TOR-01', 1, ifMode('Gi1/0/9'));
    expect(cfg.world.devices['TOR-01'].nd!.ifs['Gi1/0/9'].accessVlan).toBe(20);
  });
});

describe('no real product names on screen (only concept cards may name them)', () => {
  const PRODUCTS = /\b(?:cisco|catalyst|nexus|f5|big-?ip|genian|ios[- ]?xe|nx-?os)\b/i;

  it('interface ? and show version', () => {
    const w = baseTopology();
    const intf = iosHelp(w, 'CORE-01', CONFIG, 'interface ').map(strip);
    expect(intf.some((l) => /^ {2}Vlan\s+VLAN interface \(SVI\)/.test(l))).toBe(true);
    const shown = [...intf, ...type(w, 'CORE-01', ['enable', 'show version']).last.lines.map(strip)].join('\n');
    expect(shown).not.toMatch(PRODUCTS);
  });

  it('no string in src outside concepts.ts names one (comments aside)', () => {
    const files = readdirSync('src', { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.(?:tsx?|md|css|json)$/.test(f) && !f.endsWith('concepts.ts'))
      .map((f) => join('src', f));
    expect(files.length).toBeGreaterThan(20);
    const hits = files.flatMap((f) => {
      const code = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      return code.split('\n').flatMap((l, i) => (PRODUCTS.test(l) ? [`${f}:${i + 1}: ${l.trim()}`] : []));
    });
    expect(hits).toEqual([]);
  });
});
