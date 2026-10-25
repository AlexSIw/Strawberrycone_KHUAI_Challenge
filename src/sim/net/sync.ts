// The once-per-change pass that turns state changes into syslog lines and refreshes the caches:
// interface up/down, err-disable (bpduguard), CRC on degraded cables, HSRP state changes, MAC flaps
// during a storm, port-channel bundling; then w.net.load / hsrpActive / storm. Idempotent.
// Called from step() (dt > 0), after every command / action (dt = 0), and after incidents inject.
// WP1 owns this file.
import type { World } from '../types';
import { own } from '../util';

const LOG_MAX = 100;

/** Append a syslog line to a device's buffer (`show logging`, the NMS syslog view). */
export function log(w: World, dev: string, tag: string, msg: string): void {
  const nd = own(w.devices, dev)?.nd;
  if (!nd) return;
  nd.log.push({ t: w.t, tag, msg });
  if (nd.log.length > LOG_MAX) nd.log.splice(0, nd.log.length - LOG_MAX);
}

export function syncNet(_w: World, _dt: number): void {
  // TODO(WP1)
}
