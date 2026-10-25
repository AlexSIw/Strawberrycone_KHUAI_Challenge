// The whole school network as data: the D-Day-morning state, with everything the five days build
// already built and built right. Each day's starting world is this minus what that day and later
// days build (see `unbuild` in each day file and `dayWorld` in days/index.ts).
//
// Shape (every layer doubled):
//   internet ─ ISP-A / ISP-B ─ BR-01 / BR-02 ─ FW-01 / FW-02 ─ CORE-01 / CORE-02 (100G, HSRP, STP root)
//     ├ L4-01 / L4-02 (VLAN 30, VIP 10.10.30.100 = public 203.0.113.10)
//     ├ TOR-01 (racks 1–2) / TOR-02 (racks 3–4) ─ servers, k8s nodes, DNS/DHCP, 관리 PC
//     └ campus: CAMPUS-ENG / CAMPUS-LIB / CAMPUS-MAIN over routed links (each its buildings' gateway)
// Management (OOB) is a separate network the game doesn't model: a device's mgmtIp (10.10.250.x)
// answers from the NOC whenever the device has power.
import type { Device, Iface, NetDevice, Svi, World } from '../sim/types';
import { k8sLayer } from './k8sWorld';

// ---------- address plan ----------

/** Data-center VLANs: the third octet of 10.10.x.0/24 is the VLAN number. */
export const DC_VLANS: Record<number, string> = { 10: 'WEB', 20: 'DB', 30: 'L4-FARM', 40: 'K8S', 50: 'INFRA', 100: 'NOC' };

export const ADDR = {
  /** HSRP virtual IP (the gateway every host uses): .1 */
  gw: (vlan: number) => `10.10.${vlan}.1`,
  /** Real SVI addresses: CORE-01 .2, CORE-02 .3 */
  core: (vlan: number, n: 1 | 2) => `10.10.${vlan}.${n + 1}`,
  vip: '10.10.30.100',
  publicVip: '203.0.113.10',
  ns1: '10.10.50.11',
  ns2: '10.10.50.12',
  dhcp01: '10.10.50.21',
  ops: '10.10.100.11',
  /** Out-of-band management addresses */
  mgmt: {
    'BR-01': '10.10.250.11',
    'BR-02': '10.10.250.12',
    'CORE-01': '10.10.250.21',
    'CORE-02': '10.10.250.22',
    'TOR-01': '10.10.250.31',
    'TOR-02': '10.10.250.32',
    'L4-01': '10.10.250.41',
    'L4-02': '10.10.250.42',
    'FW-01': '10.10.250.43',
    'FW-02': '10.10.250.44',
    'CAMPUS-ENG': '10.10.250.51',
    'CAMPUS-LIB': '10.10.250.52',
    'CAMPUS-MAIN': '10.10.250.53',
  } as Record<string, string>,
} as const;

/** Server id → [label, rack, VLAN, last octet, TOR, TOR port]. */
export const SERVERS: Record<string, [string, string, number, number, string, string]> = {
  web: ['WEB-01', 'rack1', 10, 11, 'TOR-01', 'Gi1/0/1'],
  web2: ['WEB-02', 'rack1', 10, 12, 'TOR-01', 'Gi1/0/2'],
  db: ['DB-01', 'rack1', 20, 11, 'TOR-01', 'Gi1/0/3'],
  'srv-new': ['APP-01', 'rack2', 10, 13, 'TOR-01', 'Gi1/0/4'],
  'srv-db': ['DB-02', 'rack2', 20, 12, 'TOR-01', 'Gi1/0/5'],
  n1: ['K8S-01', 'rack2', 40, 11, 'TOR-01', 'Gi1/0/6'],
  n2: ['K8S-02', 'rack2', 40, 12, 'TOR-01', 'Gi1/0/7'],
  ns2: ['NS2', 'rack2', 50, 12, 'TOR-01', 'Gi1/0/8'],
  n3: ['K8S-03', 'rack3', 40, 13, 'TOR-02', 'Gi1/0/1'],
  n4: ['K8S-04', 'rack3', 40, 14, 'TOR-02', 'Gi1/0/2'],
  dhcp01: ['DHCP01', 'rack4', 50, 21, 'TOR-02', 'Gi1/0/3'],
  ns1: ['NS1', 'rack4', 50, 11, 'TOR-02', 'Gi1/0/4'],
  ops: ['관리 PC', '', 100, 11, 'TOR-02', 'Gi1/0/12'],
};

