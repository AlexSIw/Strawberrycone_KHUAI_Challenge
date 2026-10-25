// Network v2 core: L1/L2/L3 reachability, STP, HSRP, LACP, load, services and syslog, on the D-Day topology.
import { describe, expect, it } from 'vitest';
import { baseTopology } from '../src/content/topology';
import { runCommand } from '../src/sim/commands';
import {
  campusDelivery,
  dhcpView,
  hostDelivery,
  lbView,
  logicalLinks,
  operState,
  ping,
  poState,
  reach,
  resolve,
  STUDENT_IP,
  stpView,
  studentDelivery,
  syncNet,
  utilization,
} from '../src/sim/network';
import { readyPods } from '../src/sim/k8s';
import { step } from '../src/sim/step';
import type { World } from '../src/sim/types';

/** The D-Day network, synced once (so later syncs log changes). */
function world(): World {
  const w = baseTopology();
  syncNet(w, 0);
  return w;
}
const ip = (w: World, id: string) => w.devices[id].l3!.ip!;
const nd = (w: World, id: string) => w.devices[id].nd!;
const logs = (w: World, id: string) => nd(w, id).log.map((e) => `%${e.tag}: ${e.msg}`);
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const run = (w: World, line: string, host = 'ops') => {
  const r = runCommand(line, w, host, 5);
  return { ...r, text: r.lines.map(strip).join('\n') };
};

const PO1 = 'CORE-01:Po1~TOR-01:Po1';

describe('L2 / L3 reachability', () => {
  it('same VLAN: web → web2 over TOR-01 only', () => {
    const w = world();
    const r = reach(w, 'web', ip(w, 'web2'));
    expect(r.ok).toBe(true);
    expect(r.loss).toBe(0);
    expect(r.hops).toEqual(['web', 'TOR-01', 'web2']);
  });

  it('wrong access VLAN → vlan', () => {
    const w = world();
    nd(w, 'TOR-01').ifs['Gi1/0/1'].accessVlan = 20;
    syncNet(w, 0);
    expect(reach(w, 'web', ip(w, 'web2')).failure).toBe('vlan');
    expect(hostDelivery(w, 'web', 'db')).toMatchObject({ ok: 0, failure: 'vlan' });
    expect(hostDelivery(w, 'db', 'web')).toMatchObject({ ok: 0, failure: 'vlan' });
    expect(hostDelivery(w, 'web2', 'db').ok).toBe(1);
  });

  it('trunk missing the VLAN: STP reroutes over CORE-02; missing on every uplink → vlan', () => {
    const w = world();
    nd(w, 'TOR-01').ifs.Po1.allowed = [20, 40, 50];
    syncNet(w, 0);
    const r = reach(w, 'web', ip(w, 'db'));
    expect(r.ok).toBe(true);
    expect(r.links).toContain('CORE-02:Te1/0/3~TOR-01:Te1/1/3');
    expect(stpView(w, 10).blocked.has('TOR-01:Te1/1/3')).toBe(false);
    nd(w, 'TOR-01').ifs['Te1/1/3'].allowed = [20, 40, 50];
    syncNet(w, 0);
    expect(reach(w, 'web', ip(w, 'db')).failure).toBe('vlan');
    // VLAN 20 is still carried: db's own VLAN works
    expect(reach(w, 'db', ip(w, 'srv-db')).ok).toBe(true);
  });

  it('inter-VLAN routing goes through the active core’s SVIs', () => {
    const w = world();
    const r = reach(w, 'web', ip(w, 'db'));
    expect(r.ok).toBe(true);
    expect(r.hops).toEqual(['web', 'TOR-01', 'CORE-01', 'TOR-01', 'db']);
    expect(reach(w, 'ops', ip(w, 'n1')).ok).toBe(true);
  });

  it('SVI shutdown → gateway', () => {
    const w = world();
    for (const c of ['CORE-01', 'CORE-02']) nd(w, c).svis[20].shutdown = true;
    syncNet(w, 0);
    expect(reach(w, 'web', ip(w, 'db')).failure).toBe('gateway');
    expect(logs(w, 'CORE-01')).toContain('%LINK-5-CHANGED: Interface Vlan20, changed state to administratively down');
    for (const c of ['CORE-01', 'CORE-02']) nd(w, c).svis[10].shutdown = true;
    syncNet(w, 0);
    expect(reach(w, 'web', ip(w, 'db')).failure).toBe('gateway');
    expect(w.net!.hsrpActive[10]).toBeNull();
  });

  it('a host with a wrong gateway', () => {
    const w = world();
    w.devices.web.l3!.gw = '10.10.10.254';
    expect(reach(w, 'web', ip(w, 'db')).failure).toBe('gateway');
    expect(reach(w, 'web', ip(w, 'web2')).ok).toBe(true); // same subnet needs no gateway
    w.devices.web.l3!.gw = '10.10.20.1';
    expect(reach(w, 'web', ip(w, 'db')).failure).toBe('gateway');
    // the other direction fails on the reply
    expect(reach(w, 'db', ip(w, 'web')).failure).toBe('gateway');
  });

  it('a cut cable is link, not vlan', () => {
    const w = world();
    w.cables.c_db.broken = true;
    expect(reach(w, 'web', ip(w, 'db')).failure).toBe('link');
    expect(reach(w, 'db', ip(w, 'web')).failure).toBe('link');
  });

  it('internet: inside → FW → BR → ISP; only the public VIP is reachable from outside', () => {
    const w = world();
    const out = reach(w, 'web', '8.8.8.8');
    expect(out.ok).toBe(true);
    expect(out.hops).toEqual(['web', 'TOR-01', 'CORE-01', 'FW-01', 'BR-01', 'internet']);
    const inb = reach(w, 'internet', w.net!.lb!.publicIp);
    expect(inb).toMatchObject({ ok: true, targetId: 'L4-01' });
    expect(reach(w, 'internet', ip(w, 'web')).failure).toBe('no_route');
    // the ISP-A side goes down: traffic takes BR-02 / FW-02 / CORE-02
    w.cables['isp-a'].broken = true;
    expect(reach(w, 'internet', w.net!.lb!.publicIp).hops).toEqual(['internet', 'BR-02', 'FW-02', 'CORE-02', 'CORE-01', 'L4-01']);
  });
});

