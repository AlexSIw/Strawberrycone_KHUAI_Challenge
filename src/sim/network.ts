import type { Device, World } from './types';
import { own } from './util';

// ---------- power (L0) ----------

/**
 * Does this PDU line carry electricity right now?
 * A sits behind the UPS (it survives a blackout once the UPS is connected); B is plain mains.
 * A tripped PDU carries nothing, whatever is in front of it.
 */
export function feedLive(w: World, f: 'A' | 'B'): boolean {
  const p = w.power;
  if (!p) return true;
  if (p.pduDown === f) return false;
  return p.mains || (f === 'A' && p.ups);
}

/** A device is on when it's mounted, plugged in, and at least one of its feeds has electricity. */
export function powered(w: World, id: string): boolean {
  const d = own(w.devices, id);
  if (!d) return false;
  if (d.kind === 'internet') return true;
  if (!w.power) return true;
  if (!d.installed) return false;
  return d.feeds.some((f) => feedLive(w, f));
}

// ---------- L1: cables ----------

export function cableAt(w: World, endpoint: string) {
  return Object.values(w.cables).find((c) => c.a === endpoint || c.b === endpoint);
}

/** Link LED: green when a healthy cable connects two powered devices. */
export function linkUp(w: World, deviceId: string, port: string): boolean {
  const c = cableAt(w, `${deviceId}:${port}`);
  if (!c || c.broken) return false;
  const other = (c.a === `${deviceId}:${port}` ? c.b : c.a).split(':')[0];
  return powered(w, deviceId) && powered(w, other);
}

function neighbors(w: World, id: string): string[] {
  const out: string[] = [];
  for (const c of Object.values(w.cables)) {
    if (c.broken) continue;
    const [da] = c.a.split(':');
    const [db] = c.b.split(':');
    if (da === id && powered(w, db)) out.push(db);
    if (db === id && powered(w, da)) out.push(da);
  }
  return out;
}

/** Can a frame get from `from` to `to` over working cables? Only switches and routers forward. */
export function l1Path(w: World, from: string, to: string): boolean {
  if (!powered(w, from) || !powered(w, to)) return false;
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of neighbors(w, cur)) {
      if (n === to) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      const kind = w.devices[n]?.kind;
      if (kind === 'switch' || kind === 'router') queue.push(n);
    }
  }
  return false;
}

/** Is the device switched on and plugged into a live link (so it can answer on the wire)? */
export function onWire(w: World, d: Device): boolean {
  if (d.kind === 'internet') return true;
  return powered(w, d.id) && d.ports.some((p) => linkUp(w, d.id, p));
}

// ---------- L3: addresses ----------

type Addr = { ip: string | null; gw: string | null; mask: number };

const INTERNET_ADDR: Addr = { ip: '8.8.8.8', gw: null, mask: 0 };

export function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, p) => (acc << 8) + (parseInt(p, 10) & 255), 0) >>> 0;
}

function intToIp(n: number): string {
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
}

export function isIp(s: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
}

/** "localhost" / 127.0.0.1 always mean "this machine", with or without a network. */
export function isLoopback(s: string): boolean {
  return s === 'localhost' || s === '127.0.0.1';
}

function maskBits(mask: number): number {
  return mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0;
}

export function sameSubnet(a: string, b: string, mask: number): boolean {
  const m = maskBits(mask);
  return (ipToInt(a) & m) === (ipToInt(b) & m);
}

/** "10.0.1.0/24" for 10.0.1.1 and 24. */
export function networkOf(ip: string, mask: number): string {
  return `${intToIp((ipToInt(ip) & maskBits(mask)) >>> 0)}/${mask}`;
}

/** Current address of a device (DHCP devices get theirs from applyDhcp). */
export function addressOf(w: World, id: string): Addr {
  const d = own(w.devices, id);
  if (!d?.l3) return { ip: null, gw: null, mask: 24 };
  return { ip: d.l3.ip, gw: d.l3.gw, mask: d.l3.mask };
}

/** Devices configured with this address (whether or not they are switched on). */
export function devicesWithIp(w: World, ip: string): Device[] {
  return Object.values(w.devices).filter((d) => addressOf(w, d.id).ip === ip);
}

/**
 * Addresses claimed by more than one live device. A switched-off or unplugged box can't answer
 * on the wire, so it can't steal anyone's packets.
 */
