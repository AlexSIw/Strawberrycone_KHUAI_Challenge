// Pure read-only views of the simulation for the map visuals (LED colours, indicators).
import { cableAt, linkUp, powered } from '../sim/network';
import type { Device, World } from '../sim/types';

export type LedState = 'green' | 'amber' | 'red' | 'off';

export const LED_COLOR: Record<LedState, number> = {
  green: 0x4fd17a,
  amber: 0xffb547,
  red: 0xff4a4f,
  off: 0x2c2e36,
};

export interface RackSlotView {
  id: string;
  installed: boolean;
  led: LedState;
}

/** Stages 4–5 don't model cabling at all; their servers count as linked. */
const modelsCables = (w: World) => Object.keys(w.cables).length > 0;

export function serverLed(w: World, d: Device): LedState {
  if (!d.installed) return 'off';
  if (!powered(w, d.id)) return 'red';
  const node = w.k8s?.nodes[d.id];
  if (node) return node.ready ? 'green' : 'red';
  if (!modelsCables(w)) return 'green';
  return linkUp(w, d.id, 'eth0') ? 'green' : 'amber';
}

/** Devices that live in a rack, top slot first. */
export function rackSlots(w: World, rack: string): RackSlotView[] {
  return Object.values(w.devices)
    .filter((d) => d.rack === rack)
    .map((d) => ({ id: d.id, installed: d.installed, led: serverLed(w, d) }));
}

export const SWITCH_PORTS = 10;

/** Port LEDs p0..p9 of the first switch: green link, amber cable without link, red broken cable, off unplugged. */
export function switchPortLeds(w: World): LedState[] {
  const sw = Object.values(w.devices).find((d) => d.kind === 'switch');
  if (!sw) return Array.from({ length: SWITCH_PORTS }, (_, i) => (i < 4 ? 'green' : 'off'));
  return Array.from({ length: SWITCH_PORTS }, (_, i) => {
    const port = `p${i}`;
    if (!sw.ports.includes(port)) return 'off';
    const c = cableAt(w, `${sw.id}:${port}`);
    if (!c) return 'off';
    if (c.broken) return 'red';
    return linkUp(w, sw.id, port) ? 'green' : 'amber';
  });
}

export function routerLeds(w: World): { wan: LedState; lan: LedState } {
  const r = Object.values(w.devices).find((d) => d.kind === 'router');
  if (!r) return { wan: 'green', lan: 'green' };
  const led = (port: string): LedState => {
    const c = cableAt(w, `${r.id}:${port}`);
    if (!c) return 'off';
    if (c.broken) return 'red';
    return linkUp(w, r.id, port) ? 'green' : 'amber';
  };
  return { wan: led('wan'), lan: led('lan') };
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

/** Servers still in their boxes (stage 1). */
export function unmountedServers(w: World): number {
  return Object.values(w.devices).filter((d) => d.kind === 'server' && d.rack && !d.installed).length;
}
