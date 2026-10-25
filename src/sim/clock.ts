// The in-game wall clock. Pure: day time (real seconds since the briefing) → game time of day.
// Weekdays run at a flat rate; D-Day runs in phases (fast before the open, slow during the peak).

export interface ClockPhase {
  /** Game time this phase ends at, 'HH:MM:SS' */
  until: string;
  /** Real seconds the phase lasts */
  realS: number;
}

export interface ClockDef {
  /** Game time when the day starts, 'HH:MM:SS' */
  start: string;
  /** Game seconds per real second (used when there are no phases, and after the last phase) */
  rate: number;
  phases?: ClockPhase[];
}

export function parseHms(s: string): number {
  const [h, m, sec] = s.split(':').map((x) => parseInt(x, 10));
  return h * 3600 + (m || 0) * 60 + (sec || 0);
}

const two = (n: number) => String(n).padStart(2, '0');

/** 37800 → "10:30" (or "10:30:00" with seconds). Wraps past midnight. */
export function fmtClock(sec: number, withSec = false): string {
  const s = ((Math.floor(sec) % 86400) + 86400) % 86400;
  const hhmm = `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}`;
  return withSec ? `${hhmm}:${two(s % 60)}` : hhmm;
}

/** Piecewise-linear segments [realStart, gameStart, rate]. */
function segments(c: ClockDef): { real: number; game: number; rate: number }[] {
  const segs = [];
  let real = 0;
  let game = parseHms(c.start);
  for (const p of c.phases ?? []) {
    const until = parseHms(p.until);
    const rate = p.realS > 0 ? (until - game) / p.realS : 0;
    segs.push({ real, game, rate });
    real += p.realS;
    game = until;
  }
  segs.push({ real, game, rate: c.rate });
  return segs;
}

/** Game time of day (seconds since midnight) at day time `t` (real seconds). */
export function gameSec(c: ClockDef, t: number): number {
  const segs = segments(c);
  let seg = segs[0];
  for (const s of segs) if (t >= s.real) seg = s;
  return seg.game + (t - seg.real) * seg.rate;
}

/** Day time (real seconds) when the clock shows `hms`. Inverse of gameSec. */
export function stageAt(c: ClockDef, hms: string): number {
  const target = parseHms(hms);
  const segs = segments(c);
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    if (target >= s.game) return s.rate > 0 ? s.real + (target - s.game) / s.rate : s.real;
  }
  return 0;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '02-10' → 'Feb 10' (syslog style). */
export function syslogDate(mmdd: string): string {
  const [m, d] = mmdd.split('-').map((x) => parseInt(x, 10));
  return `${MONTHS[m - 1]} ${String(d).padStart(2, ' ')}`;
}

/** '02-10' → '2월 10일'. */
export function koDate(mmdd: string): string {
  const [m, d] = mmdd.split('-').map((x) => parseInt(x, 10));
  return `${m}월 ${d}일`;
}

/** "*Feb 10 10:00:31" — the timestamp IOS puts in front of a syslog line. */
export function syslogStamp(c: ClockDef, mmdd: string, t: number): string {
  return `*${syslogDate(mmdd)} ${fmtClock(gameSec(c, t), true)}`;
}