describe('HSRP', () => {
  it('CORE-01 loses power → CORE-02 takes over; preempt decides who gets it back', () => {
    const w = world();
    expect(w.net!.hsrpActive[10]).toBe('CORE-01');
    w.power!.racksDown = ['net1'];
    syncNet(w, 0);
    expect(w.net!.hsrpActive[10]).toBe('CORE-02');
    expect(logs(w, 'CORE-02')).toContain('%HSRP-5-STATECHANGE: Vlan10 Grp 1 state Standby -> Active');
    expect(reach(w, 'web', ip(w, 'db')).ok).toBe(true);
    expect(reach(w, 'web', ip(w, 'db')).hops).toContain('CORE-02');

    // back without preempt: stays on CORE-02
    for (const s of Object.values(nd(w, 'CORE-01').svis)) s.hsrp!.preempt = false;
    w.power!.racksDown = [];
    syncNet(w, 0);
    expect(w.net!.hsrpActive[10]).toBe('CORE-02');
    expect(reach(w, 'web', ip(w, 'db')).ok).toBe(true);

    // with preempt it takes the role back
    for (const s of Object.values(nd(w, 'CORE-01').svis)) s.hsrp!.preempt = true;
    syncNet(w, 0);
    expect(w.net!.hsrpActive[10]).toBe('CORE-01');
    expect(logs(w, 'CORE-01')).toContain('%HSRP-5-STATECHANGE: Vlan10 Grp 1 state Standby -> Active');
    expect(logs(w, 'CORE-02')).toContain('%HSRP-5-STATECHANGE: Vlan10 Grp 1 state Active -> Speak');
  });

  it('installed = false works like a power cut', () => {
    const w = world();
    w.devices['CORE-01'].installed = false;
    syncNet(w, 0);
    expect(w.net!.hsrpActive[20]).toBe('CORE-02');
    expect(studentDelivery(w).ok).toBeGreaterThan(0.99);
  });
});