/** Campus distribution switch → [building, VLAN, subnet third octet, DHCP pool, routed /30 base to CORE-01, to CORE-02]. */
export const CAMPUS: Record<string, [string, number, number, string, number, number]> = {
  'CAMPUS-ENG': ['공학관', 12, 12, 'eng-wired', 16, 20],
  'CAMPUS-LIB': ['중앙도서관', 31, 31, 'lib-wifi', 24, 28],
  'CAMPUS-MAIN': ['본관', 40, 40, 'main-staff', 32, 36],
};

// ---------- builders ----------

export function iface(mode: Iface['mode'], speed: Iface['speed'], extra: Partial<Iface> = {}): Iface {
  return { shutdown: false, errDisabled: null, mode, accessVlan: 1, allowed: 'all', speed, crc: 0, ...extra };
}

const access = (vlan: number, extra: Partial<Iface> = {}) => iface('access', 1000, { accessVlan: vlan, bpduguard: true, ...extra });
const trunk = (allowed: number[], speed: Iface['speed'] = 10000, extra: Partial<Iface> = {}) => iface('trunk', speed, { allowed, ...extra });
const routed = (addr: string, mask: number, speed: Iface['speed']) => iface('routed', speed, { ip: { addr, mask } });

function nd(os: NetDevice['os'], model: string, host: string, ifs: Record<string, Iface>, extra: Partial<NetDevice> = {}): NetDevice {
  return { os, model, mgmtIp: ADDR.mgmt[host], ifs, vlans: {}, svis: {}, stpPriority: 32768, stpOff: [], dirty: false, startup: null, log: [], ...extra };
}

function gear(id: string, kind: Device['kind'], rack: string | undefined, net: NetDevice): Device {
  const ports = Object.keys(net.ifs).filter((k) => !k.startsWith('Po'));
  return { id, kind, label: id, rack, installed: true, feeds: ['A', 'B'], ports, nd: net };
}

/** The saved config, so the D-Day morning gear has nothing unsaved. */
function saved(d: Device): Device {
  const n = d.nd!;
  n.startup = JSON.stringify({ ifs: n.ifs, vlans: n.vlans, svis: n.svis, stpOff: n.stpOff });
  return d;
}

function core(n: 1 | 2): Device {
  const id = `CORE-0${n}`;
  // Core side of a campus /30 is .base+1, the campus side .base+2.
  const p30 = (base: number) => `10.10.254.${base + 1}`;
  const ifs: Record<string, Iface> = {
    'Hu1/0/1': routed(`10.10.254.${n === 1 ? 10 : 14}`, 30, 100000),
    'Hu1/0/2': iface('trunk', 100000),
    'Te1/0/3': trunk([10, 20, 40, 50], 10000, n === 1 ? { group: 1 } : {}),
    'Te1/0/4': trunk([10, 20, 40, 50], 10000, n === 1 ? { group: 1 } : {}),
    'Te1/0/5': trunk([10, 20, 40, 50], 10000, { shutdown: true }),
    'Te1/0/6': trunk([40, 50, 100]),
    'Te1/0/7': iface('access', 10000, { shutdown: true }),
    'Hu1/0/8': iface('access', 100000, { accessVlan: 30 }),
    'Te1/0/9': routed(p30(n === 1 ? CAMPUS['CAMPUS-ENG'][4] : CAMPUS['CAMPUS-ENG'][5]), 30, 10000),
    'Te1/0/10': routed(p30(n === 1 ? CAMPUS['CAMPUS-LIB'][4] : CAMPUS['CAMPUS-LIB'][5]), 30, 10000),
    'Te1/0/11': routed(p30(n === 1 ? CAMPUS['CAMPUS-MAIN'][4] : CAMPUS['CAMPUS-MAIN'][5]), 30, 10000),
    'Te1/0/12': iface('access', 10000, { shutdown: true }),
  };
  if (n === 1) ifs.Po1 = trunk([10, 20, 40, 50], 10000);
  const svis: Record<number, Svi> = {};
  for (const v of Object.keys(DC_VLANS).map(Number)) {
    svis[v] = {
      ip: ADDR.core(v, n),
      mask: 24,
      shutdown: false,
      hsrp: { group: 1, vip: ADDR.gw(v), priority: n === 1 ? 110 : 100, preempt: true },
      ...(v === 100 ? { helper: ADDR.dhcp01 } : {}),
    };
  }
  return saved(gear(id, 'switch', `net${n}`, nd('ios', 'KHU-SW9500', id, ifs, { vlans: { ...DC_VLANS }, svis, stpPriority: n === 1 ? 4096 : 8192 })));
}

