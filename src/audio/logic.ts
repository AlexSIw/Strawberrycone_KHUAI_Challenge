// Pure audio decisions: no Web Audio, no DOM. engine.ts plays sounds, director.ts wires these
// rules to the game store, and tests/audio.test.ts checks them.
import type { Speaker } from '../content/types';

// ---------- music ----------

/** lobby: title, 완료한 날 다시 하기, ending · normal: in a stage · incident: while an incident is going on */
export type MusicTrack = 'lobby' | 'normal' | 'incident';

/** The bits of game state the audio rules look at (GameState fits it). */
export interface AudioView {
  screen: string;
  run: {
    stage: number;
    ctx: { stageTime: number };
    scenarios: readonly { id: string; state: string }[];
    /** objective id → stage time it was done */
    objectivesDone: Readonly<Record<string, number>>;
  } | null;
  dialogue: { then: string } | null;
  concepts: readonly { scenarioId: string }[];
  save: { cards: readonly string[] };
}

/** Screens that belong to a stage (the map with its HUD, and the clear popup on top of it). */
const IN_STAGE: readonly string[] = ['playing', 'results'];

/** Ids of the incidents going on right now (only while a stage is being played). */
export function activeIncidents(s: Pick<AudioView, 'screen' | 'run'>): string[] {
  if (s.screen !== 'playing' || !s.run) return [];
  return s.run.scenarios.filter((x) => x.state === 'active').map((x) => x.id);
}

/**
 * The lobby tune outside the stages (title, 완료한 날 다시 하기, ending), the normal loop inside one (playing,
 * results), and the incident loop while any incident is on.
 */
export function musicFor(s: Pick<AudioView, 'screen' | 'run'>): MusicTrack {
  if (!IN_STAGE.includes(s.screen)) return 'lobby';
  return activeIncidents(s).length > 0 ? 'incident' : 'normal';
}

/** Ids in `next` that were not in `prev`. */
export function newlyActive(prev: readonly string[], next: readonly string[]): string[] {
  return next.filter((id) => !prev.includes(id));
}

/** Same stage run as before (false after a retry, a new stage, or leaving the stage). */
export function sameRun(prev: Pick<AudioView, 'screen' | 'run'>, next: Pick<AudioView, 'screen' | 'run'>): boolean {
  if (!prev.run || !next.run) return false;
  return prev.run.stage === next.run.stage && next.run.ctx.stageTime >= prev.run.ctx.stageTime;
}

// ---------- crossfades ----------

/** Crossfade lengths (seconds). */
export const FADES = {
  /** Lobby ↔ stage, and back to the normal loop once the last incident is solved: slow, no jolt */
  long: 2.8,
  /** An incident starts: quick, so it still feels urgent */
  short: 0.3,
  /** The very first music, right after the click that unlocks sound */
  first: 1.5,
  /** Music switched off */
  stop: 1,
};

export interface Crossfade {
  /** Seconds the new track takes to come in */
  fadeIn: number;
  /** Seconds the old one takes to go */
  fadeOut: number;
}

/** How to get from the track that is playing to the one wanted (null: silence). */
export function crossfade(from: MusicTrack | null, to: MusicTrack | null): Crossfade {
  if (from === to) return { fadeIn: 0, fadeOut: 0 };
  if (to === null) return { fadeIn: 0, fadeOut: FADES.stop };
  if (from === null) return { fadeIn: FADES.first, fadeOut: 0 };
  if (to === 'incident') return { fadeIn: FADES.short, fadeOut: FADES.short };
  return { fadeIn: FADES.long, fadeOut: FADES.long };
}

/** Tracks that pick up where they left off; the incident loop always starts from its top. */
export const RESUME: Record<MusicTrack, boolean> = { lobby: true, normal: true, incident: false };

/**
 * Equal-power fade at `x` (0…1) from gain `from` to `to`, for a track whose full level is `full`:
 * full·sin(θ) with θ moving evenly between asin(from/full) and asin(to/full). A whole fade-in is
 * full·sin(πx/2) and a whole fade-out full·cos(πx/2), so during a crossfade in² + out² stays full²:
 * no dip in the middle (a linear crossfade sags 3 dB there) and no bump. A fade that starts halfway
 * (one that was interrupted) continues on the same curve, so the gain never jumps.
 */