describe('STP and port-channels', () => {
  it('default topology: TOR-01 Te1/1/3 is the blocked alternate, no storm', () => {
    const w = world();
    const s = stpView(w, 10);
    expect(s.root).toBe('CORE-01');
    expect([...s.blocked]).toEqual(['TOR-01:Te1/1/3']);
    expect(s.roles['TOR-01:Te1/1/3']).toBe('Altn');
    expect(s.roles['TOR-01:Po1']).toBe('Root');
    expect(s.storm).toBe(false);
    expect(stpView(w, 40).blocked).toEqual(new Set(['TOR-01:Te1/1/3', 'TOR-02:Te1/1/3']));
    expect(w.net!.storm).toEqual([]);
  });

  it('Po1 as built: one 20G link, about 64% busy at 8000 rps on TOR-01 nodes', () => {
    const w = world();
    const po = logicalLinks(w).find((l) => l.key === PO1)!;
    expect(po).toMatchObject({ kind: 'po', capMbps: 20000, up: true });
    expect(po.cables.sort()).toEqual(['tor1-up1', 'tor1-up2']);
    expect(poState(w, 'TOR-01', 1)).toEqual({ up: true, members: [{ ifn: 'Te1/1/1', flag: 'P' }, { ifn: 'Te1/1/2', flag: 'P' }] });
    // all students go to the two TOR-01 nodes
    for (const m of w.net!.lb!.members) m.enabled = m.host === 'n1' || m.host === 'n2';
    w.traffic.rps = 8000;
    syncNet(w, 0);
    expect(utilization(w, PO1)).toBeCloseTo(0.64, 2);
    expect(studentDelivery(w).ok).toBeGreaterThan(0.99);
  });

  it('no channel-group on either end: one parallel uplink is blocked and the other saturates', () => {
    const w = world();
    for (const [dev, ports] of [
      ['TOR-01', ['Te1/1/1', 'Te1/1/2']],
      ['CORE-01', ['Te1/0/3', 'Te1/0/4']],
    ] as const) {
      for (const p of ports) delete nd(w, dev).ifs[p].group;
    }
    for (const m of w.net!.lb!.members) m.enabled = m.host === 'n1' || m.host === 'n2';
    w.traffic.rps = 8000;
    syncNet(w, 0);
    const s = stpView(w, 40);
    expect(s.blocked.has('TOR-01:Te1/1/2')).toBe(true);
    expect(s.blocked.has('TOR-01:Te1/1/1')).toBe(false);
    const fwd = 'CORE-01:Te1/0/3~TOR-01:Te1/1/1';
    expect(utilization(w, fwd)).toBeGreaterThan(1);
    expect(utilization(w, 'CORE-01:Te1/0/4~TOR-01:Te1/1/2')).toBe(0);
    const d = studentDelivery(w);
    expect(d.ok).toBeLessThan(1);
    expect(d.notes).toContain('수강신청 접속이 일부 실패해요');
    expect(operState(w, 'TOR-01', 'Po1')).toBe('down');
    expect(logs(w, 'TOR-01')).toContain('%EC-5-UNBUNDLE: Interface Te1/1/1 left the port-channel Po1');
  });

  it('channel-group on one side only → the members are suspended (s)', () => {
    const w = world();
    for (const p of ['Te1/0/3', 'Te1/0/4']) delete nd(w, 'CORE-01').ifs[p].group;
    syncNet(w, 0);
    expect(poState(w, 'TOR-01', 1).members).toEqual([
      { ifn: 'Te1/1/1', flag: 's' },
      { ifn: 'Te1/1/2', flag: 's' },
    ]);
    expect(poState(w, 'TOR-01', 1).up).toBe(false);
    // TOR-01 still reaches the cores through CORE-02
    expect(reach(w, 'web', ip(w, 'db')).ok).toBe(true);
  });

  describe('a loop cable between the two TORs (VLAN 40 on both ends)', () => {
    function looped(): World {
      const w = world();
      for (const t of ['TOR-01', 'TOR-02']) Object.assign(nd(w, t).ifs['Gi1/0/11'], { accessVlan: 40, bpduguard: false });
      w.cables.loop = { id: 'loop', a: 'TOR-01:Gi1/0/11', b: 'TOR-02:Gi1/0/11', broken: false };
      syncNet(w, 0);
      return w;
    }

    it('with STP on: one end blocks, no storm', () => {
      const w = looped();
      expect(stpView(w, 40).storm).toBe(false);
      expect(stpView(w, 40).blocked.has('TOR-02:Gi1/0/11')).toBe(true);
      expect(reach(w, 'ops', ip(w, 'n1')).ok).toBe(true);
    });

    it('STP off on both TORs → storm, total loss, MAC flaps; STP back on → recovers', () => {
      const w = looped();
      for (const t of ['TOR-01', 'TOR-02']) nd(w, t).stpOff = [40];
      syncNet(w, 0);
      expect(w.net!.storm).toEqual([40]);
      const r = reach(w, 'ops', ip(w, 'n1'));
      expect(r).toMatchObject({ ok: false, failure: 'storm', loss: 1 });
      expect(logs(w, 'TOR-01').some((l) => l.startsWith('%SW_MATM-4-MACFLAP_NOTIF: Host 0050.56') && l.includes('in vlan 40 is flapping between port Gi1/0/11 and port'))).toBe(true);
      // links carrying VLAN 40 are flooded
      expect(utilization(w, PO1)).toBeGreaterThanOrEqual(1.5);
      // throttled: no second flap line within 10 s
      const flaps = () => logs(w, 'TOR-01').filter((l) => l.includes('MACFLAP')).length;
      const n = flaps();
      syncNet(w, 0);
      expect(flaps()).toBe(n);
      // only one end running STP is enough
      nd(w, 'TOR-01').stpOff = [];
      syncNet(w, 0);
      expect(w.net!.storm).toEqual([]);
      expect(reach(w, 'ops', ip(w, 'n1')).ok).toBe(true);
    });

    it('STP off on one TOR only: no storm', () => {
      const w = looped();
      nd(w, 'TOR-02').stpOff = [40];
      syncNet(w, 0);
      expect(stpView(w, 40).storm).toBe(false);
      expect(stpView(w, 40).blocked.has('TOR-01:Gi1/0/11')).toBe(true);
    });
  });

  it('bpduguard err-disables a server port when a switch is plugged into it', () => {
    const w = world();
    delete w.cables.c_web;
    w.cables.rogue = { id: 'rogue', a: 'TOR-02:Gi1/0/10', b: 'TOR-01:Gi1/0/1', broken: false };
    syncNet(w, 0);
    expect(nd(w, 'TOR-01').ifs['Gi1/0/1'].errDisabled).toBe('bpduguard');
    expect(operState(w, 'TOR-01', 'Gi1/0/1')).toBe('err-disabled');
    expect(logs(w, 'TOR-01')).toContain('%PM-4-ERR_DISABLE: bpduguard error detected on Gi1/0/1, putting Gi1/0/1 in err-disable state');
    expect(stpView(w, 10).storm).toBe(false);
  });
});

