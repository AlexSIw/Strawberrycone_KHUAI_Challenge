// The once-per-change pass that turns state changes into syslog lines and refreshes the caches:
// interface up/down, err-disable (bpduguard), CRC on degraded cables, HSRP state changes, MAC flaps
// during a storm, port-channel bundling; then w.net.load / hsrpActive / storm. Idempotent.
// Called from step() (dt > 0), after every command / action (dt = 0), and after incidents inject.
// The very first sync of a world only initialises the edge-detect caches (no log lines).
// WP1 owns this file.
import type { IfOper, World } from '../types';
import { own } from '../util';
import { powered } from './basics';
import { electHsrp, sviUp } from './hsrp';
import { longIf } from './ifname';
import { computeLoad } from './load';
import { allVlans, runsStp, stpView, vlanGraph } from './stp';
import { bundled, effIface, isSwitch, operState, peerOf, portKey, resetNetMemo, withNetMemo, type Port } from './topo';

const LOG_MAX = 100;
/** CRC errors per second on each end of a degraded cable. */
export const CRC_PER_SEC = 3;
/** One MAC-flap line per switch per this many seconds during a storm. */
const MACFLAP_EVERY = 10;

/** Append a syslog line to a device's buffer (`show logging`, the NMS syslog view). */
export function log(w: World, dev: string, tag: string, msg: string): void {
  const nd = own(w.devices, dev)?.nd;
  if (!nd) return;
  nd.log.push({ t: w.t, tag, msg });
  if (nd.log.length > LOG_MAX) nd.log.splice(0, nd.log.length - LOG_MAX);
}

/** Does this switch port send BPDUs (its switch runs STP for a VLAN the port carries)? */
function sendsBpdu(w: World, p: Port): boolean {
  const nd = own(w.devices, p.dev)?.nd;
  const f = effIface(w, p);
  if (!nd || !f || f.mode === 'routed') return false;
  if (f.mode === 'access') return !nd.stpOff.includes(f.accessVlan);
  const vlans = Object.keys(nd.vlans).map(Number);
  return vlans.some((v) => (f.allowed === 'all' || f.allowed.includes(v)) && !nd.stpOff.includes(v));
}

function ifLines(w: World, dev: string, ifn: string, prev: IfOper, now: IfOper): void {
  const name = longIf(ifn);
  if (now === 'up') {
    log(w, dev, 'LINK-3-UPDOWN', `Interface ${name}, changed state to up`);
    log(w, dev, 'LINEPROTO-5-UPDOWN', `Line protocol on Interface ${name}, changed state to up`);
    return;
  }
  if (now === 'admin-down') log(w, dev, 'LINK-5-CHANGED', `Interface ${name}, changed state to administratively down`);
  else log(w, dev, 'LINK-3-UPDOWN', `Interface ${name}, changed state to down`);
  if (prev === 'up') log(w, dev, 'LINEPROTO-5-UPDOWN', `Line protocol on Interface ${name}, changed state to down`);
}

/** A made-up but stable MAC for a device ('0050.56xx.xxxx', VMware-style). */
function macOf(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hex = (h & 0xffffff).toString(16).padStart(6, '0');
  return `0050.56${hex.slice(0, 2)}.${hex.slice(2)}`;
}

const isFirstSync = (w: World) => !Object.values(w.devices).some((d) => d.nd && Object.values(d.nd.ifs).some((f) => f._oper !== undefined));

