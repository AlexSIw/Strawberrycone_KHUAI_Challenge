// Power, cables and address arithmetic: the parts every other network module builds on.
import type { Device, World } from '../types';
import { own } from '../util';

// ---------- power (L0) ----------

/**
 * Does this PDU line carry electricity right now?
 * A sits behind the UPS (it survives a blackout); B is plain mains. A tripped PDU carries nothing.
 */
export function feedLive(w: World, f: 'A' | 'B'): boolean {
  const p = w.power;
  if (!p) return true;
  if (p.pduDown === f) return false;
  return p.mains || (f === 'A' && p.ups);
}

/** A device is on when it's mounted, plugged in, its rack isn't cut off, and one of its feeds is live. */
export function powered(w: World, id: string): boolean {
  const d = own(w.devices, id);
  if (!d) return false;
  if (d.kind === 'internet') return true;
  if (!w.power) return true;
  if (!d.installed) return false;
  if (d.rack && w.power.racksDown?.includes(d.rack)) return false;
  return d.feeds.some((f) => feedLive(w, f));
}

// ---------- L1: cables ----------

export function cableAt(w: World, endpoint: string) {
  return Object.values(w.cables).find((c) => c.a === endpoint || c.b === endpoint);
}

/** The other end of the cable plugged into `dev:port`, as [deviceId, port]; null when unplugged. */
export function cablePeer(w: World, dev: string, port: string): [string, string] | null {
  const ep = `${dev}:${port}`;
  const c = cableAt(w, ep);
  if (!c) return null;
  const other = c.a === ep ? c.b : c.a;
  const i = other.indexOf(':');
  return [other.slice(0, i), other.slice(i + 1)];
}

// ---------- L3: address arithmetic ----------

export function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, p) => (acc << 8) + (parseInt(p, 10) & 255), 0) >>> 0;
}

export function intToIp(n: number): string {
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
}

export function isIp(s: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every((p) => parseInt(p, 10) <= 255);
}

/** "localhost" / 127.0.0.1 always mean "this machine", with or without a network. */
export function isLoopback(s: string): boolean {
  return s === 'localhost' || s === '127.0.0.1';
}

export function maskBits(mask: number): number {
  return mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0;
}

/** 24 ↔ '255.255.255.0' */
export const maskToDotted = (mask: number): string => intToIp(maskBits(mask));
export function dottedToMask(dotted: string): number | null {
  if (!isIp(dotted)) return null;
  const n = ipToInt(dotted);
  const bits = n.toString(2).padStart(32, '0');
  return /^1*0*$/.test(bits) ? bits.indexOf('0') === -1 ? 32 : bits.indexOf('0') : null;
}

export function sameSubnet(a: string, b: string, mask: number): boolean {
  const m = maskBits(mask);
  return (ipToInt(a) & m) === (ipToInt(b) & m);
}

/** "10.0.1.0/24" for 10.0.1.1 and 24. */
export function networkOf(ip: string, mask: number): string {
  return `${intToIp((ipToInt(ip) & maskBits(mask)) >>> 0)}/${mask}`;
}

/** Is `ip` inside `cidr` ("10.20.0.0/16", "198.51.100.77/32", or "any")? */
export function inCidr(ip: string, cidr: string): boolean {
  if (cidr === 'any') return true;
  const [net, len] = cidr.split('/');
  return sameSubnet(ip, net, len === undefined ? 32 : parseInt(len, 10));
}

/** RFC 1918 private ranges (10/8, 172.16/12, 192.168/16). */
export const isPrivate = (ip: string): boolean => inCidr(ip, '10.0.0.0/8') || inCidr(ip, '172.16.0.0/12') || inCidr(ip, '192.168.0.0/16');

type Addr = { ip: string | null; gw: string | null; mask: number };

/** A host's configured address (servers, the admin PC). Network gear: see `nd`. */
export function addressOf(w: World, id: string): Addr {
  const d = own(w.devices, id);
  if (!d?.l3) return { ip: null, gw: null, mask: 24 };
  return { ip: d.l3.ip, gw: d.l3.gw, mask: d.l3.mask };
}

/** Hosts configured with this address (whether or not they are switched on). */
export function devicesWithIp(w: World, ip: string): Device[] {
  return Object.values(w.devices).filter((d) => addressOf(w, d.id).ip === ip);
}