describe('physical layer and syslog', () => {
  it('a fresh world logs nothing on its first sync', () => {
    const w = baseTopology();
    syncNet(w, 0);
    syncNet(w, 0);
    expect(Object.values(w.devices).flatMap((d) => d.nd?.log ?? [])).toEqual([]);
  });

  it('a link going down logs LINK and LINEPROTO lines on the switch', () => {
    const w = world();
    w.cables.c_ns2.broken = true;
    syncNet(w, 0);
    expect(logs(w, 'TOR-01')).toEqual([
      '%LINK-3-UPDOWN: Interface GigabitEthernet1/0/8, changed state to down',
      '%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet1/0/8, changed state to down',
    ]);
    syncNet(w, 0);
    expect(logs(w, 'TOR-01')).toHaveLength(2);
  });

  it('a degraded cable: CRC climbs with time and about 20% of packets are lost', () => {
    let w = world();
    w.cables.c_web.degraded = true;
    w = step(w);
    w = step(w);
    expect(nd(w, 'TOR-01').ifs['Gi1/0/1'].crc).toBe(6);
    expect(operState(w, 'TOR-01', 'Gi1/0/1')).toBe('up');
    const r = reach(w, 'ops', ip(w, 'web'));
    expect(r.ok).toBe(true);
    expect(r.loss).toBeCloseTo(0.2, 5);
    expect(hostDelivery(w, 'ops', 'web').ok).toBeCloseTo(0.8, 5);
  });
});