export function syncNet(w: World, dt: number): void {
  const net = w.net;
  if (!net) return;
  withNetMemo(w, () => {
    const quiet = isFirstSync(w);
    const say = (dev: string, tag: string, msg: string) => {
      if (!quiet && powered(w, dev)) log(w, dev, tag, msg);
    };
    const gear = Object.values(w.devices).filter((d) => d.nd);

    // 1. bpduguard: a guarded access port that hears BPDUs from a switch shuts itself down. Decided on
    //    the state before any port trips, so both ends of a switch-to-switch cable can trip together.
    const trip: [string, string][] = [];
    for (const d of gear) {
      if (!isSwitch(w, d.id)) continue;
      for (const [ifn, f] of Object.entries(d.nd!.ifs)) {
        if (!f.bpduguard || f.errDisabled || f.mode !== 'access' || operState(w, d.id, ifn) !== 'up') continue;
        const peer = peerOf(w, { dev: d.id, ifn });
        if (peer && isSwitch(w, peer.dev) && sendsBpdu(w, peer)) trip.push([d.id, ifn]);
      }
    }
    for (const [dev, ifn] of trip) {
      w.devices[dev].nd!.ifs[ifn].errDisabled = 'bpduguard';
      say(dev, 'SPANTREE-2-BLOCK_BPDUGUARD', `Received BPDU on port ${ifn} with BPDU Guard enabled. Disabling port.`);
      say(dev, 'PM-4-ERR_DISABLE', `bpduguard error detected on ${ifn}, putting ${ifn} in err-disable state`);
    }
    if (trip.length) resetNetMemo(w);

    // 2. CRC errors climb on both ends of a degraded cable while it is up.
    if (dt > 0) {
      for (const c of Object.values(w.cables)) {
        if (!c.degraded || c.broken) continue;
        for (const ep of [c.a, c.b]) {
          const i = ep.indexOf(':');
          const [dev, ifn] = [ep.slice(0, i), ep.slice(i + 1)];
          const f = own(own(w.devices, dev)?.nd?.ifs, ifn);
          if (f && operState(w, dev, ifn) === 'up') f.crc += CRC_PER_SEC * dt;
        }
      }
    }

    // 3. Interfaces up/down, port-channel members joining / leaving.
    for (const d of gear) {
      for (const [ifn, f] of Object.entries(d.nd!.ifs)) {
        const now = operState(w, d.id, ifn);
        if (f._oper !== now) {
          if (f._oper !== undefined && !quiet && powered(w, d.id)) ifLines(w, d.id, ifn, f._oper, now);
          f._oper = now;
        }
        if (f.group === undefined && f._inPo == null) continue;
        const po = f.group !== undefined && bundled(w, d.id, ifn) ? f.group : null;
        if (f._inPo !== po) {
          if (f._inPo !== undefined) {
            if (f._inPo != null) say(d.id, 'EC-5-UNBUNDLE', `Interface ${ifn} left the port-channel Po${f._inPo}`);
            if (po !== null) say(d.id, 'EC-5-BUNDLE', `Interface ${ifn} joined port-channel Po${po}`);
          }
          f._inPo = po;
        }
      }
    }

    // 4. Spanning tree: storms, with MAC flaps (one line per switch per 10 s).
    const storm: number[] = [];
    for (const v of allVlans(w)) {
      const stp = stpView(w, v);
      if (!stp.storm) continue;
      storm.push(v);
      const g = vlanGraph(w, v);
      const host = g.nodes.find((n) => !isSwitch(w, n)) ?? g.nodes[0] ?? 'host';
      for (const end of stp.loops.flat()) {
        if (!isSwitch(w, end.dev) || runsStp(w, end.dev, v)) continue;
        const nd = own(w.devices, end.dev)!.nd!;
        const last = [...nd.log].reverse().find((e) => e.tag === 'SW_MATM-4-MACFLAP_NOTIF');
        if (last && w.t - last.t < MACFLAP_EVERY) continue;
        const other = (g.adj.get(end.dev) ?? []).map((h) => h.near.ifn).find((i) => portKey({ dev: end.dev, ifn: i }) !== portKey(end)) ?? end.ifn;
        say(end.dev, 'SW_MATM-4-MACFLAP_NOTIF', `Host ${macOf(host)} in vlan ${v} is flapping between port ${end.ifn} and port ${other}`);
      }
    }
    net.storm = storm;

    // 5. SVIs (IOS autostate).
    for (const d of gear) {
      for (const [v, s] of Object.entries(d.nd!.svis)) {
        const up = sviUp(w, d.id, Number(v));
        if (s._up === up) continue;
        if (s._up !== undefined) {
          const name = `Vlan${v}`;
          if (up) {
            say(d.id, 'LINK-3-UPDOWN', `Interface ${name}, changed state to up`);
            say(d.id, 'LINEPROTO-5-UPDOWN', `Line protocol on Interface ${name}, changed state to up`);
          } else {
            if (s.shutdown) say(d.id, 'LINK-5-CHANGED', `Interface ${name}, changed state to administratively down`);
            say(d.id, 'LINEPROTO-5-UPDOWN', `Line protocol on Interface ${name}, changed state to down`);
          }
        }
        s._up = up;
      }
    }

    // 6. HSRP: one active router per VLAN, remembered for preempt.
    const hsrpVlans = new Set<number>();
    for (const d of gear) for (const [v, s] of Object.entries(d.nd!.svis)) if (s.hsrp) hsrpVlans.add(Number(v));
    for (const k of Object.keys(net.hsrpActive)) if (!hsrpVlans.has(Number(k))) net.hsrpActive[Number(k)] = null;
    for (const v of [...hsrpVlans].sort((a, b) => a - b)) {
      const prev = net.hsrpActive[v] ?? null;
      const next = electHsrp(w, v, prev);
      if (next !== prev) {
        const grp = (id: string | null) => (id && own(w.devices, id)?.nd?.svis[v]?.hsrp?.group) ?? 1;
        if (next) say(next, 'HSRP-5-STATECHANGE', `Vlan${v} Grp ${grp(next)} state Standby -> Active`);
        if (prev) say(prev, 'HSRP-5-STATECHANGE', `Vlan${v} Grp ${grp(prev)} state Active -> ${sviUp(w, prev, v) ? 'Speak' : 'Init'}`);
      }
      net.hsrpActive[v] = next;
    }

    // 7. Link loads.
    net.load = computeLoad(w);
  });
}