function tor(n: 1 | 2): Device {
  const id = `TOR-0${n}`;
  const vlans = n === 1 ? [10, 20, 40, 50] : [40, 50, 100];
  const ifs: Record<string, Iface> = {};
  for (let p = 1; p <= 12; p++) ifs[`Gi1/0/${p}`] = access(1);
  for (const [, [, , vlan, , sw, port]] of Object.entries(SERVERS)) if (sw === id) ifs[port] = access(vlan);
  ifs['Te1/1/1'] = trunk(vlans, 10000, n === 1 ? { group: 1 } : {});
  ifs['Te1/1/2'] = trunk(vlans, 10000, n === 1 ? { group: 1 } : {});
  ifs['Te1/1/3'] = trunk(vlans);
  ifs['Te1/1/4'] = trunk(vlans, 10000, { shutdown: true });
  if (n === 1) ifs.Po1 = trunk(vlans);
  return saved(gear(id, 'switch', n === 1 ? 'rack1' : 'rack3', nd('ios', 'KHU-SW9300', id, ifs, { vlans: Object.fromEntries(vlans.map((v) => [v, DC_VLANS[v]])) })));
}

function border(n: 1 | 2): Device {
  const id = `BR-0${n}`;
  const pub = n === 1 ? '203.0.113.2' : '198.51.100.2';
  return saved(gear(id, 'router', `net${n}`, nd('ios', 'KHU-BR8000', id, { 'Hu0/0/0': routed(pub, 30, 100000), 'Hu0/0/1': routed(`10.10.254.${n === 1 ? 1 : 5}`, 30, 100000) })));
}

function firewall(n: 1 | 2): Device {
  const id = `FW-0${n}`;
  const o = n === 1 ? 2 : 6;
  return gear(id, 'firewall', `net${n}`, nd('fw', 'KHU-FW', id, { 'Hu1/1': routed(`10.10.254.${o}`, 30, 100000), 'Hu1/2': routed(`10.10.254.${o + 7}`, 30, 100000) }));
}

function balancer(n: 1 | 2): Device {
  const id = `L4-0${n}`;
  const d = gear(id, 'lb', `net${n}`, nd('lb', 'KHU-LB', id, { 'Hu1/1': iface('access', 100000, { accessVlan: 30 }) }));
  d.l3 = { mode: 'static', ip: `10.10.30.${10 + n}`, mask: 24, gw: ADDR.gw(30) };
  return d;
}

function campus(id: string): Device {
  const [, vlan, octet, , b1, b2] = CAMPUS[id];
  const ifs = {
    'Te1/1/1': routed(`10.10.254.${b1 + 2}`, 30, 10000),
    'Te1/1/2': routed(`10.10.254.${b2 + 2}`, 30, 10000),
    'Gi1/0/1': iface('access', 1000, { accessVlan: vlan }),
  };
  const svis: Record<number, Svi> = { [vlan]: { ip: `10.20.${octet}.1`, mask: 24, shutdown: false, helper: ADDR.dhcp01 } };
  return saved(gear(id, 'switch', undefined, nd('ios', 'KHU-SW9200', id, ifs, { vlans: { [vlan]: id.slice(7) }, svis })));
}

function server(id: string): Device {
  const [label, rack, vlan, octet] = SERVERS[id];
  return {
    id,
    kind: 'server',
    label,
    rack: rack || undefined,
    installed: true,
    feeds: ['A', 'B'],
    ports: ['eth0'],
    l3: { mode: 'static', ip: `10.10.${vlan}.${octet}`, mask: 24, gw: ADDR.gw(vlan) },
  };
}

const cable = (id: string, a: string, b: string) => ({ id, a, b, broken: false });

// ---------- the world ----------