describe('services', () => {
  it('firewall deny on the macro CIDR only', () => {
    const w = world();
    const macro = '198.51.100.77';
    w.traffic.rps = 1000;
    w.traffic.sources = [{ id: 'm', label: '매크로', cidr: `${macro}/32`, rps: 5000, kind: 'macro' }];
    syncNet(w, 0);
    const fw1 = 'CORE-01:Hu1/0/1~FW-01:Hu1/2';
    expect(w.net!.load[fw1].mbps).toBeCloseTo(6000 * 1.6);
    expect(lbView(w).demand).toBe(12000);
    w.net!.fw.rules = [{ seq: 10, action: 'deny', src: `${macro}/32`, dst: 'any' }];
    syncNet(w, 0);
    expect(reach(w, 'internet', w.net!.lb!.publicIp, { srcIp: macro, port: 80 }).failure).toBe('fw_deny');
    expect(reach(w, 'internet', w.net!.lb!.publicIp, { srcIp: STUDENT_IP, port: 80 }).ok).toBe(true);
    // dropped at the firewall: the ISP side still carries it, the inside doesn't
    expect(w.net!.load[fw1].mbps).toBeCloseTo(1000 * 1.6);
    expect(w.net!.load['BR-01:Hu0/0/1~FW-01:Hu1/1'].mbps).toBeCloseTo(6000 * 1.6);
    expect(lbView(w).demand).toBe(2000);
    expect(studentDelivery(w).ok).toBeGreaterThan(0.99);
  });

  it('L4 sessions: rps × 2 s, capped at maxConn', () => {
    const w = world();
    w.traffic.rps = 20000;
    const v = lbView(w);
    expect(v).toMatchObject({ sessions: 30000, demand: 40000, over: true });
    expect(studentDelivery(w).ok).toBeCloseTo(0.75, 2);
  });

  it('DHCP: exhaustion, a wider range, a missing relay', () => {
    const w = world();
    expect(dhcpView(w, 'lib-wifi').starving).toBe(0);
    w.net!.clients['lib-wifi'].count = 140;
    expect(dhcpView(w, 'lib-wifi')).toMatchObject({ size: 100, used: 100, free: 0, starving: 40 });
    expect(campusDelivery(w).notes).toContain('중앙도서관 무선: 일부 기기가 네트워크에 못 붙어요');
    w.net!.dhcp.pools['lib-wifi'].end = 249;
    expect(dhcpView(w, 'lib-wifi')).toMatchObject({ size: 150, starving: 0 });
    delete nd(w, 'CAMPUS-LIB').svis[31].helper;
    expect(dhcpView(w, 'lib-wifi').starving).toBe(140);
    // stale leases take addresses too
    nd(w, 'CAMPUS-LIB').svis[31].helper = '10.10.50.21';
    w.net!.dhcp.pools['lib-wifi'].stale = 30;
    expect(dhcpView(w, 'lib-wifi')).toMatchObject({ used: 150, starving: 20 });
    // the server is down
    w.net!.dhcp.running = false;
    expect(dhcpView(w, 'eng-wired').starving).toBe(60);
  });

  it('campus clients reach the internet through their building switch', () => {
    const w = world();
    expect(campusDelivery(w)).toEqual({ ok: 1, notes: [] });
    nd(w, 'CAMPUS-ENG').ifs['Gi1/0/1'].shutdown = true;
    const c = campusDelivery(w);
    expect(c.ok).toBeCloseTo(1 - 60 / 185, 5);
    expect(c.notes).toContain('공학관 유선: 인터넷이 안 돼요');
  });

  it('DNS servers both down → dns_down', () => {
    const w = world();
    w.devices.ns1.installed = false;
    expect(resolve(w, 'web', 'ops').ip).toBe(ip(w, 'web'));
    w.devices.ns2.installed = false;
    expect(resolve(w, 'web', 'ops')).toEqual({ ip: null, failure: 'dns_down' });
    expect(ping(w, 'ops', 'web').failure).toBe('dns_down');
    expect(hostDelivery(w, 'ops', 'web').failure).toBe('dns_down');
    // gear names don't need DNS (the 관리 PC knows management addresses)
    expect(ping(w, 'ops', 'CORE-01').ok).toBe(true);
    expect(run(w, 'ping web').text).toContain('ping: web: Temporary failure in name resolution');
  });

  it('OOB management answers from ops even with the CORE-01 SVIs shut, but not from a server', () => {
    const w = world();
    for (const s of Object.values(nd(w, 'CORE-01').svis)) s.shutdown = true;
    syncNet(w, 0);
    expect(reach(w, 'ops', '10.10.250.21').ok).toBe(true);
    expect(reach(w, 'web', '10.10.250.21').failure).toBe('no_route');
    w.power!.racksDown = ['net1'];
    expect(reach(w, 'ops', '10.10.250.21').ok).toBe(false);
  });

  it('lbView: k8s NodePort members are healthy on the D-Day topology', () => {
    const w = world();
    const v = lbView(w);
    expect(v.active).toBe('L4-01');
    expect(v.members.map((m) => m.healthy)).toEqual([true, true, true, true]);
    // a wrong health-check path fails every member
    w.net!.lb!.health.path = '/healthz';
    expect(lbView(w).members.every((m) => !m.healthy)).toBe(true);
    expect(studentDelivery(w)).toMatchObject({ ok: 0, notes: ['수강신청 사이트가 열리지 않아요'] });
    w.net!.lb!.health.path = '/health';
    // the wrong port: nothing listens there
    w.net!.lb!.health.port = 8080;
    expect(lbView(w).members.every((m) => !m.healthy)).toBe(true);
    w.net!.lb!.health.port = 30080;
    // L4-01 loses its link → L4-02 is active
    w.cables['l4-1'].broken = true;
    expect(lbView(w).active).toBe('L4-02');
    expect(studentDelivery(w).ok).toBeGreaterThan(0.99);
  });

  it('studentDelivery ≈ 1 on the base topology', () => {
    const w = world();
    expect(studentDelivery(w)).toEqual({ ok: 1, notes: [] });
    expect(campusDelivery(w).ok).toBe(1);
    expect(hostDelivery(w, 'web', 'db').ok).toBe(1);
  });
});

