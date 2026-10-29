// Facade over the v2 network model (src/sim/net). Keeps the helpers the UI, mini-games and the
// shell commands have always imported from here.
import { isLoopback, powered } from './net/basics';
import { reach, resolve, type ReachFailure } from './net/reach';
import { operState } from './net/topo';
import type { Device, World } from './types';
import { own } from './util';

export * from './net';

/** Link LED: green when the port is operationally up (healthy cable, both ends powered, not shut / err-disabled). */
export function linkUp(w: World, deviceId: string, port: string): boolean {
  return operState(w, deviceId, port) === 'up';
}

/** Can a frame get from `from` to `to` over working cables? Only switches and routers forward. (Physical layer only.) */
export function l1Path(w: World, from: string, to: string): boolean {
  if (!powered(w, from) || !powered(w, to)) return false;
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const c of Object.values(w.cables)) {
      if (c.broken) continue;
      const [da] = c.a.split(':');
      const [db] = c.b.split(':');
      const n = da === cur ? db : db === cur ? da : null;
      if (!n || !powered(w, n)) continue;
      if (n === to) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      const kind = w.devices[n]?.kind;
      if (kind === 'switch' || kind === 'router' || kind === 'firewall') queue.push(n);
    }
  }
  return false;
}

/** Is the device switched on and plugged into a live link (so it can answer on the wire)? */
export function onWire(w: World, d: Device): boolean {
  if (d.kind === 'internet') return true;
  return powered(w, d.id) && d.ports.some((p) => linkUp(w, d.id, p));
}

/** Name → IP (DNS, case-insensitive), or the IP itself. */
export function resolveName(w: World, name: string, from?: string): string | null {
  return resolve(w, name, from).ip;
}

export type PingFailure = ReachFailure;

export interface PingResult {
  ok: boolean;
  /** Packet loss 0..1 */
  loss: number;
  failure?: PingFailure;
  targetIp?: string;
  targetId?: string;
}

/** Ping from one device to a name or address: DNS first, then the v2 reachability walk. */
export function ping(w: World, fromId: string, target: string): PingResult {
  if (!powered(w, fromId)) return { ok: false, loss: 1, failure: 'no_power' };
  if (isLoopback(target)) return { ok: true, loss: 0, targetIp: '127.0.0.1', targetId: fromId };
  const r = resolve(w, target, fromId);
  if (!r.ip) return { ok: false, loss: 1, failure: r.failure ?? 'unknown_host' };
  const res = reach(w, fromId, r.ip);
  return { ok: res.ok, loss: res.loss, failure: res.failure, targetIp: res.targetIp ?? r.ip, targetId: res.targetId };
}

/** Device id by id or by IOS hostname / label (case-insensitive). */
export function deviceByName(w: World, name: string): Device | undefined {
  return own(w.devices, name) ?? Object.values(w.devices).find((d) => d.id.toLowerCase() === name.toLowerCase() || d.label.toLowerCase() === name.toLowerCase());
}