export function duplicateIps(w: World): string[] {
  const seen = new Map<string, number>();
  for (const d of Object.values(w.devices)) {
    const ip = addressOf(w, d.id).ip;
    if (ip && onWire(w, d)) seen.set(ip, (seen.get(ip) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([ip]) => ip);
}

export function resolveName(w: World, name: string): string | null {
  if (isIp(name)) return name;
  return own(w.net?.dns, name) ?? null;
}

/** Router id (first router device). */
function routerId(w: World): string | undefined {
  return Object.values(w.devices).find((d) => d.kind === 'router')?.id;
}

/** The router's own inside address: the gateway every inside machine should use. */
export function routerAddress(w: World): string | null {
  const r = routerId(w);
  return r ? addressOf(w, r).ip : null;
}

export type PingFailure = 'no_power' | 'no_ip' | 'unknown_host' | 'no_route' | 'link' | 'gateway' | 'conflict';

export interface PingResult {
  ok: boolean;
  /** Packet loss 0..1 */
  loss: number;
  failure?: PingFailure;
  targetIp?: string;
  targetId?: string;
}

/**
 * Traffic between two different networks has to cross the router.
 * Our router joins exactly one inside network (net.routerIp/net.mask) with the internet, so:
 * - one end must be the internet (two inside networks can't be joined by it);
 * - every inside end must sit in the router's network and use the router's real address as its gateway;
 * - the router itself is on both sides and needs no gateway.
 */
function crossesRouter(w: World, mask: number, from: Device, src: Addr, dst: Device, dstAddr: Addr): boolean {
  const r = routerId(w);
  if (!r || !powered(w, r)) return false;
  if (from.kind !== 'internet' && dst.kind !== 'internet') return false;
  const rIp = addressOf(w, r).ip;
  const reaches = (d: Device, a: Addr) =>
    d.kind === 'internet' || d.id === r || (!!a.ip && !!rIp && a.gw === rIp && sameSubnet(a.ip, rIp, mask));
  return reaches(from, src) && reaches(dst, dstAddr);
}

/**
 * Ping from one device to a name or address.
 * Checks, in order: power → own address → DNS → which live device owns the IP →
 * L1 path → gateway (when the target is in another network).
 */
export function ping(w: World, fromId: string, target: string): PingResult {
  if (!powered(w, fromId)) return { ok: false, loss: 1, failure: 'no_power' };
  // Loopback never leaves the machine, so it works even without an address.
  if (isLoopback(target)) return { ok: true, loss: 0, targetIp: '127.0.0.1', targetId: fromId };
  const from = w.devices[fromId];
  const src = from.kind === 'internet' ? INTERNET_ADDR : addressOf(w, fromId);
  if (!src.ip) return { ok: false, loss: 1, failure: 'no_ip' };

  const ip = resolveName(w, target);
  if (!ip) return { ok: false, loss: 1, failure: 'unknown_host' };

  // The outside world.
  const internet = Object.values(w.devices).find((d) => d.kind === 'internet');
  const all = ip === INTERNET_ADDR.ip && internet ? [internet] : devicesWithIp(w, ip);
  if (all.length === 0) return { ok: false, loss: 1, failure: 'no_route', targetIp: ip };
  // Only machines that are on and reachable over working cables answer; a switched-off twin can't.
  const owners = all.filter((d) => d.id === fromId || l1Path(w, fromId, d.id));
  if (owners.length === 0) return { ok: false, loss: 1, failure: 'link', targetIp: ip, targetId: all[0].id };
  const dst = owners[0];
  const dstAddr = dst.kind === 'internet' ? INTERNET_ADDR : addressOf(w, dst.id);

  const net = w.net;
  if (net) {
    const local = from.kind !== 'internet' && dst.kind !== 'internet' && sameSubnet(src.ip, ip, net.mask);
    if (!local && !crossesRouter(w, net.mask, from, src, dst, dstAddr)) {
      return { ok: false, loss: 1, failure: 'gateway', targetIp: ip, targetId: dst.id };
    }
  }

  if (owners.length > 1) return { ok: true, loss: 0.5, failure: 'conflict', targetIp: ip, targetId: dst.id };
  return { ok: true, loss: 0, targetIp: ip, targetId: dst.id };
}

/**
 * While the DHCP server is on, every powered DHCP-mode device gets its lease and the router's address
 * as gateway. When the server goes off, devices keep the lease they already have; only a device asking
 * for a new one (ip set dhcp) is left without an address.
 */
export function applyDhcp(w: World): void {
  const net = w.net;
  if (!net?.dhcpServer) return;
  const gw = routerAddress(w) ?? net.routerIp;
  for (const d of Object.values(w.devices)) {
    if (!d.l3 || d.l3.mode !== 'dhcp' || !powered(w, d.id)) continue;
    d.l3.ip = own(net.dhcpLeases, d.id) ?? null;
    d.l3.gw = gw;
    d.l3.mask = net.mask;
  }
}