export function equalPower(from: number, to: number, full: number, x: number): number {
  if (full <= 0) return 0;
  const angle = (g: number) => Math.asin(Math.min(1, Math.max(0, g / full)));
  const t = Math.min(1, Math.max(0, x));
  const a = angle(from);
  return full * Math.sin(a + (angle(to) - a) * t);
}

/** A gain change in progress: equal-power from `from` to `to`, starting at `start` (seconds) for `duration`. */
export interface Envelope {
  from: number;
  to: number;
  full: number;
  start: number;
  duration: number;
}

/** The gain at time `t`. */
export function envelopeAt(e: Envelope, t: number): number {
  if (e.duration <= 0 || t >= e.start + e.duration) return e.to;
  if (t <= e.start) return e.from;
  return equalPower(e.from, e.to, e.full, (t - e.start) / e.duration);
}

/**
 * Breakpoints (absolute times) for linear ramps that trace the curve: Web Audio has no sine ramp, and
 * value curves can't be cut short cleanly in every browser. One every ~50 ms (8–64 of them) is
 * closer to the curve than anyone can hear. Empty for an instant change.
 */
export function envelopePoints(e: Envelope): { t: number; v: number }[] {
  if (e.duration <= 0) return [];
  const n = Math.min(64, Math.max(8, Math.ceil(e.duration / 0.05)));
  return Array.from({ length: n }, (_, i) => {
    const x = (i + 1) / n;
    return { t: e.start + x * e.duration, v: equalPower(e.from, e.to, e.full, x) };
  });
}

// ---------- loudness ----------

type Biquad = { b: [number, number, number]; a: [number, number] };

/**
 * The two K-weighting biquads (a0 = 1) for any sample rate, designed as libebur128 does: at 48 kHz they
 * are exactly the coefficients printed in BS.1770.
 */
