// Appliance CLIs: dhcp (dhcp01), lb (L4-01/02), fw (FW-01/02). They change the right fields and
// refuse on the wrong host or day.
import { describe, expect, it } from 'vitest';
import { baseTopology } from '../src/content/topology';
import { runCommand } from '../src/sim/commands';
import { dhcpView, fwAllows } from '../src/sim/net/services';
import type { StageId, World } from '../src/sim/types';

const RED = '\x1b[31m';
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

function run(w: World, host: string, line: string, day: StageId = 5) {
  const r = runCommand(line, w, host, day);
  return { ...r, text: r.lines.map(strip).join('\n'), failed: r.lines.some((l) => l.startsWith(RED)) };
}

describe('dhcp on dhcp01', () => {
  it('lists pools with usage and starving clients', () => {
    const w = baseTopology();
    w.net!.dhcp.pools['lib-wifi'].stale = 30;
    const r = run(w, 'dhcp01', 'dhcp pool list');
    expect(r.failed).toBe(false);
    expect(r.text).toMatch(/^POOL\s+LABEL\s+NETWORK\s+RANGE\s+SIZE\s+USED\s+FREE\s+STALE\s+STARVING$/m);
    expect(r.text).toMatch(/^lib-wifi\s+중앙도서관 무선\s+10\.20\.31\.0\/24\s+\.100-\.199\s+100\s+100\s+0\s+30\s+15$/m);
    expect(run(w, 'dhcp01', 'dhcp pool show lib-wifi').text).toContain('10.20.31.100 - 10.20.31.199');
    expect(run(w, 'dhcp01', 'dhcp leases lib-wifi').text).toContain('expired');
  });

  it('pool set range widens the scope', () => {
    const w = baseTopology();
    const r = run(w, 'dhcp01', 'dhcp pool set lib-wifi range 10.20.31.50 10.20.31.250');
    expect(r.failed).toBe(false);
    const p = r.world.net!.dhcp.pools['lib-wifi'];
    expect([p.start, p.end]).toEqual([50, 250]);
    expect(dhcpView(r.world, 'lib-wifi').starving).toBe(0);
    expect(r.events).toContain('dhcp:range:lib-wifi');
  });

  it.each([
    ['outside the subnet', 'dhcp pool set lib-wifi range 10.20.32.10 10.20.32.20'],
    ['reversed', 'dhcp pool set lib-wifi range 10.20.31.200 10.20.31.100'],
    ['network address', 'dhcp pool set lib-wifi range 10.20.31.0 10.20.31.100'],
    ['over the gateway', 'dhcp pool set lib-wifi range 10.20.31.1 10.20.31.200'],
    ['over a fixed host', 'dhcp pool set noc range 10.10.100.5 10.10.100.250'],
    ['unknown pool', 'dhcp pool set nope range 10.20.31.10 10.20.31.20'],
    ['missing words', 'dhcp pool set lib-wifi 10.20.31.10 10.20.31.20'],
  ])('pool set refuses a range %s', (_why, line) => {
    const w = baseTopology();
    const r = run(w, 'dhcp01', line);
    expect(r.failed).toBe(true);
    expect(r.world.net!.dhcp.pools).toEqual(w.net!.dhcp.pools);
  });

  it('leases clear reclaims stale leases', () => {
    const w = baseTopology();
    w.net!.dhcp.pools['lib-wifi'].stale = 30;
    const r = run(w, 'dhcp01', 'dhcp leases clear lib-wifi');
    expect(r.world.net!.dhcp.pools['lib-wifi'].stale).toBe(0);
    expect(dhcpView(r.world, 'lib-wifi').starving).toBe(0);
  });

  it('refuses on any other host and points to dhcp01', () => {
    const w = baseTopology();
    for (const host of ['ops', 'ns1', 'web']) {
      const r = run(w, host, 'dhcp pool set lib-wifi range 10.20.31.50 10.20.31.250');
      expect(r.failed).toBe(true);
      expect(r.text).toContain('dhcp01');
      expect(r.world.net!.dhcp.pools['lib-wifi'].start).toBe(100);
    }
  });

  it('opens on D-4', () => {
    expect(run(baseTopology(), 'dhcp01', 'dhcp pool list', 0).failed).toBe(true);
    expect(run(baseTopology(), 'dhcp01', 'dhcp pool list', 1).failed).toBe(false);
  });
});

