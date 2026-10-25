// Pure read-only views of the simulation for the map visuals (LED colours, indicators) and the NOC.
import type { StageDef } from '../content/types';
import { cableAt, compareIf, operState, powered, stpView } from '../sim/network';
import type { Device, World } from '../sim/types';

/** `crc` = green/amber alternating (CRC errors rising). */
export type LedState = 'green' | 'amber' | 'red' | 'off' | 'crc';

export const LED_COLOR: Record<LedState, number> = {
  green: 0x4fd17a,
  amber: 0xffb547,
  red: 0xff4a4f,
  off: 0x2c2e36,
  crc: 0x4fd17a,
};

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
    .map((d) => ({ id: d.id, label: d.kind === 'server' ? d.id : d.label, installed: d.installed, led: serverLed(w, d) }));
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