/** D-Day morning: everything built. */
export function baseTopology(): World {
  const devices: Record<string, Device> = {
    internet: { id: 'internet', kind: 'internet', label: '인터넷 (학생들)', installed: true, feeds: [], ports: ['isp-a', 'isp-b'] },
  };
  const add = (d: Device) => (devices[d.id] = d);
  for (const n of [1, 2] as const) [border(n), firewall(n), core(n), balancer(n), tor(n)].forEach(add);
  Object.keys(CAMPUS).map(campus).forEach(add);
  Object.keys(SERVERS).map(server).forEach(add);

  const cables = [
    cable('isp-a', 'internet:isp-a', 'BR-01:Hu0/0/0'),
    cable('isp-b', 'internet:isp-b', 'BR-02:Hu0/0/0'),
    cable('br1-fw1', 'BR-01:Hu0/0/1', 'FW-01:Hu1/1'),
    cable('br2-fw2', 'BR-02:Hu0/0/1', 'FW-02:Hu1/1'),
    cable('fw1-core1', 'FW-01:Hu1/2', 'CORE-01:Hu1/0/1'),
    cable('fw2-core2', 'FW-02:Hu1/2', 'CORE-02:Hu1/0/1'),
    cable('core-peer', 'CORE-01:Hu1/0/2', 'CORE-02:Hu1/0/2'),
    cable('tor1-up1', 'TOR-01:Te1/1/1', 'CORE-01:Te1/0/3'),
    cable('tor1-up2', 'TOR-01:Te1/1/2', 'CORE-01:Te1/0/4'),
    cable('tor1-up3', 'TOR-01:Te1/1/3', 'CORE-02:Te1/0/3'),
    cable('tor1-spare', 'TOR-01:Te1/1/4', 'CORE-01:Te1/0/5'),
    cable('tor2-up1', 'TOR-02:Te1/1/1', 'CORE-01:Te1/0/6'),
    cable('tor2-up3', 'TOR-02:Te1/1/3', 'CORE-02:Te1/0/6'),
    cable('l4-1', 'L4-01:Hu1/1', 'CORE-01:Hu1/0/8'),
    cable('l4-2', 'L4-02:Hu1/1', 'CORE-02:Hu1/0/8'),
    cable('eng-1', 'CAMPUS-ENG:Te1/1/1', 'CORE-01:Te1/0/9'),
    cable('eng-2', 'CAMPUS-ENG:Te1/1/2', 'CORE-02:Te1/0/9'),
    cable('lib-1', 'CAMPUS-LIB:Te1/1/1', 'CORE-01:Te1/0/10'),
    cable('lib-2', 'CAMPUS-LIB:Te1/1/2', 'CORE-02:Te1/0/10'),
    cable('main-1', 'CAMPUS-MAIN:Te1/1/1', 'CORE-01:Te1/0/11'),
    cable('main-2', 'CAMPUS-MAIN:Te1/1/2', 'CORE-02:Te1/0/11'),
    ...Object.entries(SERVERS).map(([id, [, , , , sw, port]]) => cable(`c_${id}`, `${id}:eth0`, `${sw}:${port}`)),
  ];

  const dns: Record<string, string> = { sugang: ADDR.vip };
  for (const [id, [, , vlan, octet]] of Object.entries(SERVERS)) dns[id] = `10.10.${vlan}.${octet}`;
  for (const [id, ip] of Object.entries(ADDR.mgmt)) dns[id] = ip;

  const pool = (name: string, label: string, octet: string, gw: string) => ({
    name, label, network: octet, mask: 24, start: 100, end: 199, gw, dns: [ADDR.ns1, ADDR.ns2], stale: 0,
  });

  return {
    t: 0,
    devices,
    cables: Object.fromEntries(cables.map((c) => [c.id, c])),
    power: { mains: true, ups: true },
    net: {
      dns,
      dnsServers: ['ns1', 'ns2'],
      dhcp: {
        server: 'dhcp01',
        running: true,
        pools: {
          'eng-wired': pool('eng-wired', '공학관 유선', '10.20.12.0', '10.20.12.1'),
          'lib-wifi': pool('lib-wifi', '중앙도서관 무선', '10.20.31.0', '10.20.31.1'),
          'main-staff': pool('main-staff', '본관 교직원', '10.20.40.0', '10.20.40.1'),
          noc: pool('noc', '관제실 노트북', '10.10.100.0', ADDR.gw(100)),
        },
      },
      clients: {
        'eng-wired': { label: '공학관 유선', pool: 'eng-wired', switch: 'CAMPUS-ENG', port: 'Gi1/0/1', count: 60 },
        'lib-wifi': { label: '중앙도서관 무선', pool: 'lib-wifi', switch: 'CAMPUS-LIB', port: 'Gi1/0/1', count: 85 },
        'main-staff': { label: '본관 교직원', pool: 'main-staff', switch: 'CAMPUS-MAIN', port: 'Gi1/0/1', count: 40 },
      },
      fw: { rules: [] },
      lb: {
        vip: ADDR.vip,
        publicIp: ADDR.publicVip,
        port: 80,
        pair: ['L4-01', 'L4-02'],
        members: ['n1', 'n2', 'n3', 'n4'].map((n) => ({ name: n, host: n, port: 30080, enabled: true })),
        health: { proto: 'http', port: 30080, path: '/health' },
        maxConn: 30000,
      },
      hsrpActive: {},
      load: {},
      storm: [],
    },
    k8s: k8sLayer({ n1: 'rack2', n2: 'rack2', n3: 'rack3', n4: 'rack3' }, { enrollReplicas: 4 }),
    cooling: { cracOk: true, temps: { rack1: 24, rack2: 24, rack3: 24, rack4: 24 }, cracRacks: ['rack1', 'rack2'] },
    campus: {
      portal: { label: 'KHU 포털', up: true, latencyMs: 120, team: '포털 운영팀' },
      lms: { label: 'KHU LMS', up: true, latencyMs: 180, team: 'LMS 운영팀' },
      mail: { label: 'KHU 웹메일', up: true, latencyMs: 90, team: '메일 운영팀' },
      library: { label: 'KHU 도서관', up: true, latencyMs: 140, team: '도서관 시스템팀' },
    },
    db: { maxConn: 200 },
    traffic: { rps: 300, noticeShare: 0, sources: [] },
    flags: {},
  };
}

