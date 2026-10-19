// Pure audio decisions: no Web Audio, no DOM. engine.ts plays sounds, director.ts wires these
// rules to the game store, and tests/audio.test.ts checks them.
import type { Speaker } from '../content/types';

// ---------- music ----------

export type MusicTrack = 'normal' | 'incident';

/** The bits of game state the audio rules look at (GameState fits it). */
export interface AudioView {
  screen: string;
  run: { stage: number; ctx: { stageTime: number }; scenarios: readonly { id: string; state: string }[] } | null;
  dialogue: { then: string } | null;
  concepts: readonly { scenarioId: string }[];
}

/** Ids of the incidents going on right now (only while a stage is being played). */
export function activeIncidents(s: Pick<AudioView, 'screen' | 'run'>): string[] {
  if (s.screen !== 'playing' || !s.run) return [];
  return s.run.scenarios.filter((x) => x.state === 'active').map((x) => x.id);
}

/** Incident music while any incident is on, the normal loop everywhere else (title, select, results, ending). */
export function musicFor(s: Pick<AudioView, 'screen' | 'run'>): MusicTrack {
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

// ---------- win jingle ----------

/** Two jingle cues closer than this (seconds) play once. */
export const JINGLE_GAP = 1;

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

/**
 * Should the win jingle play for this state change? Yes when an incident's card pops up
 * (not an objective's "objective:<id>" card) and when the stage results screen appears.
 */
export function jingleCue(prev: Omit<AudioView, 'run'>, next: Omit<AudioView, 'run'>): 'card' | 'results' | null {
  if (next.screen === 'results' && prev.screen !== 'results') return 'results';
  const card = visibleCard(next);
  if (card && card !== visibleCard(prev) && !card.scenarioId.startsWith('objective:')) return 'card';
  return null;
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
