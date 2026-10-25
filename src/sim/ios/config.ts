// Config-mode mutations. Every change goes through `dirty()` so nd.dirty is set and the session
// knows to log %SYS-5-CONFIG_I on the way out of config mode.
import { yellow } from '../commands/types';
import { dottedToMask, maskToDotted, networkOf, sameSubnet } from '../net/basics';
import { longIf } from '../net/ifname';
import { log } from '../net/sync';
import type { Iface, IosLevel, IosMode, NetDevice, Svi } from '../types';
import { isConfigLevel, type Ctx } from './parse';

export const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

export function dirty(c: Ctx): void {
  c.nd.dirty = true;
  c.changed = true;
}

/** Move to another mode, carrying the "changed in this config session" flag while staying in config. */
export function go(c: Ctx, level: IosLevel, extra: Partial<IosMode> = {}): void {
  const changed = c.mode.changed || c.changed;
  c.next = isConfigLevel(level) ? { level, ...extra, ...(changed ? { changed: true } : {}) } : { level, ...extra };
}

export const defaultVlanName = (v: number) => `VLAN${String(v).padStart(4, '0')}`;

/** The config snapshot `write memory` stores (same shape as the topology's saved config). */
export function snapshot(nd: NetDevice): string {
  return JSON.stringify({ ifs: nd.ifs, vlans: nd.vlans, svis: nd.svis, stpOff: nd.stpOff }, (k, v) => (k.startsWith('_') ? undefined : v));
}

export function save(c: Ctx, viaCopy: boolean): void {
  if (viaCopy) c.out.push('Destination filename [startup-config]? ');
  c.out.push('Building configuration...', '[OK]');
  c.nd.dirty = false;
  c.nd.startup = snapshot(c.nd);
}

/** The vty source address in syslog lines: the admin PC. */
export function vtySource(c: Ctx): string {
  const ip = c.w.devices.ops?.l3?.ip;
  return ip ? ` (${ip})` : '';
}

export function logConfigured(c: Ctx): void {
  log(c.w, c.host, 'SYS-5-CONFIG_I', `Configured from console by admin on vty0${vtySource(c)}`);
}

// ---------- interface targets ----------

export const isSviKey = (k: string) => /^Vlan\d+$/.test(k);
export const isPoKey = (k: string) => /^Po\d+$/.test(k);
export const sviNum = (k: string) => parseInt(k.slice(4), 10);
const targets = (c: Ctx) => c.mode.ifs ?? [];

/** Physical / Po interfaces being configured. With `members`, a Po's members get the same change (IOS inheritance). */
export function eachIf(c: Ctx, fn: (f: Iface, k: string) => void, members = false): void {
  for (const k of targets(c)) {
    if (isSviKey(k)) continue;
    const f = c.nd.ifs[k];
    if (!f) continue;
    fn(f, k);
    if (members && isPoKey(k)) {
      const n = parseInt(k.slice(2), 10);
      for (const [mk, m] of Object.entries(c.nd.ifs)) if (m.group === n) fn(m, mk);
    }
  }
  dirty(c);
}

export function eachSvi(c: Ctx, fn: (s: Svi, v: number) => void): void {
  for (const k of targets(c)) {
    if (!isSviKey(k)) continue;
    const s = c.nd.svis[sviNum(k)];
    if (s) fn(s, sviNum(k));
  }
  dirty(c);
}

/** Make sure VLAN v exists (switchport access vlan creates it, like IOS). */
export function ensureVlan(c: Ctx, v: number, announce: boolean): void {
  if (v === 1 || v in c.nd.vlans) return;
  c.nd.vlans[v] = defaultVlanName(v);
  if (announce) c.out.push(yellow(`% Access VLAN does not exist. Creating vlan ${v}`));
}

// ---------- interface / vlan commands ----------

export function enterInterface(c: Ctx, k: string): void {
  const nd = c.nd;
  if (isSviKey(k)) {
    const v = sviNum(k);
    if (!nd.svis[v]) {
      nd.svis[v] = { ip: null, mask: 24, shutdown: false };
      dirty(c);
    }
    go(c, 'config-if', { ifs: [k], vlan: v });
    return;
  }
  if (isPoKey(k) && !nd.ifs[k]) {
    nd.ifs[k] = { shutdown: false, errDisabled: null, mode: 'access', accessVlan: 1, allowed: 'all', speed: 10000, crc: 0 };
    dirty(c);
  }
  go(c, 'config-if', { ifs: [k] });
}

export function noInterface(c: Ctx, k: string): void {
  const nd = c.nd;
  if (isSviKey(k)) {
    delete nd.svis[sviNum(k)];
  } else if (isPoKey(k)) {
    const n = parseInt(k.slice(2), 10);
    delete nd.ifs[k];
    for (const f of Object.values(nd.ifs)) {
      if (f.group === n) {
        delete f.group;
        delete f.chMode;
      }
    }
  } else {
    c.out.push(red('% Physical interfaces cannot be removed.'));
    return;
  }
  dirty(c);
}

export function createVlans(c: Ctx, vs: number[]): void {
  for (const v of vs) if (v !== 1 && !(v in c.nd.vlans)) c.nd.vlans[v] = defaultVlanName(v);
  dirty(c);
  go(c, 'config-vlan', vs.length === 1 ? { vlan: vs[0] } : {});
}

export function deleteVlans(c: Ctx, vs: number[]): void {
  for (const v of vs) {
    if (v === 1) c.out.push(red('%Default VLAN 1 may not be deleted.'));
    else delete c.nd.vlans[v];
  }
  dirty(c);
}

