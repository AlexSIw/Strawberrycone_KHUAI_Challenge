import type { Device, World } from './types';

// ---------- power (L0) ----------

/** A device is on when it's mounted, plugged in, and its feed has electricity. */
export function powered(w: World, id: string): boolean {
  const d = w.devices[id];
  if (!d) return false;
  if (d.kind === 'internet') return true;
  if (!w.power) return true;
  if (!d.installed || d.feeds.length === 0) return false;
  if (w.power.mains) return true;
  // Blackout: only PDU A behind a connected UPS keeps power.
  return w.power.ups && d.feeds.includes('A');
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

// ---------- L3: addresses ----------

export function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, p) => (acc << 8) + (parseInt(p, 10) & 255), 0) >>> 0;
}

export function isIp(s: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
}

export function sameSubnet(a: string, b: string, mask: number): boolean {
  const m = mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0;
  return (ipToInt(a) & m) === (ipToInt(b) & m);
}

/** Current address of a device (DHCP devices get theirs from applyDhcp). */
export function addressOf(w: World, id: string): { ip: string | null; gw: string | null; mask: number } {
  const d = w.devices[id];
  if (!d?.l3) return { ip: null, gw: null, mask: 24 };
  return { ip: d.l3.ip, gw: d.l3.gw, mask: d.l3.mask };
}

export function devicesWithIp(w: World, ip: string): Device[] {
  return Object.values(w.devices).filter((d) => addressOf(w, d.id).ip === ip);
}

export function duplicateIps(w: World): string[] {
  const seen = new Map<string, number>();
  for (const d of Object.values(w.devices)) {
    const ip = addressOf(w, d.id).ip;
    if (ip) seen.set(ip, (seen.get(ip) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([ip]) => ip);
}

export function resolveName(w: World, name: string): string | null {
  if (isIp(name)) return name;
  return w.net?.dns[name] ?? null;
}

/** Router id (first router device). */
function routerId(w: World): string | undefined {
  return Object.values(w.devices).find((d) => d.kind === 'router')?.id;
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
 * Ping from one device to a name or address.
 * Checks, in order: power → own address → DNS → which device owns the IP →
 * L1 path → gateway (when the target is in another network).
 */
export function ping(w: World, fromId: string, target: string): PingResult {
  if (!powered(w, fromId)) return { ok: false, loss: 1, failure: 'no_power' };
  const from = w.devices[fromId];
  const src = from.kind === 'internet' ? { ip: '8.8.8.8', gw: null, mask: 0 } : addressOf(w, fromId);
  if (!src.ip) return { ok: false, loss: 1, failure: 'no_ip' };

  const ip = resolveName(w, target);
  if (!ip) return { ok: false, loss: 1, failure: 'unknown_host' };

  // The outside world.
  const internet = Object.values(w.devices).find((d) => d.kind === 'internet');
  const targetIsInternet = ip === '8.8.8.8';
  const owners = targetIsInternet && internet ? [internet] : devicesWithIp(w, ip);
  if (owners.length === 0) return { ok: false, loss: 1, failure: 'no_route', targetIp: ip };
  const dst = owners[0];
  const dstAddr = dst.kind === 'internet' ? { ip: '8.8.8.8', gw: null, mask: 0 } : addressOf(w, dst.id);

  if (!l1Path(w, fromId, dst.id)) return { ok: false, loss: 1, failure: 'link', targetIp: ip, targetId: dst.id };

  const net = w.net;
  const local =
    from.kind !== 'internet' && dst.kind !== 'internet' && net ? sameSubnet(src.ip, ip, net.mask) : false;
  if (!local && net) {
    // Traffic crosses the router: whichever side lives inside needs a correct gateway.
    const r = routerId(w);
    const inside = from.kind === 'internet' ? dstAddr : src;
    if (!r || !powered(w, r) || inside.gw !== net.routerIp) {
      return { ok: false, loss: 1, failure: 'gateway', targetIp: ip, targetId: dst.id };
    }
  }

  if (owners.length > 1) return { ok: true, loss: 0.5, failure: 'conflict', targetIp: ip, targetId: dst.id };
  return { ok: true, loss: 0, targetIp: ip, targetId: dst.id };
}

/** Assign DHCP leases to every DHCP device (called when the DHCP server is on). */
export function applyDhcp(w: World): void {
  if (!w.net) return;
  for (const d of Object.values(w.devices)) {
    if (!d.l3 || d.l3.mode !== 'dhcp') continue;
    if (w.net.dhcpServer && powered(w, d.id)) {
      d.l3.ip = w.net.dhcpLeases[d.id] ?? null;
      d.l3.gw = w.net.routerIp;
      d.l3.mask = w.net.mask;
    } else if (!w.net.dhcpServer) {
      d.l3.ip = null;
      d.l3.gw = null;
    }
  }
}
