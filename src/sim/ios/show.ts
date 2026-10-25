// `show …` output in real IOS layouts. Everything is derived from the device config (nd) and the
// network functions (operState, stpView, …); nothing here mutates the world.
import * as stages from '../../content/stages';
import { syslogStamp } from '../clock';
import { green, red, yellow } from '../commands/types';
import {
  cablePeer,
  carries,
  compareIf,
  electHsrp,
  logicalLinks,
  longIf,
  maskToDotted,
  operState,
  poNumber,
  poState,
  stpView,
  sviUp,
  utilization,
  type LLink,
} from '../net';
import type { DayId, Iface, IfOper, NetDevice, SyslogEntry, World } from '../types';
import { own } from '../util';
import { fmtVlanList } from './parse';

// ---------- small helpers ----------

/** Pad to `n` columns (at least one space), then colour: alignment never counts escape codes. */
const cell = (s: string, n: number, color?: (x: string) => string) => (color ? color(s) : s) + ' '.repeat(Math.max(1, n - s.length));
const rcell = (s: string, n: number) => ' '.repeat(Math.max(0, n - s.length)) + s;

const isSviKey = (k: string) => /^Vlan\d+$/.test(k);
const sviNum = (k: string) => parseInt(k.slice(4), 10);

/** Deterministic fake MAC per device (and port index): '00a1.3f2c.0105'. */
export function macOf(dev: string, idx = 0): string {
  let h = 2166136261;
  for (const ch of dev) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const hex = (n: number) => (n & 0xffff).toString(16).padStart(4, '0');
  return `00a1.${hex(h)}.${hex((h >>> 16) + idx)}`;
}

/** Physical + Po keys (sorted), then SVIs. */
export function allIfKeys(nd: NetDevice): string[] {
  const phys = Object.keys(nd.ifs).sort(compareIf);
  const svis = Object.keys(nd.svis).map((v) => `Vlan${v}`).sort(compareIf);
  return [...phys, ...svis];
}

/** Interface operational state; SVIs from sviUp. */
export function ifOper(w: World, host: string, nd: NetDevice, k: string): IfOper {
  if (isSviKey(k)) {
    const s = nd.svis[sviNum(k)];
    if (!s) return 'down';
    if (s.shutdown) return 'admin-down';
    return sviUp(w, host, sviNum(k)) ? 'up' : 'down';
  }
  return operState(w, host, k);
}

const upWord = (s: string) => (s === 'up' ? green(s) : red(s));

/** "is up, line protocol is up (connected)" */
function statusPhrase(st: IfOper, svi: boolean): string {
  switch (st) {
    case 'up':
      return `is ${green('up')}, line protocol is ${green('up')}${svi ? '' : ' (connected)'}`;
    case 'admin-down':
      return `is ${red('administratively down')}, line protocol is ${red('down')}${svi ? '' : ' (disabled)'}`;
    case 'err-disabled':
      return `is ${red('down')}, line protocol is ${red('down')} (${red('err-disabled')})`;
    default:
      return `is ${red('down')}, line protocol is ${red('down')}${svi ? '' : ' (notconnect)'}`;
  }
}

function speedTxt(f: Iface): string {
  return f.speed >= 100000 ? '100G' : f.speed >= 10000 ? '10G' : '1000';
}

function mediaType(k: string): string {
  if (k.startsWith('Gi')) return '10/100/1000BaseTX';
  if (k.startsWith('Te')) return 'SFP-10GBase-SR';
  if (k.startsWith('Hu')) return 'QSFP-100G-SR4';
  return '';
}

/** The logical link (and how many member cables share it) an interface sits on. */
function linkFor(links: LLink[], nd: NetDevice, host: string, k: string): { link: LLink; share: number } | null {
  const f = nd.ifs[k];
  const keys = [k, ...(f?.group !== undefined ? [`Po${f.group}`] : [])];
  for (const key of keys) {
    const l = links.find((x) => (x.a.dev === host && x.a.ifn === key) || (x.b.dev === host && x.b.ifn === key));
    if (l) return { link: l, share: key === k ? 1 : Math.max(1, l.cables.length) };
  }
  return null;
}