describe('k8s on the network', () => {
  it('a node whose TOR port is shut goes NotReady and its pods move', () => {
    let w = world();
    nd(w, 'TOR-02').ifs['Gi1/0/1'].shutdown = true;
    w = step(w);
    expect(w.k8s!.nodes.n3.ready).toBe(false);
    for (let i = 0; i < 4; i++) w = step(w);
    expect(readyPods(w.k8s!, 'enroll').every((p) => p.node !== 'n3')).toBe(true);
    expect(readyPods(w.k8s!, 'enroll')).toHaveLength(4);
  });

  it('kubectl drain cordons the node and moves its pods; uncordon reopens it', () => {
    let w = world();
    const r = runCommand('kubectl drain n1 --ignore-daemonsets', w, 'ops', 4);
    w = r.world;
    expect(r.lines.map(strip)).toContain('node/n1 drained');
    expect(w.k8s!.nodes.n1.cordoned).toBe(true);
    for (let i = 0; i < 4; i++) w = step(w);
    expect(w.k8s!.pods.some((p) => p.node === 'n1')).toBe(false);
    expect(readyPods(w.k8s!, 'enroll')).toHaveLength(4);
    expect(strip(runCommand('nodes', w, 'ops', 4).lines.join('\n'))).toContain('Ready,SchedulingDisabled');
    w = runCommand('kubectl uncordon n1', w, 'ops', 4).world;
    expect(w.k8s!.nodes.n1.cordoned).toBe(false);
  });
});

