// Appliance CLIs: dhcp (dhcp01), lb (L4-01/02), fw (FW-01/02). They change the right fields and
// refuse on the wrong host or day.
import { describe, expect, it } from 'vitest';
import { dayWorld, getStage } from '../src/content/days';
import { instance } from '../src/content/incidents';
import { botsAllowed, studentFwShare } from '../src/content/incidents/dday';
import { baseTopology } from '../src/content/topology';
import { runCommand } from '../src/sim/commands';
import { startStage } from '../src/sim/engine';
import { syncNet } from '../src/sim/net';
import { studentDelivery } from '../src/sim/net/health';
import { dhcpView, fwAllows, fwBlocksCidr, fwSplit, lbView, STUDENT_BLOCKS } from '../src/sim/net/services';
import type { FwRule, PlayContext, StageId, World } from '../src/sim/types';

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

describe('Linux and appliance outputs end with a dim Korean line that says how to read them', () => {
  const DIM = '\x1b[90m';
  const dday = () => {
    const w = baseTopology();
    syncNet(w, 0);
    return w;
  };
  /** [what world, host, line, stage, a word the gloss must explain] */
  it.each<[string, () => World, string, string, StageId, string | RegExp]>([
    ['D-1', () => startStage(4).world, 'ops', 'pods', 4, /Running.*Pending.*CrashLoopBackOff.*RESTARTS/],
    ['D-1', () => startStage(4).world, 'ops', 'kubectl get pods', 4, /AGE.*NODE.*VERSION/],
    ['D-1', () => startStage(4).world, 'ops', 'nodes', 4, /Ready.*NotReady.*SchedulingDisabled/],
    ['D-1', () => startStage(4).world, 'ops', 'nodes', 4, /RACK.*TEMP.*PODS/],
    ['D-1', () => startStage(4).world, 'ops', 'deploys', 4, /READY.*UP-TO-DATE/],
    ['D-2', () => startStage(3).world, 'srv-db', 'docker ps', 3, /PORTS 의 a->b = 서버의 a번 문 → 컨테이너 안 b번 문/],
    ['D-2', () => startStage(3).world, 'srv-db', 'docker images', 3, '태그'],
    ['D-Day', dday, 'L4-01', 'lb status', 5, /Active unit.*standby.*public.*Sessions/],
    ['D-Day', dday, 'L4-01', 'lb pool', 5, /ADMIN disabled.*HEALTH DOWN/],
    ['D-Day', dday, 'L4-01', 'lb health', 5, /expect 200 OK.*3번 연속/],
    ['D-Day', dday, 'FW-01', 'fw top', 5, /ADDRS.*allowed.*BLOCKED/],
    ['D-Day', dday, 'FW-01', 'fw rules', 5, '위에서부터'],
    ['D-Day', dday, 'dhcp01', 'dhcp pool list', 5, /NETWORK.*RANGE.*FREE/],
    ['D-Day', dday, 'dhcp01', 'dhcp pool show lib-wifi', 5, /dns.*leases.*stale/],
    ['D-Day', dday, 'ops', 'nslookup sugang', 5, /Server.*#53.*Address/],
    ['D-Day', dday, 'ops', 'traceroute db', 5, /ms 세 개/],
    ['D-Day', dday, 'ops', 'ping db', 5, /0% packet loss/],
    ['D-Day', dday, 'ops', 'curl http://sugang/enroll', 5, /200 OK.*JSON/],
    ['D-Day', dday, 'ops', 'curl http://sugang/nope', 5, /404 Not Found/],
    ['D-Day', dday, 'ops', 'curl http://sugang:8080/', 5, '연결 거부'],
  ])('%s %s: %s', (_day, make, host, line, stage, want) => {
    const r = runCommand(line, make(), host, stage);
    const gloss = r.lines.filter((l) => l.startsWith(DIM)).map(strip).join('\n');
    expect(gloss).toMatch(typeof want === 'string' ? new RegExp(want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : want);
    // The gloss follows the table: the last line is always one.
    expect(r.lines.at(-1)!.startsWith(DIM)).toBe(true);
  });
});

describe('the firewall judges a whole source range', () => {
  const rules = (...rs: [FwRule['action'], string, number?][]) => {
    const w = baseTopology();
    w.net!.fw.rules = rs.map(([action, src, port], i) => ({ seq: (i + 1) * 10, action, src, dst: 'any', ...(port ? { port } : {}) }));
    return w;
  };
  const DST = '203.0.113.10';

  it('first matching rule per address; a partial deny blocks only its share', () => {
    expect(fwBlocksCidr(rules(), '192.0.2.0/24', DST, 80)).toBe(0);
    expect(fwBlocksCidr(rules(['deny', '192.0.2.0/24']), '192.0.2.0/24', DST, 80)).toBe(1);
    expect(fwBlocksCidr(rules(['deny', '192.0.0.0/16']), '192.0.2.0/24', DST, 80)).toBe(1);
    expect(fwBlocksCidr(rules(['deny', '192.0.2.0/32']), '192.0.2.0/24', DST, 80)).toBe(1 / 256);
    expect(fwBlocksCidr(rules(['deny', '192.0.2.0/25'], ['deny', '192.0.2.128/25']), '192.0.2.0/24', DST, 80)).toBe(1);
    // A permit above the deny keeps its part open; a deny for another port doesn't apply.
    expect(fwBlocksCidr(rules(['permit', '192.0.2.128/25'], ['deny', '192.0.2.0/24']), '192.0.2.0/24', DST, 80)).toBe(0.5);
    expect(fwBlocksCidr(rules(['permit', '192.0.0.0/16'], ['deny', '192.0.2.0/24']), '192.0.2.0/24', DST, 80)).toBe(0);
    expect(fwBlocksCidr(rules(['deny', '192.0.2.0/24', 443]), '192.0.2.0/24', DST, 80)).toBe(0);
    // The sample addresses agree with the per-address verdict.
    const w = rules(['permit', '192.0.2.128/25'], ['deny', '192.0.2.0/24']);
    const s = fwSplit(w, '192.0.2.0/24', DST, 80);
    expect(fwAllows(w, s.allowIp!, DST, 80)).toBe(true);
    expect(fwAllows(w, s.denyIp!, DST, 80)).toBe(false);
  });
});

describe('D-Day macro bots and student blocks: the incident, fw top, lb status and health agree', () => {
  // dday-macro:0 = 7000 rps from 192.0.2.0/24
  const macro = instance('dday-macro:0');
  const CTX: PlayContext = { visited: [], events: [], commands: [], resolved: [], stageTime: 0, eventTimes: {} };
  const health = (w: World) => getStage(5).health(w);
  const fixed = (w: World) => macro.check(w, CTX, health(w));
  const botsWorld = () => {
    const w = dayWorld(5);
    macro.inject(w);
    return run(w, 'FW-01', 'fw rules').world;
  };
  const fw = (w: World, ...lines: string[]) => lines.reduce((x, l) => run(x, 'FW-01', l).world, w);
  const sessions = (w: World) => lbView(w).demand;
  const lb = (w: World) => w.net!.lb!;

  it('without a rule the bots are let in', () => {
    const w = botsWorld();
    expect(botsAllowed(w)).toEqual(['192.0.2.0/24']);
    expect(fixed(w)).toBe(false);
    expect(sessions(w)).toBe((w.traffic.rps + 7000) * 2);
  });

  it("a /32 deny on the network address of the bots' /24 does not clear it", () => {
    const w = fw(botsWorld(), 'fw deny 192.0.2.0/32');
    expect(fwBlocksCidr(w, '192.0.2.0/24', lb(w).publicIp, lb(w).port)).toBe(1 / 256);
    expect(botsAllowed(w)).toEqual(['192.0.2.0/24']);
    expect(fixed(w)).toBe(false);
    expect(run(w, 'FW-01', 'fw top').text).toMatch(/^192\.0\.2\.0\/24 .*PARTIAL 0\.4%$/m);
    expect(sessions(w)).toBe(Math.round((w.traffic.rps + (7000 * 255) / 256) * 2));
  });

  it.each(['192.0.2.0/24', '192.0.0.0/16'])('a deny on %s (the exact range, or one covering it) clears it', (cidr) => {
    const w = fw(botsWorld(), `fw deny ${cidr}`);
    expect(botsAllowed(w)).toEqual([]);
    expect(fixed(w)).toBe(true);
    expect(run(w, 'FW-01', 'fw top').text).toMatch(/^192\.0\.2\.0\/24 .*BLOCKED$/m);
    expect(sessions(w)).toBe(w.traffic.rps * 2);
    expect(run(w, 'L4-01', 'lb status').text).toMatch(new RegExp(`Sessions\\s+${w.traffic.rps * 2} / `));
  });

  it('students come evenly from the three blocks: denying one turns away a third', () => {
    expect(STUDENT_BLOCKS.map((b) => b.cidr)).toEqual(['175.223.0.0/16', '211.234.0.0/16', '59.10.0.0/16']);
    const w = fw(dayWorld(5), 'fw deny 175.223.0.0/16');
    expect(studentDelivery(w).ok).toBeCloseTo(2 / 3, 5);
    expect(health(w).availability).toBeCloseTo(2 / 3, 5);
    expect(studentFwShare(w)).toBeCloseTo(2 / 3, 5);
    const top = run(w, 'FW-01', 'fw top').text;
    expect(top).toMatch(/^175\.223\.0\.0\/16 .*BLOCKED$/m);
    expect(top).toMatch(/^211\.234\.0\.0\/16 .*allowed$/m);
  });

  it("a student-block deny leaves the macro incident as it was (the bots' own verdict decides it)", () => {
    let w = fw(botsWorld(), 'fw deny 175.223.0.0/16');
    expect(botsAllowed(w)).toEqual(['192.0.2.0/24']);
    expect(studentDelivery(w).ok).toBeCloseTo(2 / 3, 5);
    expect(sessions(w)).toBe(Math.round(((w.traffic.rps * 2) / 3 + 7000) * 2));
    expect(fixed(w)).toBe(false);
    // Blocking the bots too: they're out, but a student block is still shut, so it isn't fixed yet.
    w = fw(w, 'fw deny 192.0.2.0/24');
    expect(botsAllowed(w)).toEqual([]);
    expect(studentDelivery(w).ok).toBeCloseTo(2 / 3, 5);
    expect(fixed(w)).toBe(false);
    const seq = w.net!.fw.rules.find((r) => r.src === '175.223.0.0/16')!.seq;
    w = fw(w, `fw del ${seq}`);
    expect(fixed(w)).toBe(true);
  });
});
