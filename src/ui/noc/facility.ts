// Facility readings for the FMS tab and the gauge windows. Facilities are monitor-only, so these are
// all derived from the power and cooling state: nothing here changes the world.
import { feedLive, linkUp, powered } from '../../sim/network';
import type { DeviceKind, World } from '../../sim/types';
import { own } from '../../sim/util';

/** Rough draw per device (W). */
const WATTS: Record<DeviceKind, number> = { server: 400, switch: 300, router: 350, firewall: 300, lb: 250, internet: 0 };
/** UPS rating (W) in front of PDU A. */
export const UPS_W = 10_000;
/** Breaker rating of each PDU line (A) and the line voltage. */
export const PDU_AMPS = 50;
const VOLTS = 220;

export interface FacilityView {
  mains: boolean;
  ups: { loadPct: number; batteryPct: number; onBattery: boolean };
  pdu: Record<'A' | 'B', { amps: number; pct: number; live: boolean; tripped: boolean }>;
  generator: 'standby' | 'running';
  crac: boolean | null;
  racks: { rack: string; temp: number; humidity: number; cut: boolean }[];
  isp: { id: string; label: string; up: boolean }[];
}

/** Watts on each PDU line: a device plugged into both lines splits its load over the live ones. */
function feedWatts(w: World): { A: number; B: number } {
  const out = { A: 0, B: 0 };
  for (const d of Object.values(w.devices)) {
    // Only gear inside the data center (campus switches and the 관리 PC hang off other circuits).
    if (!d.rack || !powered(w, d.id)) continue;
    const live = d.feeds.filter((f) => feedLive(w, f));
    for (const f of live) out[f] += WATTS[d.kind] / live.length;
  }
  return out;
}

export function facilityView(w: World): FacilityView {
  const p = w.power;
  const mains = p?.mains ?? true;
  const watts = feedWatts(w);
  const pdu = (f: 'A' | 'B') => {
    const amps = watts[f] / VOLTS;
    return { amps, pct: amps / PDU_AMPS, live: feedLive(w, f), tripped: p?.pduDown === f };
  };
  const cool = w.cooling;
  const racks = Object.entries(cool?.temps ?? {}).map(([rack, temp]) => ({
    rack,
    temp,
    // The CRAC also holds humidity near 45%; without it the air dries out as it heats up.
    humidity: Math.round(cool?.cracOk ? 45 : Math.max(20, 45 - (temp - 24) * 1.2)),
    cut: !!p?.racksDown?.includes(rack),
  }));
  const isp = (['isp-a', 'isp-b'] as const).map((id, i) => {
    const c = w.cables[id];
    const [dev, port] = c ? c.b.split(':') : ['', ''];
    return { id, label: i === 0 ? '회선 A (ISP-A)' : '회선 B (ISP-B)', up: !!c && linkUp(w, dev, port) };
  });
  return {
    mains,
    ups: { loadPct: watts.A / UPS_W, batteryPct: mains ? 100 : 62, onBattery: !mains },
    pdu: { A: pdu('A'), B: pdu('B') },
    generator: mains ? 'standby' : 'running',
    crac: cool ? cool.cracOk : null,
    racks,
    isp,
  };
}

/** Alarm sources that are facilities (racks, UPS, PDU, CRAC): the facility team's, not ours. */
export const isFacilityDevice = (id: string): boolean => /^rack\d+$/.test(id) || ['ups', 'pdu', 'pdu-a', 'pdu-b', 'crac', 'generator', 'mains'].includes(id.toLowerCase());

/** "rack1" → "랙 1", "net1" → "네트워크실 1번 랙", facility ids → Korean names; anything else unchanged. */
export function placeName(id: string): string {
  const m = /^rack(\d+)$/.exec(id);
  if (m) return `랙 ${m[1]}`;
  const net = /^net(\d+)$/.exec(id);
  if (net) return `네트워크실 ${net[1]}번 랙`;
  return { ups: 'UPS', pdu: 'PDU', crac: '항온항습기', generator: '발전기', mains: '한전 수전' }[id.toLowerCase()] ?? id;
}

/** What an alarm source is called: a device's label, a campus service's name (KHU 도서관 …), or a place. */
export function sourceName(w: World, id: string): string {
  return own(w.devices, id)?.label ?? own(w.campus, id)?.label ?? placeName(id);
}

/** Network gear whose running-config has changes not saved with `write memory` (labels). */
export function unsavedGear(w: World): string[] {
  return Object.values(w.devices)
    .filter((d) => d.nd?.dirty)
    .map((d) => d.label);
}
