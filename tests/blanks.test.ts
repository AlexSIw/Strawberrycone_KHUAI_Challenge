import { describe, expect, it } from 'vitest';
import { blankIos, blankShell, fixShapes } from '../src/ai/blanks';
import { bannedFor, iosScript, iosLineBanned, leaks } from '../src/ai/leak';
import { allInstances, instance } from '../src/content/incidents';

const shape = (id: string) => fixShapes(instance(id)).map((f) => `${f.hosts.join('·')}: ${f.lines.join(' → ')}`);

describe('blank command shapes', () => {
  it('IOS lines keep their keywords in full and lose every value', () => {
    expect(blankIos('sw acc vl 20', 'config-if')).toBe('switchport access vlan <번호>');
    expect(blankIos('int gi1/0/3', 'config')).toBe('interface <포트>');
    expect(blankIos('interface vlan 10', 'config')).toBe('interface vlan <번호>');
    expect(blankIos('interface range te1/1/1 - 2', 'config')).toBe('interface range <포트 범위>');
    expect(blankIos('channel-group 1 mode active', 'config-if')).toBe('channel-group <번호> mode active');
    expect(blankIos('no shut', 'config-if')).toBe('no shutdown');
    expect(blankIos('show vlan brief', 'exec')).toBe('show vlan brief');
  });

  it('shell commands keep their words and flags, values become the usage labels', () => {
    expect(blankShell('dhcp leases clear lib-wifi')).toBe('dhcp leases clear <풀>');
    expect(blankShell('dhcp pool set lib-wifi range 10.20.31.100 10.20.31.230')).toBe('dhcp pool set <풀> range <시작 IP> <끝 IP>');
    expect(blankShell('dns add db 10.10.20.11')).toBe('dns add <이름> <IP>');
    expect(blankShell('lb health set port 80')).toBe('lb health set port <포트>');
    expect(blankShell('docker run -p 3306:3306 -v dbdata:/var/lib/mysql --name db mysql:8')).toBe(
      'docker run -p <바깥포트>:<안쪽포트> -v <볼륨>:<폴더> --name <이름> <이미지>',
    );
    expect(blankShell('kubectl drain n1')).toBe('kubectl drain <노드>');
    expect(blankShell('env set enroll DB_POOL=10')).toBe('env set <앱> DB_POOL=<값>');
    expect(blankShell('scale enroll 16')).toBe('scale <앱> <개수>');
    expect(blankShell('fw deny 192.0.2.0/24')).toBe('fw deny <주소/길이>');
  });

  it('a fix becomes per-host shapes, navigation left out and repeats folded', () => {
    expect(shape('d4-vlan:0')).toEqual(['TOR-01: interface <포트> → switchport access vlan <번호>']);
    expect(shape('d4-svi:0')).toEqual(['CORE-01: interface vlan <번호> → no shutdown']);
    expect(shape('d2-uplink:0')).toEqual(['TOR-01·CORE-01: interface range <포트 범위> → channel-group <번호> mode active']);
    expect(shape('dday-uplink:0')).toEqual(['TOR-02·CORE-01: interface <포트> → channel-group <번호> mode active → no shutdown']);
    expect(shape('d1-heat:0')).toEqual(['ops: kubectl drain <노드>']);
    expect(shape('d4-dns:1')).toEqual(['ns1: dns del <이름> → dns add <이름> <IP>']);
    // A mini-game or NOC button has no command.
    expect(shape('d5-crc:0')).toEqual([]);
  });

  it('every command fix of every incident has a shape with no value left in it', () => {
    for (const sc of allInstances()) {
      const typed = sc.solutionSteps.some((s) => 'cmd' in s || 'ios' in s);
      const shapes = fixShapes(sc);
      expect(shapes.length > 0, sc.id).toBe(typed);
      for (const line of shapes.flatMap((f) => f.lines)) {
        expect(line, sc.id).not.toMatch(/\d/);
        expect(line, sc.id).not.toMatch(/[a-z][\w-]*:\S/i);
      }
    }
  });

  it('the guard lets every shape (and the hosts it is typed on) through, and still catches the real fix', () => {
    for (const sc of allInstances()) {
      const banned = bannedFor(sc);
      for (const f of fixShapes(sc)) {
        const said = `${f.hosts.join('·')}에서 ${f.lines.join(' → ')}`;
        expect(leaks(said, banned), `${sc.id}: ${said}`).toBe(false);
      }
      for (const step of sc.solutionSteps) {
        if ('cmd' in step && step.cmd.includes(' ')) expect(leaks(step.cmd, banned), `${sc.id}: ${step.cmd}`).toBe(true);
        if ('ios' in step) {
          for (const l of iosScript(step.ios).filter(iosLineBanned)) {
            expect(leaks(l.line, banned), `${sc.id}: ${l.line}`).toBe(true);
            expect(leaks(l.canonical, banned), `${sc.id}: ${l.canonical}`).toBe(true);
          }
        }
      }
    }
  });
});