function kWeighting(sampleRate: number): Biquad[] {
  const shelf = (() => {
    const [f0, gainDb, q] = [1681.974450955533, 3.999843853973347, 0.7071752369554196];
    const k = Math.tan((Math.PI * f0) / sampleRate);
    const vh = Math.pow(10, gainDb / 20);
    const vb = Math.pow(vh, 0.4996667741545416);
    const a0 = 1 + k / q + k * k;
    return {
      b: [(vh + (vb * k) / q + k * k) / a0, (2 * (k * k - vh)) / a0, (vh - (vb * k) / q + k * k) / a0],
      a: [(2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0],
    } as Biquad;
  })();
  const highpass = (() => {
    const [f0, q] = [38.13547087602444, 0.5003270373238773];
    const k = Math.tan((Math.PI * f0) / sampleRate);
    const a0 = 1 + k / q + k * k;
    return { b: [1, -2, 1], a: [(2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0] } as Biquad;
  })();
  return [shelf, highpass];
}

/**
 * Integrated loudness (LUFS) as in ITU-R BS.1770-4: each channel K-weighted (a +4 dB shelf above
 * ~1.7 kHz, then a high-pass at ~38 Hz: roughly how the ear weighs frequencies), mean square over
 * 400 ms blocks every 100 ms, blocks below −70 LUFS and then those 10 LU under the average left out.
 * This measures how loud music sounds, which peaks or plain RMS don't. −Infinity for silence.
 */
export function loudness(channels: readonly ArrayLike<number>[], sampleRate: number): number {
  const length = channels[0]?.length ?? 0;
  const step = Math.round(sampleRate / 10);
  const segments = Math.floor(length / step);
  if (segments < 4) return -Infinity;
  // Sum of squares of the K-weighted signal per 100 ms, all channels together (L/R weigh 1).
  const energy = new Float64Array(segments);
  const filters = kWeighting(sampleRate);
  for (const ch of channels) {
    const state = filters.map(() => [0, 0]); // transposed direct form II
    for (let i = 0; i < segments * step; i++) {
      let y = ch[i];
      for (let f = 0; f < filters.length; f++) {
        const { b, a } = filters[f];
        const s = state[f];
        const x = y;
        y = b[0] * x + s[0];
        s[0] = b[1] * x - a[0] * y + s[1];
        s[1] = b[2] * x - a[1] * y;
      }
      energy[Math.floor(i / step)] += y * y;
    }
  }
  const lufs = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare);
  const blocks: number[] = [];
  for (let j = 0; j + 4 <= segments; j++) blocks.push((energy[j] + energy[j + 1] + energy[j + 2] + energy[j + 3]) / (4 * step));
  const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
  const loudEnough = blocks.filter((ms) => lufs(ms) > -70);
  if (!loudEnough.length) return -Infinity;
  const gate = lufs(mean(loudEnough)) - 10;
  return lufs(mean(loudEnough.filter((ms) => lufs(ms) > gate)));
}

/**
 * Loudness of each music file (LUFS), measured with loudness() on the decoded files (tests/audio.test.ts
 * measures them again on a Mac and fails if a file changed without updating this).
 */
export const MUSIC_LUFS: Record<MusicTrack, number> = { lobby: -14.6, normal: -18.0, incident: -6.0 };

/** Never boost a quiet track by more than this (×2 = +6 dB), so it can't clip. */
const MAX_BOOST = 2;

/**
 * Gain per track so all three sound as loud as the reference (the normal loop the mix was set up
 * with), and switching tracks never jumps in volume.
 */
export function loudnessGains(lufs: Record<MusicTrack, number> = MUSIC_LUFS, ref: MusicTrack = 'normal'): Record<MusicTrack, number> {
  const gain = (t: MusicTrack) => {
    const g = Math.pow(10, (lufs[ref] - lufs[t]) / 20);
    if (!Number.isFinite(g) || g <= 0) return 1; // a silent or unmeasured track: left alone
    return Math.round(Math.min(MAX_BOOST, g) * 1000) / 1000;
  };
  return { lobby: gain('lobby'), normal: gain('normal'), incident: gain('incident') };
}

/** Sample-accurate loop points: leading/trailing near-silence (AAC/MP3 encoder padding) is cut off. */
export interface Span {
  start: number;
  end: number;
}

/**
 * Where the sound really starts and ends, in seconds. A sample counts as sound when any channel is
 * above `threshold`. At most `maxTrim` seconds are cut from each end, so a quiet intro stays.
 */
export function trimSilence(channels: readonly ArrayLike<number>[], sampleRate: number, opts: { threshold?: number; maxTrim?: number } = {}): Span {
  const length = channels[0]?.length ?? 0;
  const duration = length / sampleRate;
  if (!length) return { start: 0, end: 0 };
  const threshold = opts.threshold ?? 1e-3;
  const maxSamples = Math.min(length, Math.floor((opts.maxTrim ?? Infinity) * sampleRate));
  const loud = (i: number) => channels.some((c) => Math.abs(c[i]) > threshold);
  let first = 0;
  while (first < maxSamples && !loud(first)) first++;
  if (first >= length) return { start: 0, end: duration }; // all silent: leave it alone
  let last = length; // exclusive
  while (length - last < maxSamples && last > first + 1 && !loud(last - 1)) last--;
  return { start: first / sampleRate, end: last / sampleRate };
}

// ---------- alarm ----------

export const ALARM = {
  /** Beeps per incident (≈ the first 10.5 s), then only the incident music goes on */
  count: 4,
  /** Seconds between beeps */
  interval: 3.5,
  /** One beep's length (sfx_alarm is 1.7 s, ≈1.45 s once its silent ends are cut), so a new cycle never starts on top of it */
  length: 1.5,
};

/**
 * When the beeps of a new cycle started at `now` sound (seconds, same clock as `now`). The first one
 * is immediate, unless a beep is still sounding: then it waits for that one to finish.
 */
export function alarmTimes(now: number, lastBeepAt: number | null, o = ALARM): number[] {
  const first = lastBeepAt !== null && now < lastBeepAt + o.length ? lastBeepAt + o.length : now;
  return Array.from({ length: o.count }, (_, i) => first + i * o.interval);
}

export interface AlarmDeps {
  /** Seconds */
  now(): number;
  beep(): void;
  /** Cut a beep that is still sounding */
  cut?(): void;
  setTimer(fn: () => void, ms: number): number;
  clearTimer(id: number): void;
}

export interface AlarmCycle {
  /** (Re)start the 4-beep cycle: an incident just fired */
  start(): void;
  /** Stop at once, including a beep that is sounding */
  stop(): void;
  /** Beeps still to come */
  readonly pending: number;
}

export function createAlarm(deps: AlarmDeps, o = ALARM): AlarmCycle {
  let timers: number[] = [];
  let lastBeepAt: number | null = null;
  const cancel = () => {
    timers.forEach((id) => deps.clearTimer(id));
    timers = [];
  };
  const beep = () => {
    lastBeepAt = deps.now();
    deps.beep();
  };
  return {
    start() {
      cancel();
      const now = deps.now();
      for (const t of alarmTimes(now, lastBeepAt, o)) {
        if (t <= now) {
          beep();
          continue;
        }
        const id = deps.setTimer(() => {
          timers = timers.filter((x) => x !== id);
          beep();
        }, (t - now) * 1000);
        timers.push(id);
      }
    },
    stop() {
      cancel();
      if (lastBeepAt !== null && deps.now() < lastBeepAt + o.length) deps.cut?.();
      lastBeepAt = null;
    },
    get pending() {
      return timers.length;
    },
  };
}

// ---------- coin & win jingle ----------

/** Two jingle cues closer than this (seconds) play once. */
export const JINGLE_GAP = 1;
/** Coin cues closer than this (seconds) play once. */
export const COIN_GAP = 0.15;
/** A jingle due right after a coin waits this long after it (seconds), so the two don't pile up. */
export const JINGLE_AFTER_COIN = 0.5;

export function jingleAllowed(lastAt: number | null, now: number, gap = JINGLE_GAP): boolean {
  return lastAt === null || now - lastAt >= gap;
}

/**
 * The concept card on screen, if any. Mirrors ConceptCardPopup: the intro hides cards and the
 * outro waits for them.
 */
export function visibleCard<T extends { scenarioId: string }>(s: { screen: string; dialogue: { then: string } | null; concepts: readonly T[] }): T | null {
  const blocked = s.screen !== 'playing' || (!!s.dialogue && s.dialogue.then !== 'results');
  return blocked ? null : (s.concepts[0] ?? null);
}

/** Why the win jingle plays: an incident's card, the stage clear popup, or the final certificate. */
export type Jingle = 'card' | 'results' | 'ending';

type CueState = Pick<AudioView, 'screen' | 'dialogue' | 'concepts'>;

/**
 * Should the win jingle play for this state change? Yes when an incident's card pops up (not an
 * objective's "objective:<id>" card), when the stage results popup appears, and when the ending
 * (certificate) screen appears.
 */
export function jingleCue(prev: CueState, next: CueState): Jingle | null {
  if (next.screen === 'results' && prev.screen !== 'results') return 'results';
  if (next.screen === 'ending' && prev.screen !== 'ending') return 'ending';
  const card = visibleCard(next);
  if (card && card !== visibleCard(prev) && !card.scenarioId.startsWith('objective:')) return 'card';
  return null;
}

/** Objectives done by this state change (same stage run, while playing). */
export function newObjectives(prev: Pick<AudioView, 'screen' | 'run'>, next: Pick<AudioView, 'screen' | 'run'>): string[] {
  if (next.screen !== 'playing' || !prev.run || !next.run || !sameRun(prev, next)) return [];
  const before = prev.run.objectivesDone;
  if (before === next.run.objectivesDone) return []; // most updates (a keystroke, a window) don't touch them
  return Object.keys(next.run.objectivesDone).filter((id) => !(id in before));
}

/** Cards that just joined the collection. One earned again on a replay is not new. */
export function newCards(prev: Pick<AudioView, 'save'>, next: Pick<AudioView, 'screen' | 'save'>): string[] {
  if (next.screen !== 'playing' || prev.save.cards === next.save.cards) return [];
  return next.save.cards.filter((c) => !prev.save.cards.includes(c));
}

/** Should the coin sound for this state change? An objective was done, or a card is new to the collection. */
export function coinCue(prev: Pick<AudioView, 'screen' | 'run' | 'save'>, next: Pick<AudioView, 'screen' | 'run' | 'save'>): boolean {
  return newObjectives(prev, next).length > 0 || newCards(prev, next).length > 0;
}

/** The cues gathered from one moment's state changes (one player action or game tick). */
export interface Cues {
  coin: boolean;
  jingle: Jingle | null;
}

/** When the coin and the jingle last played (seconds; a jingle can be set for a moment ahead). */
export interface CueClock {
  lastCoin: number | null;
  lastJingle: number | null;
}

export interface CuePlay {
  sfx: 'coin' | 'win';
  /** Seconds from now */
  delay: number;
}

/**
 * What to play for one moment's cues. Everything in the same moment (an objective, its card, an incident
 * fixed in the same tick) is one coin. A jingle never starts on top of a coin: it begins ~0.5 s after it.
 * Repeats are dropped: a coin within 0.15 s of the last one or while a jingle is about to start, and a
 * jingle within 1 s of the last one.
 */
export function planCues(cues: Cues, now: number, clock: CueClock): { plays: CuePlay[]; clock: CueClock } {
  const plays: CuePlay[] = [];
  let { lastCoin, lastJingle } = clock;
  const jinglePending = lastJingle !== null && lastJingle > now;
  if (cues.coin && !jinglePending && (lastCoin === null || now - lastCoin >= COIN_GAP)) {
    plays.push({ sfx: 'coin', delay: 0 });
    lastCoin = now;
  }
  if (cues.jingle && jingleAllowed(lastJingle, now)) {
    const delay = lastCoin !== null && now - lastCoin < JINGLE_AFTER_COIN ? Math.round((lastCoin + JINGLE_AFTER_COIN - now) * 1000) / 1000 : 0;
    plays.push({ sfx: 'win', delay });
    lastJingle = now + delay;
  }
  return { plays, clock: { lastCoin, lastJingle } };
}

type CueView = Pick<AudioView, 'screen' | 'run' | 'save' | 'dialogue' | 'concepts'>;

export interface CueTracker {
  /** A state change happened (prev → next). */
  observe(prev: CueView, next: CueView): void;
  /** Drop anything still pending. */
  stop(): void;
}

/**
 * Turns state changes into coin/jingle plays. One player action or game tick changes the store several
 * times in a row (the objective, then its card…), so cues are gathered and planned together once that
 * burst is over: `defer` runs the plan afterwards (queueMicrotask in the game).
 */
export function createCueTracker(deps: { now(): number; defer(fn: () => void): void; play(p: CuePlay): void }): CueTracker {
  let pending: Cues | null = null;
  let clock: CueClock = { lastCoin: null, lastJingle: null };
  let stopped = false;
  const flush = () => {
    const cues = pending;
    pending = null;
    if (!cues || stopped) return;
    const plan = planCues(cues, deps.now(), clock);
    clock = plan.clock;
    plan.plays.forEach(deps.play);
  };
  return {
    observe(prev, next) {
      if (stopped) return;
      const coin = coinCue(prev, next);
      const jingle = jingleCue(prev, next);
      if (!coin && !jingle) return;
      if (!pending) {
        pending = { coin: false, jingle: null };
        deps.defer(flush);
      }
      pending.coin ||= coin;
      pending.jingle ??= jingle;
    },
    stop() {
      stopped = true;
      pending = null;
    },
  };
}

// ---------- dialogue blabber (animalese) ----------

/** voice_animalese.wav: 26 letter samples A–Z, back to back, each this long (seconds) */
export const LETTER_SECONDS = 0.15;
/** Each blip plays this much output time (animalese.js) */
export const BLIP_SECONDS = 0.075;

/** animalese.js's pitch slider runs from Grump (0.2) to Isabelle (2.0). */
export const GRUMP = 0.2;
export const ISABELLE = 2.0;

/** A pitch `f` of the slider's range away from the middle, toward Isabelle (negative: toward Grump). */
export function towardIsabelle(f: number): number {
  const mid = (GRUMP + ISABELLE) / 2;
  return Math.round((mid + f * (ISABELLE - GRUMP)) * 1000) / 1000;
}

/** Playback rate per speaker; null = no voice (tips). */
export const VOICE_PITCH: Record<Speaker, number | null> = {
  lion: towardIsabelle(0.05), // 나: 5% toward Isabelle → 1.19
  mentor: towardIsabelle(-0.15), // 쿠사수: 15% toward Grump → 0.83
  boss: towardIsabelle(-0.15), // 팀장님: 15% toward Grump → 0.83
  system: null,
};

// Initial consonant → letter (silent ㅇ is null: the vowel speaks instead), in Unicode order.
const INITIALS: (string | null)[] = ['G', 'G', 'N', 'D', 'D', 'R', 'M', 'B', 'B', 'S', 'S', null, 'J', 'J', 'C', 'K', 'T', 'P', 'H'];
// ㄱ ㄲ ㄴ ㄷ ㄸ ㄹ ㅁ ㅂ ㅃ ㅅ ㅆ ㅇ ㅈ ㅉ ㅊ ㅋ ㅌ ㅍ ㅎ
const VOWELS = ['A', 'E', 'Y', 'Y', 'O', 'E', 'Y', 'Y', 'O', 'W', 'W', 'W', 'Y', 'U', 'W', 'W', 'W', 'Y', 'U', 'U', 'I'];
// ㅏ ㅐ ㅑ ㅒ ㅓ ㅔ ㅕ ㅖ ㅗ ㅘ ㅙ ㅚ ㅛ ㅜ ㅝ ㅞ ㅟ ㅠ ㅡ ㅢ ㅣ

// Standalone (compatibility) jamo like ㅋㅋ or ㅠㅠ: U+3131 ㄱ … U+314E ㅎ, then U+314F ㅏ … U+3163 ㅣ.
// Clusters use their first consonant; a lone ㅇ is read like 'O'.
const JAMO_CONSONANTS = 'GGGNNNDDRRRRRRRRMBBBSSOJJCKTPH';

/** The letter a Hangul syllable or jamo "says", or null. */
export function hangulToLetter(ch: string): string | null {
  const code = ch.codePointAt(0);
  if (code === undefined || ch.length !== 1) return null;
  if (code >= 0xac00 && code <= 0xd7a3) {
    const i = code - 0xac00;
    return INITIALS[Math.floor(i / 588)] ?? VOWELS[Math.floor((i % 588) / 28)];
  }
  if (code >= 0x3131 && code <= 0x314e) return JAMO_CONSONANTS[code - 0x3131];
  if (code >= 0x314f && code <= 0x3163) return VOWELS[code - 0x314f];
  return null;
}

/** The letter sample to blip for one typed character; null = silence (space, punctuation, digit, emoji…). */
export function blipLetter(ch: string): string | null {
  if (/^[A-Za-z]$/.test(ch)) return ch.toUpperCase();
  return hangulToLetter(ch);
}

/** Where a letter's sample starts in voice_animalese.wav (seconds). */
export function letterOffset(letter: string): number {
  return (letter.charCodeAt(0) - 65) * LETTER_SECONDS;
}

// ---------- settings ----------

export const AUDIO_PREF_KEY = 'khu-dc-audio';

/** Sound is on unless the saved setting says muted. */
export function parseAudioPref(raw: string | null): { muted: boolean } {
  if (!raw) return { muted: false };
  try {
    const v: unknown = JSON.parse(raw);
    return { muted: typeof v === 'object' && v !== null && (v as { muted?: unknown }).muted === true };
  } catch {
    return { muted: false };
  }
}