describe('shell commands', () => {
  it('ping: success, unreachable, timeouts, partial loss', () => {
    const w = world();
    expect(run(w, 'ping web').text).toMatch(/5 packets transmitted, 5 received, 0% packet loss/);
    expect(run(w, 'ping nosuch').text).toContain('ping: nosuch: Name or service not known');
    const v = world();
    nd(v, 'TOR-01').ifs['Gi1/0/1'].accessVlan = 20;
    syncNet(v, 0);
    expect(run(v, 'ping web').text).toContain('From 10.10.100.2 icmp_seq=1 Destination Host Unreachable');
    const d = world();
    d.cables.c_web.degraded = true;
    syncNet(d, 0);
    expect(run(d, 'ping web').text).toContain('5 packets transmitted, 4 received, 20% packet loss');
    const g = world();
    g.devices.ops.l3!.gw = null;
    // no gateway: no DNS either, and off-subnet addresses have no route
    expect(run(g, 'ping web').text).toContain('Temporary failure in name resolution');
    expect(run(g, 'ping 10.10.10.11').text).toContain('ping: connect: Network is unreachable');
  });

  it('traceroute shows the routers and where it dies', () => {
    const w = world();
    const t = run(w, 'traceroute db').text;
    expect(t).toContain('traceroute to db (10.10.20.11)');
    expect(t).toMatch(/ 1 {2}CORE-01 {2}/);
    expect(t).toMatch(/ 2 {2}DB-01 \(10\.10\.20\.11\)/);
    for (const c of ['CORE-01', 'CORE-02']) nd(w, c).svis[20].shutdown = true;
    syncNet(w, 0);
    const bad = run(w, 'trace db').text;
    expect(bad).toMatch(/ 1 {2}CORE-01/);
    expect(bad).toContain(' 2  * * *');
  });

  it('nslookup asks the DNS server', () => {
    const w = world();
    expect(run(w, 'nslookup sugang').text).toContain('Address: 10.10.30.100');
    expect(run(w, 'nslookup nope').text).toContain("** server can't find nope: NXDOMAIN");
    w.devices.ns1.installed = false;
    w.devices.ns2.installed = false;
    expect(run(w, 'nslookup sugang').text).toContain(';; connection timed out; no servers could be reached');
  });

  it('ssh: gear by name or mgmt IP (IOS user mode), servers via DNS, timeouts', () => {
    const w = world();
    expect(run(w, 'ssh CORE-01')).toMatchObject({ host: 'CORE-01', mode: { level: 'user' }, events: ['ssh:CORE-01'] });
    expect(run(w, 'ssh 10.10.250.31')).toMatchObject({ host: 'TOR-01', mode: { level: 'user' } });
    expect(run(w, 'ssh web')).toMatchObject({ host: 'web', mode: null });
    expect(run(w, 'ssh L4-01')).toMatchObject({ host: 'L4-01', mode: null });
    w.cables.c_web.broken = true;
    syncNet(w, 0);
    expect(run(w, 'ssh web').text).toContain('ssh: connect to host web port 22: Connection timed out');
    w.devices['CORE-02'].installed = false;
    expect(run(w, 'ssh CORE-02').text).toContain('Connection timed out');
  });

  it('dns list/add/del only on the DNS servers', () => {
    const w = world();
    expect(run(w, 'dns list').text).toContain('DNS 서버(ns1)에 접속해서 하세요');
    const add = runCommand('dns add portal 10.10.10.12', w, 'ns1', 1);
    expect(add.world.net!.dns.portal).toBe('10.10.10.12');
    expect(strip(runCommand('dns list', add.world, 'ns2', 1).lines.join('\n'))).toContain('portal');
    const del = runCommand('dns del PORTAL', add.world, 'ns1', 1);
    expect(del.world.net!.dns.portal).toBeUndefined();
  });

  it('ip addr shows the VLAN and gateway', () => {
    const w = world();
    const t = strip(runCommand('ip addr', w, 'web', 1).lines.join('\n'));
    expect(t).toContain('10.10.10.11/24');
    expect(t).toContain('gateway 10.10.10.1');
    expect(t).toMatch(/vlan {4}10/);
  });

  it('curl http://sugang goes VIP → L4 → a member', () => {
    const w = world();
    expect(run(w, 'curl http://sugang/enroll').text).toContain('수강신청 페이지');
    expect(run(w, 'curl http://sugang/nope').text).toContain('"error":"Not Found"');
    expect(run(w, 'curl http://sugang:8080/').text).toContain('Connection refused');
    for (const m of w.net!.lb!.members) m.enabled = false;
    expect(run(w, 'curl http://sugang/').text).toContain('503 Service Unavailable');
    expect(run(w, 'curl http://n1:30080/health').text).toContain('"status":"UP"');
  });
});