describe('lb on L4-01 / L4-02', () => {
  it('status, pool and health print their tables', () => {
    const w = baseTopology();
    expect(run(w, 'L4-01', 'lb status').text).toMatch(/VIP\s+10\.10\.30\.100:80/);
    expect(run(w, 'L4-02', 'lb pool').text).toMatch(/^n1\s+n1\s+10\.10\.40\.11\s+30080\s+enabled/m);
    expect(run(w, 'L4-01', 'lb health').text).toMatch(/path\s+\/health/);
  });

  it('health set path / port change the check', () => {
    let w = baseTopology();
    w = run(w, 'L4-01', 'lb health set path /healthz').world;
    w = run(w, 'L4-02', 'lb health set port 8080').world;
    expect(w.net!.lb!.health).toMatchObject({ path: '/healthz', port: 8080 });
    const bad = run(w, 'L4-01', 'lb health set path healthz');
    expect(bad.failed).toBe(true);
  });

  it('pool add / del / disable / enable', () => {
    let w = baseTopology();
    w = run(w, 'L4-01', 'lb pool disable n2').world;
    expect(w.net!.lb!.members.find((m) => m.host === 'n2')!.enabled).toBe(false);
    w = run(w, 'L4-01', 'lb pool enable K8S-02').world; // by label too
    expect(w.net!.lb!.members.find((m) => m.host === 'n2')!.enabled).toBe(true);
    w = run(w, 'L4-01', 'lb pool del n4').world;
    expect(w.net!.lb!.members.map((m) => m.host)).toEqual(['n1', 'n2', 'n3']);
    w = run(w, 'L4-01', 'lb pool add n4 30080').world;
    expect(w.net!.lb!.members.at(-1)).toEqual({ name: 'n4', host: 'n4', port: 30080, enabled: true });
    expect(run(w, 'L4-01', 'lb pool add n4 30080').failed).toBe(true);
    expect(run(w, 'L4-01', 'lb pool add nobody 80').failed).toBe(true);
  });

  it('refuses on other hosts and before D-3', () => {
    const w = baseTopology();
    const r = run(w, 'ops', 'lb pool disable n2');
    expect(r.failed).toBe(true);
    expect(r.text).toContain('L4');
    expect(run(w, 'FW-01', 'lb status').failed).toBe(true);
    expect(run(w, 'L4-01', 'lb status', 1).failed).toBe(true);
    expect(run(w, 'L4-01', 'lb status', 2).failed).toBe(false);
  });
});

describe('fw on FW-01 / FW-02', () => {
  const withBot = () => {
    const w = baseTopology();
    w.traffic.sources = [{ id: 'bot', label: '매크로', cidr: '198.51.100.77/32', rps: 900, kind: 'macro' }];
    return w;
  };

  it('top lists talkers by rate per address, the bot first', () => {
    const r = run(withBot(), 'FW-01', 'fw top');
    const rows = r.text.split('\n');
    expect(rows[0]).toMatch(/^SOURCE\s+WHO\s+ADDRS\s+RPS\s+RPS\/ADDR\s+FW$/);
    expect(rows[1]).toMatch(/^198\.51\.100\.77\/32\s+매크로\s+1\s+900\s+900\s+allowed$/);
    expect(rows.filter((l) => l.includes('학생')).length).toBeGreaterThan(0);
  });

  it('deny adds a rule at the front (shared by both units); del removes it', () => {
    let w = withBot();
    w = run(w, 'FW-01', 'fw permit 10.0.0.0/8').world;
    const r = run(w, 'FW-02', 'fw deny 198.51.100.77');
    expect(r.failed).toBe(false);
    w = r.world;
    expect(w.net!.fw.rules[0]).toEqual({ seq: 20, action: 'deny', src: '198.51.100.77/32', dst: 'any' });
    expect(fwAllows(w, '198.51.100.77', '203.0.113.10', 80)).toBe(false);
    expect(fwAllows(w, '175.223.4.5', '203.0.113.10', 80)).toBe(true);
    expect(run(w, 'FW-01', 'fw top').text).toMatch(/198\.51\.100\.77\/32.*BLOCKED/);
    expect(run(w, 'FW-01', 'fw rules').text).toMatch(/1\s+20\s+deny\s+198\.51\.100\.77\/32/);
    w = run(w, 'FW-01', 'fw del 20').world;
    expect(w.net!.fw.rules.map((x) => x.seq)).toEqual([10]);
    expect(run(w, 'FW-01', 'fw del 99').failed).toBe(true);
  });

  it('normalises CIDRs and takes an optional port', () => {
    const w = run(baseTopology(), 'FW-01', 'fw deny 203.0.113.77/24 443').world;
    expect(w.net!.fw.rules[0]).toMatchObject({ src: '203.0.113.0/24', port: 443 });
    expect(run(baseTopology(), 'FW-01', 'fw deny 300.1.1.1').failed).toBe(true);
    expect(run(baseTopology(), 'FW-01', 'fw deny 1.2.3.4/40').failed).toBe(true);
  });

  it('refuses on other hosts; exit goes back to the admin PC', () => {
    const r = run(withBot(), 'L4-01', 'fw deny 198.51.100.77');
    expect(r.failed).toBe(true);
    expect(r.world.net!.fw.rules).toEqual([]);
    expect(run(baseTopology(), 'ops', 'fw rules').text).toContain('방화벽');
    expect(run(baseTopology(), 'FW-01', 'exit').host).toBe('ops');
    expect(run(baseTopology(), 'L4-02', 'exit').host).toBe('ops');
  });

  it('help works on the appliances and lists only their commands', () => {
    const lb = run(baseTopology(), 'L4-01', 'help').text;
    expect(lb).toContain('lb pool add');
    expect(lb).not.toContain('fw deny');
    expect(lb).not.toContain('curl');
    const fw = run(baseTopology(), 'FW-02', 'help').text;
    expect(fw).toContain('fw top');
    expect(fw).not.toContain('lb status');
  });
});