/** "*Feb  6 09:12:30" with the day's clock (falls back to a plain offset if the day can't be looked up). */
export function stampFor(day: DayId, t: number): string {
  try {
    const def = stages.getStage(day);
    if (def?.clock && def.date) return syslogStamp(def.clock, def.date, t);
  } catch {
    // content not loaded (isolated tests): fall through
  }
  const s = Math.floor(t);
  const two = (n: number) => String(n).padStart(2, '0');
  return `*Feb 10 ${two(9 + Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

// ---------- show interfaces ----------

export function showInterfaces(w: World, host: string, nd: NetDevice, only?: string): string[] {
  const links = logicalLinks(w);
  const keys = only ? [only] : allIfKeys(nd);
  const out: string[] = [];
  keys.forEach((k, idx) => {
    const svi = isSviKey(k);
    const st = ifOper(w, host, nd, k);
    out.push(`${longIf(k)} ${statusPhrase(st, svi)}`);
    if (svi) {
      const s = nd.svis[sviNum(k)];
      out.push(`  Hardware is Ethernet SVI, address is ${macOf(host, 0)} (bia ${macOf(host, 0)})`);
      out.push(s?.ip ? `  Internet address is ${s.ip}/${s.mask}` : '  Internet address is not set');
      out.push('  MTU 1500 bytes, BW 1000000 Kbit/sec, DLY 10 usec,', '     reliability 255/255, txload 1/255, rxload 1/255');
      out.push('  Encapsulation ARPA, loopback not set');
      if (idx < keys.length - 1) out.push('');
      return;
    }
    const f = nd.ifs[k];
    const po = poNumber(k);
    const mac = macOf(host, idx + 1);
    out.push(po !== null ? `  Hardware is EtherChannel, address is ${mac} (bia ${mac})` : `  Hardware is ${k.startsWith('Gi') ? 'Gigabit Ethernet' : k.startsWith('Te') ? 'Ten Gigabit Ethernet' : 'Hundred Gigabit Ethernet'}, address is ${mac} (bia ${mac})`);
    if (f.desc) out.push(`  Description: ${f.desc}`);
    if (f.mode === 'routed' && f.ip) out.push(`  Internet address is ${f.ip.addr}/${f.ip.mask}`);
    const lk = st === 'up' ? linkFor(links, nd, host, k) : null;
    const util = lk ? utilization(w, lk.link.key) : 0;
    const load = st === 'up' ? Math.min(255, Math.max(1, Math.round(util * 255))) : 1;
    const loadTxt = load >= 230 ? red(`${load}/255`) : load >= 180 ? yellow(`${load}/255`) : `${load}/255`;
    const bw = f.speed * 1000;
    out.push(`  MTU 1500 bytes, BW ${bw} Kbit/sec, DLY 10 usec,`, `     reliability 255/255, txload ${loadTxt}, rxload ${loadTxt}`);
    out.push('  Encapsulation ARPA, loopback not set');
    if (po !== null) {
      const members = Object.keys(nd.ifs).filter((m) => nd.ifs[m].group === po).sort(compareIf);
      out.push(`  Members in this channel: ${members.join(' ') || '(none)'}`);
    }
    out.push(st === 'up' ? `  Full-duplex, ${speedTxt(f)}b/s${po === null ? `, media type is ${mediaType(k)}` : ''}` : `  Auto-duplex, Auto-speed${po === null ? `, media type is ${mediaType(k)}` : ''}`);
    out.push('  Last clearing of "show interface" counters never');
    const mbps = lk ? (w.net?.load[lk.link.key]?.mbps ?? 0) / lk.share : 0;
    const bps = Math.round(mbps * 1e6);
    const pps = Math.round(bps / 8 / 1000);
    out.push(`  5 minute input rate ${Math.round(bps / 4)} bits/sec, ${Math.round(pps / 4)} packets/sec`);
    out.push(`  5 minute output rate ${bps} bits/sec, ${pps} packets/sec`);
    const crc = f.crc > 0 ? red(String(f.crc)) : '0';
    out.push(`     ${f.crc > 0 ? red(String(f.crc)) : '0'} input errors, ${crc} CRC, 0 frame, 0 overrun, 0 ignored`);
    out.push('     0 output errors, 0 collisions, 0 interface resets');
    if (idx < keys.length - 1) out.push('');
  });
  return out;
}

// ---------- show ip interface brief ----------

export function showIpIntBrief(w: World, host: string, nd: NetDevice): string[] {
  const out = [`${cell('Interface', 23)}${cell('IP-Address', 16)}OK? ${cell('Method', 7)}${cell('Status', 22)}Protocol`];
  for (const k of allIfKeys(nd)) {
    const st = ifOper(w, host, nd, k);
    const ip = isSviKey(k) ? (nd.svis[sviNum(k)]?.ip ?? null) : (nd.ifs[k].ip?.addr ?? null);
    const status = st === 'up' ? 'up' : st === 'admin-down' ? 'administratively down' : 'down';
    const proto = st === 'up' ? 'up' : 'down';
    out.push(`${cell(longIf(k), 23)}${cell(ip ?? 'unassigned', 16)}YES ${cell(ip ? 'manual' : 'unset', 7)}${cell(status, 22, upWord)}${upWord(proto)}`);
  }
  return out;
}

// ---------- show interfaces status ----------

function statusWord(nd: NetDevice, f: Iface, st: IfOper): string {
  if (st === 'err-disabled') return 'err-disabled';
  if (st === 'admin-down') return 'disabled';
  if (st !== 'up') return 'notconnect';
  if (f.mode === 'access' && f.accessVlan !== 1 && !(f.accessVlan in nd.vlans)) return 'inactive';
  return 'connected';
}

export function showIntStatus(w: World, host: string, nd: NetDevice): string[] {
  const out = [`${cell('Port', 10)}${cell('Name', 19)}${cell('Status', 13)}${cell('Vlan', 11)}${rcell('Duplex', 6)} ${rcell('Speed', 6)} Type`];
  for (const k of Object.keys(nd.ifs).sort(compareIf)) {
    const f = nd.ifs[k];
    const st = operState(w, host, k);
    const word = statusWord(nd, f, st);
    const color = word === 'connected' ? green : red;
    const vlan = f.mode === 'trunk' ? 'trunk' : f.mode === 'routed' ? 'routed' : String(f.accessVlan);
    const up = st === 'up';
    const sp = speedTxt(f);
    out.push(
      `${cell(k, 10)}${cell((f.desc ?? '').slice(0, 18), 19)}${cell(word, 13, color)}${cell(vlan, 11)}${rcell(up ? 'a-full' : 'auto', 6)} ${rcell(up ? `a-${sp}` : 'auto', 6)} ${mediaType(k)}`.trimEnd(),
    );
  }
  return out;
}

// ---------- show interfaces trunk ----------

export function showIntTrunk(w: World, host: string, nd: NetDevice): string[] {
  const trunks = Object.keys(nd.ifs)
    .filter((k) => nd.ifs[k].mode === 'trunk' && nd.ifs[k].group === undefined && operState(w, host, k) === 'up')
    .sort(compareIf);
  if (!trunks.length) return [];
  const existing = [1, ...Object.keys(nd.vlans).map(Number)].sort((a, b) => a - b);
  const allowed = (k: string) => {
    const a = nd.ifs[k].allowed;
    return a === 'all' ? null : a;
  };
  const active = (k: string) => existing.filter((v) => allowed(k)?.includes(v) ?? true);
  const forwarding = (k: string) =>
    active(k).filter((v) => {
      if (nd.stpOff.includes(v)) return true;
      return !stpView(w, v).blocked.has(`${host}:${k}`);
    });
  const list = (vs: number[]) => (vs.length ? fmtVlanList(vs) : 'none');
  const out = [`${cell('Port', 12)}${cell('Mode', 17)}${cell('Encapsulation', 15)}${cell('Status', 14)}Native vlan`];
  for (const k of trunks) out.push(`${cell(k, 12)}${cell('on', 17)}${cell('802.1q', 15)}${cell('trunking', 14)}1`);
  out.push('', `${cell('Port', 12)}Vlans allowed on trunk`);
  for (const k of trunks) out.push(`${cell(k, 12)}${allowed(k) ? list(allowed(k)!) : '1-4094'}`);
  out.push('', `${cell('Port', 12)}Vlans allowed and active in management domain`);
  for (const k of trunks) out.push(`${cell(k, 12)}${list(active(k))}`);
  out.push('', `${cell('Port', 12)}Vlans in spanning tree forwarding state and not pruned`);
  for (const k of trunks) out.push(`${cell(k, 12)}${list(forwarding(k))}`);
  return out;
}

// ---------- show cdp neighbors ----------

const CDP_IF = (k: string) => k.replace(/^Gi/, 'Gig ').replace(/^Te/, 'Ten ').replace(/^Hu/, 'Hun ');

export function showCdpNeighbors(w: World, host: string, nd: NetDevice): string[] {
  const out = [
    'Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge',
    '                  S - Switch, H - Host, I - IGMP, r - Repeater, P - Phone,',
    '                  D - Remote, C - CVTA, M - Two-port Mac Relay',
    '',
    'Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID',
  ];
  let n = 0;
  for (const k of Object.keys(nd.ifs).sort(compareIf)) {
    const peer = cablePeer(w, host, k);
    const pd = peer && own(w.devices, peer[0]);
    if (!peer || !pd?.nd || pd.nd.os !== 'ios' || operState(w, host, k) !== 'up') continue;
    const caps = pd.kind === 'router' ? 'R I' : Object.keys(pd.nd.svis).length || Object.values(pd.nd.ifs).some((f) => f.mode === 'routed') ? 'R S I' : 'S I';
    out.push(`${cell(pd.label, 17)}${cell(CDP_IF(k), 18)}${rcell(String(150 + ((k.length * 7) % 30)), 7)}${rcell(caps, 16)}  ${cell(pd.nd.model.slice(0, 9), 10)}${CDP_IF(peer[1])}`);
    n++;
  }
  out.push('', `Total cdp entries displayed : ${n}`);
  return out;
}

// ---------- show interfaces counters errors ----------

export function showCountersErrors(nd: NetDevice): string[] {
  const head = `${'Port'.padEnd(9)}${rcell('Align-Err', 12)}${rcell('FCS-Err', 12)}${rcell('Xmit-Err', 12)}${rcell('Rcv-Err', 12)}${rcell('UnderSize', 11)}${rcell('OutDiscards', 13)}`;
  const out = [head];
  for (const k of Object.keys(nd.ifs).sort(compareIf)) {
    const c = nd.ifs[k].crc;
    const n = (x: number, w: number) => (x > 0 ? ' '.repeat(Math.max(0, w - String(x).length)) + red(String(x)) : rcell(String(x), w));
    out.push(`${k.padEnd(9)}${rcell('0', 12)}${n(c, 12)}${rcell('0', 12)}${n(c, 12)}${rcell('0', 11)}${rcell('0', 13)}`);
  }
  return out;
}

// ---------- show vlan brief ----------

export function showVlanBrief(nd: NetDevice): string[] {
  const out = [
    'VLAN Name                             Status    Ports',
    '---- -------------------------------- --------- -------------------------------',
  ];
  const vlans = [1, ...Object.keys(nd.vlans).map(Number).filter((v) => v !== 1)].sort((a, b) => a - b);
  for (const v of vlans) {
    const name = v === 1 ? 'default' : nd.vlans[v];
    // Access ports in this VLAN; channel members are listed through their Po.
    const ports = Object.keys(nd.ifs)
      .filter((k) => {
        const f = nd.ifs[k];
        return f.mode === 'access' && f.group === undefined && f.accessVlan === v;
      })
      .sort(compareIf);
    const rows: string[] = [];
    for (let i = 0; i < ports.length; i += 4) rows.push(ports.slice(i, i + 4).join(', '));
    out.push(`${cell(String(v), 5)}${cell(name.slice(0, 32), 33)}${cell('active', 10)}${rows[0] ?? ''}`.trimEnd());
    for (const r of rows.slice(1)) out.push(`${' '.repeat(48)}${r}`);
  }
  return out;
}

// ---------- show etherchannel summary ----------

export function showEtherchannel(w: World, host: string, nd: NetDevice): string[] {
  const groups = Object.keys(nd.ifs)
    .map(poNumber)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  const out = [
    'Flags:  D - down        P - bundled in port-channel',
    '        I - stand-alone s - suspended',
    '        H - Hot-standby (LACP only)',
    '        R - Layer3      S - Layer2',
    '        U - in use      f - failed to allocate aggregator',
    '',
    '        M - not in use, minimum links not met',
    '        u - unsuitable for bundling',
    '        w - waiting to be aggregated',
    '        d - default port',
    '',
    '',
    `Number of channel-groups in use: ${groups.length}`,
    `Number of aggregators:           ${groups.length}`,
    '',
    'Group  Port-channel  Protocol    Ports',
    '------+-------------+-----------+-----------------------------------------------',
  ];
  for (const n of groups) {
    const ps = poState(w, host, n);
    const cfg = Object.keys(nd.ifs)
      .filter((k) => nd.ifs[k].group === n)
      .sort(compareIf);
    const members = cfg.map((ifn) => {
      const known = ps.members.find((m) => m.ifn === ifn);
      return { ifn, flag: known ? known.flag : operState(w, host, ifn) === 'up' ? 'P' : 'D' };
    });
    const up = ps.members.length ? ps.up : members.some((m) => m.flag === 'P');
    const po = nd.ifs[`Po${n}`];
    const flags = `${po.mode === 'routed' ? 'R' : 'S'}${up ? 'U' : 'D'}`;
    const poTxt = `Po${n}(${flags})`;
    const proto = cfg.length && cfg.every((k) => nd.ifs[k].chMode === 'on') ? '-' : 'LACP';
    const mem = members.map((m) => {
      const t = `${m.ifn}(${m.flag})`;
      return cell(t, 16, m.flag === 'P' ? green : red);
    });
    out.push(`${cell(String(n), 7)}${cell(poTxt, 14, up ? green : red)}${cell(proto, 12)}${mem.join('')}`.trimEnd());
  }
  return out;
}

// ---------- show standby brief ----------

export function showStandbyBrief(w: World, host: string, nd: NetDevice): string[] {
  const out = [
    '                     P indicates configured to preempt.',
    '                     |',
    `${cell('Interface', 12)}${cell('Grp', 5)}${cell('Pri', 4)}${cell('P', 2)}${cell('State', 8)}${cell('Active', 16)}${cell('Standby', 16)}Virtual IP`,
  ];
  for (const v of Object.keys(nd.svis).map(Number).sort((a, b) => a - b)) {
    const s = nd.svis[v];
    const h = s.hsrp;
    if (!h) continue;
    const up = !s.shutdown && sviUp(w, host, v);
    const cache = w.net?.hsrpActive;
    const active = cache && v in cache ? cache[v] : electHsrp(w, v, null);
    const sviIp = (dev: string) => own(w.devices, dev)?.nd?.svis[v]?.ip ?? 'unknown';
    // Another core with the same group whose SVI is up.
    const peers = Object.values(w.devices).filter(
      (d) => d.id !== host && d.nd?.svis[v]?.hsrp?.group === h.group && !d.nd.svis[v].shutdown && sviUp(w, d.id, v),
    );
    let state = 'Init';
    let act = 'unknown';
    let stb = 'unknown';
    if (up && active === host) {
      state = 'Active';
      act = 'local';
      stb = peers.length ? sviIp(peers[0].id) : 'unknown';
    } else if (up && active) {
      state = 'Standby';
      act = sviIp(active);
      stb = 'local';
    }
    const stColor = state === 'Init' ? red : green;
    out.push(
      `${cell(`Vl${v}`, 12)}${cell(String(h.group), 5)}${rcell(String(h.priority), 3)} ${cell(h.preempt ? 'P' : '', 2)}${cell(state, 8, stColor)}${cell(act, 16)}${cell(stb, 16, stb === 'unknown' ? yellow : undefined)}${h.vip || 'unknown'}`,
    );
  }
  return out;
}

// ---------- show spanning-tree ----------

const STP_COST = (k: string, f: Iface | undefined) => (k.startsWith('Po') ? 1000 : (f?.speed ?? 1000) >= 100000 ? 200 : (f?.speed ?? 1000) >= 10000 ? 2000 : 20000);

/** VLANs that have an STP instance on this switch: defined, STP on, and some up port carries them. */
function stpVlans(w: World, host: string, nd: NetDevice): number[] {
  const vs = [1, ...Object.keys(nd.vlans).map(Number)];
  return [...new Set(vs)].filter((v) => !nd.stpOff.includes(v) && stpPorts(w, host, nd, v).length > 0).sort((a, b) => a - b);
}

function stpPorts(w: World, host: string, nd: NetDevice, v: number): string[] {
  return Object.keys(nd.ifs)
    .filter((k) => nd.ifs[k].group === undefined && nd.ifs[k].mode !== 'routed')
    .filter((k) => operState(w, host, k) === 'up' && carries(w, { dev: host, ifn: k }, v))
    .sort(compareIf);
}

function stpInstance(w: World, host: string, nd: NetDevice, v: number): string[] {
  const sv = stpView(w, v);
  const rootId = sv.root ?? host;
  const rootNd = own(w.devices, rootId)?.nd ?? nd;
  const ports = stpPorts(w, host, nd, v);
  const rootPort = ports.find((k) => sv.roles[`${host}:${k}`] === 'Root');
  const hello = '             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec';
  const out = [`VLAN${String(v).padStart(4, '0')}`, '  Spanning tree enabled protocol rstp'];
  out.push(`  Root ID    Priority    ${rootNd.stpPriority + v}`, `             Address     ${macOf(rootId)}`);
  if (rootId === host) out.push('             This bridge is the root');
  else if (rootPort) {
    const idx = Object.keys(nd.ifs).sort(compareIf).indexOf(rootPort) + 1;
    out.push(`             Cost        ${STP_COST(rootPort, nd.ifs[rootPort])}`, `             Port        ${poNumber(rootPort) !== null ? 64 + poNumber(rootPort)! : idx} (${longIf(rootPort)})`);
  }
  out.push(hello, '');
  out.push(`  Bridge ID  Priority    ${nd.stpPriority + v}  (priority ${nd.stpPriority} sys-id-ext ${v})`, `             Address     ${macOf(host)}`, hello, '             Aging Time  300 sec', '');
  out.push('Interface           Role Sts Cost      Prio.Nbr Type', '------------------- ---- --- --------- -------- --------------------------------');
  const sorted = Object.keys(nd.ifs).sort(compareIf);
  for (const k of ports) {
    const key = `${host}:${k}`;
    const role = sv.roles[key] ?? 'Desg';
    const sts = sv.blocked.has(key) ? 'BLK' : 'FWD';
    const po = poNumber(k);
    const nbr = po !== null ? 64 + po : sorted.indexOf(k) + 1;
    const type = nd.ifs[k].bpduguard ? 'P2p Edge' : 'P2p';
    out.push(`${cell(k, 20)}${cell(role, 5)}${cell(sts, 4, sts === 'BLK' ? red : green)}${cell(String(STP_COST(k, nd.ifs[k])), 10)}${cell(`128.${nbr}`, 9)}${type}`);
  }
  return out;
}

export function showSpanningTree(w: World, host: string, nd: NetDevice, vlan?: number): string[] {
  if (vlan !== undefined) {
    if (nd.stpOff.includes(vlan) || !(vlan === 1 || vlan in nd.vlans) || !stpPorts(w, host, nd, vlan).length) {
      return [`Spanning tree instance(s) for vlan ${vlan} does not exist.`];
    }
    return stpInstance(w, host, nd, vlan);
  }
  const vs = stpVlans(w, host, nd);
  if (!vs.length) return ['No spanning tree instance exists.'];
  const out: string[] = [];
  vs.forEach((v, i) => {
    if (i) out.push('', '');
    out.push(...stpInstance(w, host, nd, v));
  });
  return out;
}

// ---------- show logging ----------

function logLine(e: SyslogEntry, day: DayId): string {
  const msg = e.msg.replace(/\b(down|err-disabled)\b/g, (m) => red(m)).replace(/\bto up\b/g, `to ${green('up')}`);
  return `${stampFor(day, e.t)}: %${e.tag}: ${msg}`;
}

export function showLogging(nd: NetDevice, day: DayId): string[] {
  const n = nd.log.length;
  return [
    'Syslog logging: enabled (0 messages dropped, 0 messages rate-limited, 0 flushes, 0 overruns, xml disabled, filtering disabled)',
    '',
    `    Console logging: level debugging, ${n} messages logged, xml disabled,`,
    '                     filtering disabled',
    `    Buffer logging:  level debugging, ${n} messages logged, xml disabled,`,
    '                    filtering disabled',
    '',
    'Log Buffer (8192 bytes):',
    '',
    ...nd.log.map((e) => logLine(e, day)),
  ];
}

// ---------- show running-config ----------

type ConfigParts = Pick<NetDevice, 'ifs' | 'vlans' | 'svis' | 'stpOff'> & { stpPriority?: number };

function ifBlock(k: string, f: Iface): string[] {
  const out = [`interface ${longIf(k)}`];
  if (f.desc) out.push(` description ${f.desc}`);
  if (f.mode === 'routed') {
    out.push(' no switchport');
    out.push(f.ip ? ` ip address ${f.ip.addr} ${maskToDotted(f.ip.mask)}` : ' no ip address');
  } else {
    if (f.mode === 'access' && f.accessVlan !== 1) out.push(` switchport access vlan ${f.accessVlan}`);
    if (f.mode === 'trunk' && f.allowed !== 'all') out.push(` switchport trunk allowed vlan ${f.allowed.length ? fmtVlanList(f.allowed) : 'none'}`);
    out.push(` switchport mode ${f.mode}`);
  }
  if (f.shutdown) out.push(' shutdown');
  if (f.group !== undefined) out.push(` channel-group ${f.group} mode ${f.chMode ?? 'active'}`);
  if (f.bpduguard) out.push(' spanning-tree bpduguard enable');
  return out;
}

function sviBlock(v: number, s: NetDevice['svis'][number]): string[] {
  const out = [`interface Vlan${v}`];
  out.push(s.ip ? ` ip address ${s.ip} ${maskToDotted(s.mask)}` : ' no ip address');
  if (s.helper) out.push(` ip helper-address ${s.helper}`);
  if (s.hsrp) {
    const h = s.hsrp;
    if (h.vip) out.push(` standby ${h.group} ip ${h.vip}`);
    if (h.priority !== 100) out.push(` standby ${h.group} priority ${h.priority}`);
    if (h.preempt) out.push(` standby ${h.group} preempt`);
  }
  if (s.shutdown) out.push(' shutdown');
  return out;
}

/** Interface (or SVI) block as it appears in the running-config. */
export function interfaceConfig(c: ConfigParts, k: string): string[] {
  if (isSviKey(k)) return c.svis[sviNum(k)] ? sviBlock(sviNum(k), c.svis[sviNum(k)]) : [];
  return c.ifs[k] ? ifBlock(k, c.ifs[k]) : [];
}

function configBody(label: string, c: ConfigParts): string[] {
  const out = ['!', 'version 17.9', 'service timestamps debug datetime msec', 'service timestamps log datetime msec', 'no service password-encryption', '!', `hostname ${label}`, '!'];
  const vlans = Object.keys(c.vlans).map(Number).sort((a, b) => a - b);
  out.push('spanning-tree mode rapid-pvst', 'spanning-tree extend system-id');
  if (c.stpPriority !== undefined && c.stpPriority !== 32768 && vlans.length) out.push(`spanning-tree vlan ${fmtVlanList(vlans)} priority ${c.stpPriority}`);
  if (c.stpOff.length) out.push(`no spanning-tree vlan ${fmtVlanList(c.stpOff)}`);
  out.push('!');
  for (const v of vlans) out.push(`vlan ${v}`, ` name ${c.vlans[v]}`, '!');
  const keys = Object.keys(c.ifs).sort((a, b) => {
    const pa = a.startsWith('Po') ? 0 : 1;
    const pb = b.startsWith('Po') ? 0 : 1;
    return pa - pb || compareIf(a, b);
  });
  for (const k of keys) out.push(...ifBlock(k, c.ifs[k]), '!');
  for (const v of Object.keys(c.svis).map(Number).sort((a, b) => a - b)) out.push(...sviBlock(v, c.svis[v]), '!');
  out.push('end');
  return out;
}

const bytes = (lines: string[]) => lines.reduce((n, l) => n + l.length + 1, 0);

export function showRunningConfig(label: string, nd: NetDevice, only?: string): string[] {
  if (only) {
    const body = ['!', ...interfaceConfig(nd, only), 'end'];
    return ['Building configuration...', '', `Current configuration : ${bytes(body.slice(1))} bytes`, ...body];
  }
  const body = configBody(label, nd);
  return ['Building configuration...', '', `Current configuration : ${bytes(body)} bytes`, ...body];
}

export function showStartupConfig(label: string, nd: NetDevice): string[] {
  if (!nd.startup) return ['startup-config is not present'];
  let parts: ConfigParts;
  try {
    const p = JSON.parse(nd.startup) as Partial<ConfigParts>;
    parts = { ifs: p.ifs ?? {}, vlans: p.vlans ?? {}, svis: p.svis ?? {}, stpOff: p.stpOff ?? [], stpPriority: p.stpPriority ?? nd.stpPriority };
  } catch {
    return ['startup-config is not present'];
  }
  const body = configBody(label, parts);
  return [`Using ${bytes(body)} out of 33554432 bytes`, ...body];
}

