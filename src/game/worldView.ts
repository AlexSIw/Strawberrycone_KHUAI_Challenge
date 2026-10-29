// Pure read-only views of the simulation for the map visuals (LED colours, indicators) and the NOC.
import type { StageDef } from '../content/types';
import { cableAt, compareIf, operState, powered, stpView } from '../sim/network';
import type { Cable, Device, World } from '../sim/types';

/** `crc` = green/amber alternating (CRC errors rising). */
export type LedState = 'green' | 'amber' | 'red' | 'off' | 'crc';

export const LED_COLOR: Record<LedState, number> = {
  green: 0x4fd17a,
  amber: 0xffb547,
  red: 0xff4a4f,
  off: 0x2c2e36,
  crc: 0x4fd17a,
};

/** How an LED looks on blink tick `blink`: green flickers like traffic, red flashes, CRC alternates green/amber, amber/off stay steady. */
export function ledLook(state: LedState, blink: number, phase: number): { color: number; alpha: number } {
  const t = blink + phase;
  if (state === 'green') return { color: LED_COLOR.green, alpha: t % 3 === 0 ? 0.4 : 1 };
  if (state === 'red') return { color: LED_COLOR.red, alpha: t % 2 === 0 ? 1 : 0.4 };
  if (state === 'crc') return { color: blink % 2 === 0 ? LED_COLOR.green : LED_COLOR.amber, alpha: 1 };
  return { color: LED_COLOR[state], alpha: 1 };
}

export interface RackSlotView {
  id: string;
  label: string;
  installed: boolean;
  led: LedState;
}

/** The switch the cable game plugs into and the map shows today. */
export const mapSwitchOf = (def: StageDef): string => def.mapSwitch ?? 'TOR-01';

/** Devices the mini-games and the map work with today (fallback: every rack-mounted server). */
export function mapDevicesOf(def: StageDef, w: World): Device[] {
  if (def.mapDevices) return def.mapDevices.flatMap((id) => (w.devices[id] ? [w.devices[id]] : []));
  return Object.values(w.devices).filter((d) => d.kind === 'server' && !!d.rack);
}

/** A device's network card endpoint ('web:eth0'). */
const nicOf = (d: Device): string => `${d.id}:${d.ports[0] ?? 'eth0'}`;
const otherEnd = (c: Cable, endpoint: string): string => (c.a === endpoint ? c.b : c.a);
const devOf = (endpoint: string): string => endpoint.slice(0, endpoint.indexOf(':'));

/** The switch's server ports on the cable window's faceplate (its Te ports are the uplinks to the cores). */
const SERVER_PORT = /^Gi\d+\/\d+\/\d+$/;

/** What the cable window (CableGame) shows today. */
export interface CableBoard {
  /** The switch on the right */
  sw: string;
  /** Its ports on the faceplate: the server (Gi) ports, plus every cabled port when repairing (uplinks) */
  ports: string[];
  /** Today's servers on the left (also the ones still in their boxes) */
  servers: Device[];
  /** Repairing only: the switch's other cables (uplinks to the cores, other servers), named by their far end */
  others: { cable: Cable; dev: string; port: string }[];
}

export function cableBoard(def: StageDef, w: World, mode: 'build' | 'repair'): CableBoard {
  const sw = mapSwitchOf(def);
  // Today's servers; without a list, the ones that belong on this switch (cabled to it, or not cabled yet).
  const servers = mapDevicesOf(def, w).filter((d) => {
    if (d.kind !== 'server' || d.id === 'ops') return false;
    if (def.mapDevices) return true;
    const c = cableAt(w, nicOf(d));
    return !c || devOf(otherEnd(c, nicOf(d))) === sw;
  });
  const device = w.devices[sw];
  const ports = (device ? physicalPorts(device) : []).filter((p) => SERVER_PORT.test(p) || (mode === 'repair' && !!cableAt(w, `${sw}:${p}`)));
  const mine = new Set(servers.flatMap((d) => cableAt(w, nicOf(d))?.id ?? []));
  const others =
    mode === 'repair'
      ? ports.flatMap((p) => {
          const c = cableAt(w, `${sw}:${p}`);
          if (!c || mine.has(c.id)) return [];
          const far = otherEnd(c, `${sw}:${p}`);
          return [{ cable: c, dev: devOf(far), port: far.slice(far.indexOf(':') + 1) }];
        })
      : [];
  // Uplinks (to network gear) first, then other servers' cables, each in front-panel order.
  others.sort((a, b) => Number(!!w.devices[b.dev]?.nd) - Number(!!w.devices[a.dev]?.nd));
  return { sw, ports, servers, others };
}

/** Every cable the cable window can test and replace today. */
export function cableGameCables(def: StageDef, w: World, mode: 'build' | 'repair'): Set<string> {
  const b = cableBoard(def, w, mode);
  const ids = new Set(b.others.map((o) => o.cable.id));
  for (const d of b.servers) {
    const c = cableAt(w, nicOf(d));
    if (c) ids.add(c.id);
  }
  return ids;
}