export function setVlanName(c: Ctx, name: string | null): void {
  const v = c.mode.vlan;
  if (v === undefined) {
    c.out.push(red('% name can only be set for one VLAN at a time.'));
    return;
  }
  if (v === 1) {
    c.out.push(red('%Default VLAN 1 may not have its name changed.'));
    return;
  }
  c.nd.vlans[v] = name ? name.slice(0, 32) : defaultVlanName(v);
  dirty(c);
}

// ---------- switchport ----------

export function setTrunkAllowed(c: Ctx, op: 'set' | 'add' | 'remove' | 'all' | 'none', vs: number[] = []): void {
  const existing = () => [1, ...Object.keys(c.nd.vlans).map(Number)];
  eachIf(
    c,
    (f) => {
      if (op === 'all') f.allowed = 'all';
      else if (op === 'none') f.allowed = [];
      else if (op === 'set') f.allowed = [...vs];
      else if (op === 'add') f.allowed = f.allowed === 'all' ? 'all' : [...new Set([...f.allowed, ...vs])].sort((a, b) => a - b);
      else {
        const base = f.allowed === 'all' ? existing() : f.allowed;
        f.allowed = base.filter((v) => !vs.includes(v)).sort((a, b) => a - b);
      }
    },
    true,
  );
}

export function channelGroup(c: Ctx, n: number, mode: 'active' | 'passive' | 'on'): void {
  const po = `Po${n}`;
  for (const k of c.mode.ifs ?? []) {
    if (isSviKey(k) || isPoKey(k)) continue;
    const f = c.nd.ifs[k];
    if (!f) continue;
    const p = c.nd.ifs[po];
    if (!p) {
      c.nd.ifs[po] = { shutdown: false, errDisabled: null, mode: f.mode, accessVlan: f.accessVlan, allowed: f.allowed === 'all' ? 'all' : [...f.allowed], speed: f.speed, crc: 0 };
      c.out.push(`Creating a port-channel interface Port-channel ${n}`);
    } else {
      // A new member takes the bundle's L2 settings.
      f.mode = p.mode;
      f.accessVlan = p.accessVlan;
      f.allowed = p.allowed === 'all' ? 'all' : [...p.allowed];
    }
    f.group = n;
    f.chMode = mode;
  }
  dirty(c);
}

// ---------- L3 ----------

/** Other L3 addresses on the device that overlap A/M ("% 10.10.10.0 overlaps with Vlan20"). */
function overlap(nd: NetDevice, self: string, a: string, m: number): string | null {
  for (const [v, s] of Object.entries(nd.svis)) {
    const k = `Vlan${v}`;
    if (k !== self && s.ip && sameSubnet(a, s.ip, Math.min(m, s.mask))) return k;
  }
  for (const [k, f] of Object.entries(nd.ifs)) {
    if (k !== self && f.mode === 'routed' && f.ip && sameSubnet(a, f.ip.addr, Math.min(m, f.ip.mask))) return longIf(k);
  }
  return null;
}

export function ipAddress(c: Ctx, addr: string, dotted: string): void {
  const m = dottedToMask(dotted);
  if (m === null || m === 0) {
    c.out.push(red(`% Bad mask ${dotted} for address ${addr}`));
    return;
  }
  for (const k of c.mode.ifs ?? []) {
    const clash = overlap(c.nd, k, addr, m);
    if (clash) {
      c.out.push(red(`% ${networkOf(addr, m).split('/')[0]} overlaps with ${clash}`));
      continue;
    }
    if (isSviKey(k)) {
      const s = c.nd.svis[sviNum(k)];
      if (s?.hsrp?.vip === addr) {
        c.out.push(red('% address cannot equal the standby virtual IP address'));
        continue;
      }
      if (s) {
        s.ip = addr;
        s.mask = m;
        dirty(c);
      }
      continue;
    }
    const f = c.nd.ifs[k];
    if (!f) continue;
    if (f.mode !== 'routed') {
      c.out.push(red('% IP addresses may not be configured on L2 links.'));
      continue;
    }
    f.ip = { addr, mask: m };
    dirty(c);
  }
}

export function noIpAddress(c: Ctx): void {
  for (const k of c.mode.ifs ?? []) {
    if (isSviKey(k)) {
      const s = c.nd.svis[sviNum(k)];
      if (s) s.ip = null;
    } else if (c.nd.ifs[k]) delete c.nd.ifs[k].ip;
  }
  dirty(c);
}

export function standby(c: Ctx, g: number, change: { vip?: string; priority?: number; preempt?: boolean }): void {
  eachSvi(c, (s) => {
    if (change.vip !== undefined && change.vip) {
      if (s.ip === change.vip) {
        c.out.push(red('% address cannot equal interface IP address'));
        return;
      }
      if (s.ip && !sameSubnet(change.vip, s.ip, s.mask)) {
        c.out.push(red(`% Warning: address is not within a subnet on this interface (${s.ip} ${maskToDotted(s.mask)})`));
        return;
      }
    }
    const h = s.hsrp ?? { group: g, vip: '', priority: 100, preempt: false };
    h.group = g;
    if (change.vip !== undefined) h.vip = change.vip;
    if (change.priority !== undefined) h.priority = change.priority;
    if (change.preempt !== undefined) h.preempt = change.preempt;
    s.hsrp = h;
  });
}

export function noStandby(c: Ctx, g: number): void {
  eachSvi(c, (s) => {
    if (s.hsrp && s.hsrp.group === g) delete s.hsrp;
  });
}

