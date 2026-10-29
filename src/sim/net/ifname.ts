// Interface names the way IOS accepts them: 'GigabitEthernet1/0/5', 'gi1/0/5', 'g 1/0/5', 'te1/1/1',
// 'hu1/0/1', 'po1', 'port-channel 1', 'vlan10'. Everything is stored under the short canonical key ('Gi1/0/5').

const KINDS: { short: string; long: string; prefixes: string[] }[] = [
  { short: 'Gi', long: 'GigabitEthernet', prefixes: ['gigabitethernet', 'gi', 'g'] },
  { short: 'Te', long: 'TenGigabitEthernet', prefixes: ['tengigabitethernet', 'te', 't'] },
  { short: 'Hu', long: 'HundredGigE', prefixes: ['hundredgige', 'hu', 'h'] },
  { short: 'Po', long: 'Port-channel', prefixes: ['port-channel', 'po'] },
  { short: 'Vlan', long: 'Vlan', prefixes: ['vlan', 'vl', 'v'] },
];

/**
 * Normalise an interface name to its canonical short key, or null if it isn't one.
 * Accepts any unambiguous prefix of the long name, with or without a space before the number.
 */
export function normIf(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  const m = /^([a-z-]+)(\d+(?:\/\d+)*)$/.exec(s);
  if (!m) return null;
  const [, word, num] = m;
  const hits = KINDS.filter((k) => k.long.toLowerCase().startsWith(word) || k.prefixes.includes(word));
  if (hits.length !== 1) return null;
  const k = hits[0];
  // Physical ports have slot/port numbers; Po and Vlan take a bare number.
  const slashed = num.includes('/');
  if ((k.short === 'Po' || k.short === 'Vlan') === slashed) return null;
  return `${k.short}${num}`;
}

/** 'Gi1/0/5' → 'GigabitEthernet1/0/5' */
export function longIf(short: string): string {
  const k = KINDS.find((x) => short.startsWith(x.short));
  return k ? `${k.long}${short.slice(k.short.length)}` : short;
}

/** Port-channel number of 'Po3', or null. */
export const poNumber = (ifn: string): number | null => (/^Po(\d+)$/.exec(ifn) ? parseInt(ifn.slice(2), 10) : null);

/** Stable order: Gi, Te, Hu, Po, Vlan, then numerically per part ('Gi1/0/2' < 'Gi1/0/10'). */
export function compareIf(a: string, b: string): number {
  const rank = (s: string) => KINDS.findIndex((k) => s.startsWith(k.short));
  const nums = (s: string) => (s.match(/\d+/g) ?? []).map(Number);
  const r = rank(a) - rank(b);
  if (r) return r;
  const na = nums(a);
  const nb = nums(b);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) if ((na[i] ?? -1) !== (nb[i] ?? -1)) return (na[i] ?? -1) - (nb[i] ?? -1);
  return 0;
}