/** Every 'dev:ifn' that spanning tree blocks in some VLAN. */
export function stpBlocked(w: World): Set<string> {
  const vlans = new Set<number>();
  for (const d of Object.values(w.devices)) for (const v of Object.keys(d.nd?.vlans ?? {})) vlans.add(Number(v));
  const out = new Set<string>();
  for (const v of vlans) for (const p of stpView(w, v).blocked) out.add(p);
  return out;
}

/**
 * A port's front-panel LED (the doc's rules): off = no link; green = link (it blinks with traffic);
 * amber = blocked by STP, shut down or err-disabled; green/amber alternating = CRC errors rising.
 */
export function portLed(w: World, dev: string, ifn: string, blocked: Set<string> = stpBlocked(w)): LedState {
  const st = operState(w, dev, ifn);
  if (st === 'admin-down' || st === 'err-disabled') return 'amber';
  if (st !== 'up') return 'off';
  const group = w.devices[dev]?.nd?.ifs[ifn]?.group;
  if (blocked.has(`${dev}:${ifn}`) || (group !== undefined && blocked.has(`${dev}:Po${group}`))) return 'amber';
  // syncNet adds CRC errors on a degraded cable every second, so a degraded cable means a rising counter.
  if (cableAt(w, `${dev}:${ifn}`)?.degraded) return 'crc';
  return 'green';
}

/** Physical ports of a device in front-panel order (Gi before Te, numerically). */
export const physicalPorts = (d: Device): string[] => [...d.ports].sort(compareIf);

/** Status LED of a rack unit: off (not mounted), red (no power), green (on and linked), amber (on, no link). */
export function serverLed(w: World, d: Device): LedState {
  if (!d.installed) return 'off';
  if (!powered(w, d.id)) return 'red';
  const node = w.k8s?.nodes[d.id];
  if (node) return node.ready ? 'green' : 'red';
  // Network gear: green while any uplink is up.
  const ports = d.nd ? d.ports : [d.ports[0] ?? 'eth0'];
  return ports.some((p) => operState(w, d.id, p) === 'up') ? 'green' : 'amber';
}

/** Units in a rack, top slot first: the top-of-rack switch sits at the top, as in a real rack. */
export function rackSlots(w: World, rack: string): RackSlotView[] {
  return Object.values(w.devices)
    .filter((d) => d.rack === rack)
    .sort((a, b) => Number(b.kind === 'switch') - Number(a.kind === 'switch'))
    .map((d) => ({ id: d.id, label: d.label, installed: d.installed, led: serverLed(w, d) }));
}

/** The top-of-rack switch living in a rack, if any. */
export function torOf(w: World, rack: string): Device | undefined {
  return Object.values(w.devices).find((d) => d.rack === rack && d.kind === 'switch');
}

/** LEDs drawn on the switch cabinet: two rows of eight. */
export const SWITCH_PORTS = 16;

/** Port LEDs of the map switch (TOR: Gi1/0/1–12, Te1/1/1–4), in front-panel order; missing ports are off. */
export function switchPortLeds(w: World, swId: string): LedState[] {
  const sw = w.devices[swId];
  const ports = sw ? physicalPorts(sw) : [];
  const blocked = stpBlocked(w);
  return Array.from({ length: SWITCH_PORTS }, (_, i) => (ports[i] ? portLed(w, swId, ports[i], blocked) : 'off'));
}

/** The border router's two LEDs: toward the ISP (WAN) and toward the firewall (LAN). */
export function routerLeds(w: World): { wan: LedState; lan: LedState } {
  const r = w.devices['BR-01'] ?? Object.values(w.devices).find((d) => d.kind === 'router');
  if (!r) return { wan: 'green', lan: 'green' };
  const [wan, lan] = physicalPorts(r);
  return { wan: wan ? portLed(w, r.id, wan, new Set()) : 'off', lan: lan ? portLed(w, r.id, lan, new Set()) : 'off' };
}

export function patchLed(w: World): LedState {
  return Object.values(w.cables).some((c) => c.broken) ? 'red' : 'green';
}

export function blackout(w: World): boolean {
  return !!w.power && !w.power.mains;
}

/** PDU feed A sits behind the UPS, feed B is mains only. */
export function pduLeds(w: World): { A: LedState; B: LedState } {
  if (!w.power) return { A: 'green', B: 'green' };
  const { mains, ups, pduDown } = w.power;
  return {
    A: pduDown === 'A' ? 'red' : mains ? 'green' : ups ? 'amber' : 'red',
    B: pduDown === 'B' || !mains ? 'red' : 'green',
  };
}

export function upsView(w: World): { lcd: 'normal' | 'battery' | 'off'; led: LedState } {
  if (!w.power) return { lcd: 'normal', led: 'green' };
  if (!w.power.ups) return { lcd: 'off', led: w.power.mains ? 'off' : 'red' };
  return w.power.mains ? { lcd: 'normal', led: 'green' } : { lcd: 'battery', led: 'amber' };
}

export function cracOk(w: World): boolean {
  return w.cooling ? w.cooling.cracOk : true;
}

export function rackTemp(w: World, rack: string): number | null {
  return w.cooling?.temps[rack] ?? null;
}

/** Today's servers still in their boxes (D-5). */
export function unmountedServers(w: World, def: StageDef): number {
  return mapDevicesOf(def, w).filter((d) => d.kind === 'server' && d.rack && !d.installed).length;
}