// ---------- sanity ----------

/**
 * Structural problems (not misconfigurations — those are what incidents are made of):
 * cable endpoints that don't exist, a port with two cables, gear whose ifs don't cover its ports,
 * two live hosts with the same address, an access port in a VLAN its switch doesn't have is allowed.
 */
export function validateWorld(w: World): string[] {
  const errs: string[] = [];
  const used = new Map<string, string>();
  for (const c of Object.values(w.cables)) {
    for (const ep of [c.a, c.b]) {
      const i = ep.indexOf(':');
      const d = w.devices[ep.slice(0, i)];
      if (!d) errs.push(`cable ${c.id}: no device ${ep.slice(0, i)}`);
      else if (!d.ports.includes(ep.slice(i + 1))) errs.push(`cable ${c.id}: ${d.id} has no port ${ep.slice(i + 1)}`);
      if (used.has(ep)) errs.push(`port ${ep} has two cables (${used.get(ep)}, ${c.id})`);
      used.set(ep, c.id);
    }
  }
  const ips = new Map<string, string>();
  const claim = (ip: string | null | undefined, who: string) => {
    if (!ip) return;
    if (ips.has(ip)) errs.push(`address ${ip} used by ${ips.get(ip)} and ${who}`);
    ips.set(ip, who);
  };
  for (const d of Object.values(w.devices)) {
    claim(d.l3?.ip, d.id);
    const n = d.nd;
    if (!n) continue;
    for (const p of d.ports) if (!n.ifs[p]) errs.push(`${d.id}: port ${p} has no interface config`);
    for (const [k, f] of Object.entries(n.ifs)) {
      if (f.group !== undefined && !n.ifs[`Po${f.group}`]) errs.push(`${d.id}: ${k} is in channel-group ${f.group} but Po${f.group} doesn't exist`);
      claim(f.ip?.addr, `${d.id}:${k}`);
    }
    for (const [v, s] of Object.entries(n.svis)) claim(s.ip, `${d.id}:Vlan${v}`);
    claim(n.mgmtIp, `${d.id} (mgmt)`);
  }
  for (const [id, c] of Object.entries(w.net?.clients ?? {})) {
    if (!w.devices[c.switch]?.nd?.ifs[c.port]) errs.push(`client group ${id}: no port ${c.switch}:${c.port}`);
    if (!w.net?.dhcp.pools[c.pool]) errs.push(`client group ${id}: no DHCP pool ${c.pool}`);
  }
  return errs;
}
