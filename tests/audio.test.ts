// Pure audio rules (src/audio/logic.ts): Hangul → animalese letters, voice pitches, which music plays
// where, crossfade lengths and their equal-power curve, loudness matching, the 4-beep alarm cycle, the
// coin and win-jingle cues (driven by the real store too) and loop-point trimming.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// The store reads localStorage when it is created: give it one (node has none) before it loads.
vi.hoisted(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
  return data;
});

import {
  ALARM,
  activeIncidents,
  alarmTimes,
  blipLetter,
  COIN_GAP,
  coinCue,
  createAlarm,
  crossfade,
  envelopeAt,
  envelopePoints,
  equalPower,
  FADES,
  hangulToLetter,
  JINGLE_AFTER_COIN,
  jingleAllowed,
  jingleCue,
  letterOffset,
  loudness,
  loudnessGains,
  MUSIC_LUFS,
  musicFor,
  newCards,
  newlyActive,
  newObjectives,
  parseAudioPref,
  planCues,
  RESUME,
  sameRun,
  towardIsabelle,
  trimSilence,
  visibleCard,
  VOICE_PITCH,
  type AudioView,
  type Envelope,
  type MusicTrack,
} from '../src/audio/logic';
import { STAGES } from '../src/content/stages';
import { startStage, tickRun, visibleObjectives, type StageRun } from '../src/sim/engine';
import { apply, AUTOPLAY } from './autoplay';

describe('hangulToLetter / blipLetter', () => {
  it('uses the initial consonant', () => {
    const cases: [string, string][] = [
      ['가', 'G'], ['까', 'G'], ['나', 'N'], ['다', 'D'], ['따', 'D'], ['라', 'R'], ['마', 'M'], ['바', 'B'], ['빠', 'B'],
      ['사', 'S'], ['싸', 'S'], ['자', 'J'], ['짜', 'J'], ['차', 'C'], ['카', 'K'], ['타', 'T'], ['파', 'P'], ['하', 'H'],
    ];
    for (const [ch, l] of cases) expect(hangulToLetter(ch), ch).toBe(l);
  });

  it('final consonants and vowels do not matter when the initial speaks', () => {
    expect(hangulToLetter('갃')).toBe('G');
    expect(hangulToLetter('뷁')).toBe('B');
    expect(hangulToLetter('힣')).toBe('H'); // last syllable U+D7A3
    expect(hangulToLetter('가')).toBe('G'); // U+AC00, the first syllable
  });

  it('silent ㅇ: the vowel speaks', () => {
    const cases: [string, string][] = [
      ['아', 'A'], ['애', 'E'], ['야', 'Y'], ['얘', 'Y'], ['어', 'O'], ['에', 'E'], ['여', 'Y'], ['예', 'Y'], ['오', 'O'], ['와', 'W'], ['왜', 'W'],
      ['외', 'W'], ['요', 'Y'], ['우', 'U'], ['워', 'W'], ['웨', 'W'], ['위', 'W'], ['유', 'Y'], ['으', 'U'], ['의', 'U'], ['이', 'I'],
    ];
    for (const [ch, l] of cases) expect(hangulToLetter(ch), ch).toBe(l);
    expect(hangulToLetter('앙')).toBe('A'); // final ㅇ is not the initial
    expect(hangulToLetter('응')).toBe('U');
  });

  it('standalone jamo (ㅋㅋ, ㅠㅠ) still blip', () => {
    expect(hangulToLetter('ㅋ')).toBe('K');
    expect(hangulToLetter('ㅎ')).toBe('H');
    expect(hangulToLetter('ㄱ')).toBe('G');
    expect(hangulToLetter('ㄳ')).toBe('G');
    expect(hangulToLetter('ㅄ')).toBe('B');
    expect(hangulToLetter('ㅠ')).toBe('Y');
    expect(hangulToLetter('ㅏ')).toBe('A');
    expect(hangulToLetter('ㅣ')).toBe('I');
  });

  it('English letters map directly, case-insensitive', () => {
    expect(blipLetter('a')).toBe('A');
    expect(blipLetter('Z')).toBe('Z');
    expect(blipLetter('k')).toBe('K');
    expect(blipLetter('안')).toBe('A');
  });

  it('spaces, punctuation, digits, emoji and odd input are silent', () => {
    for (const ch of [' ', '.', ',', '!', '?', '…', '(', ')', '"', '·', '→', '0', '7', '①', '🚨', '🎉', '', 'ab', '\n', 'é', 'ア', '漢']) {
      expect(blipLetter(ch), JSON.stringify(ch)).toBeNull();
    }
    // just outside the syllable block
    expect(hangulToLetter('꯿')).toBeNull();
    expect(hangulToLetter('힤')).toBeNull();
  });

  it('every letter of every dialogue line maps into A–Z', () => {
    let blips = 0;
    for (const def of STAGES) {
      for (const line of [...def.intro, ...def.outro]) {
        for (const ch of Array.from(line.text)) {
          const l = blipLetter(ch);
          if (/[가-힣A-Za-z]/.test(ch)) expect(l, `${ch} in "${line.text}"`).toMatch(/^[A-Z]$/);
          if (l) blips++;
        }
      }
    }
    expect(blips).toBeGreaterThan(500);
  });

  it('letter offsets in the 26-letter sample file', () => {
    expect(letterOffset('A')).toBe(0);
    expect(letterOffset('B')).toBeCloseTo(0.15);
    expect(letterOffset('Z')).toBeCloseTo(3.75);
  });
});

describe('voice pitch', () => {
  it('나 is 5% toward Isabelle, 쿠사수 and 팀장님 15% toward Grump, tips are silent', () => {
    expect(VOICE_PITCH.lion).toBe(1.19);
    expect(VOICE_PITCH.mentor).toBe(0.83);
    expect(VOICE_PITCH.boss).toBe(0.83);
    expect(VOICE_PITCH.system).toBeNull();
  });

  it('slider: 0.2 (Grump) … 2.0 (Isabelle), middle 1.1', () => {
    expect(towardIsabelle(0)).toBe(1.1);
    expect(towardIsabelle(0.5)).toBe(2);
    expect(towardIsabelle(-0.5)).toBe(0.2);
  });
});


// ---------- music ----------

type Sc = { id: string; state: 'waiting' | 'active' | 'resolved' };
const view = (screen: string, scenarios: Sc[] | null, extra: Partial<AudioView> = {}): AudioView => ({
  screen,
  run: scenarios ? { stage: 2, ctx: { stageTime: 10 }, scenarios, objectivesDone: {} } : null,
  dialogue: null,
  concepts: [],
  save: { cards: [] },
  ...extra,
});

describe('musicFor', () => {
  it('the lobby tune outside the stages: title, stage select, ending', () => {
    for (const screen of ['title', 'select', 'ending']) expect(musicFor(view(screen, null)), screen).toBe('lobby');
    // stale run data doesn't drag the stage music into the lobby
    expect(musicFor(view('select', [{ id: 'b', state: 'active' }]))).toBe('lobby');
    expect(musicFor(view('ending', [{ id: 'b', state: 'resolved' }]))).toBe('lobby');
  });

  it('the normal loop in a stage (playing, and its clear popup) while no incident is on', () => {
    expect(musicFor(view('playing', [{ id: 'a', state: 'waiting' }]))).toBe('normal');
    expect(musicFor(view('playing', [{ id: 'a', state: 'resolved' }]))).toBe('normal');
    expect(musicFor(view('playing', null))).toBe('normal');
    expect(musicFor(view('results', [{ id: 'a', state: 'resolved' }]))).toBe('normal');
    expect(musicFor(view('results', [{ id: 'b', state: 'active' }]))).toBe('normal');
  });

  it('the incident loop while any incident is active', () => {
    expect(musicFor(view('playing', [{ id: 'a', state: 'resolved' }, { id: 'b', state: 'active' }]))).toBe('incident');
  });

  it('follows a real day run: every day turns to the incident loop when its first incident fires', () => {
    for (const def of STAGES) {
      let run: StageRun = startStage(def.id, 1);
      expect(musicFor({ screen: 'playing', run }), def.label).toBe('normal');
      // play the missions like tests/autoplay.ts does: most days' incidents wait for a mission
      for (let i = 0; i < 900 && activeIncidents({ screen: 'playing', run }).length === 0; i++) {
        for (const o of visibleObjectives(def, run)) {
          if (o.id in run.objectivesDone) continue;
          for (const st of AUTOPLAY[def.id]?.[o.id] ?? []) run = apply(run, st, null);
        }
        run = tickRun(run).run;
      }
      expect(activeIncidents({ screen: 'playing', run }).length, def.label).toBeGreaterThan(0);
      expect(musicFor({ screen: 'playing', run }), def.label).toBe('incident');
    }
  }, 30_000);

  it('newlyActive / sameRun', () => {
    expect(newlyActive(['a'], ['a', 'b'])).toEqual(['b']);
    expect(newlyActive(['a', 'b'], ['b'])).toEqual([]);
    const r = (stage: number, t: number) => ({ screen: 'playing', run: { stage, ctx: { stageTime: t }, scenarios: [], objectivesDone: {} } });
    expect(sameRun(r(3, 5), r(3, 6))).toBe(true);
    expect(sameRun(r(3, 50), r(3, 0))).toBe(false); // retry
    expect(sameRun(r(3, 5), r(4, 6))).toBe(false);
    expect(sameRun({ screen: 'title', run: null }, r(3, 0))).toBe(false);
  });
});

// ---------- crossfades ----------

describe('crossfade lengths', () => {
  it('lobby ↔ stage: a long, smooth crossfade (2.5–3 s) both ways', () => {
    for (const [a, b] of [['lobby', 'normal'], ['normal', 'lobby'], ['incident', 'lobby']] as [MusicTrack, MusicTrack][]) {
      const f = crossfade(a, b);
      expect(f.fadeIn, `${a}→${b}`).toBeGreaterThanOrEqual(2.5);
      expect(f.fadeIn, `${a}→${b}`).toBeLessThanOrEqual(3);
      expect(f.fadeOut).toBe(f.fadeIn);
    }
  });

  it('an incident starts: short (~0.3 s), so it still feels urgent', () => {
    expect(crossfade('normal', 'incident')).toEqual({ fadeIn: FADES.short, fadeOut: FADES.short });
    expect(FADES.short).toBeGreaterThanOrEqual(0.2);
    expect(FADES.short).toBeLessThanOrEqual(0.4);
    expect(crossfade('lobby', 'incident').fadeIn).toBe(FADES.short);
  });

  it('the last incident solved: long fade back to the normal loop', () => {
    expect(crossfade('incident', 'normal')).toEqual({ fadeIn: FADES.long, fadeOut: FADES.long });
  });

  it('first music after the unlock fades in; switching music off fades out; no change, no fade', () => {
    expect(crossfade(null, 'lobby')).toEqual({ fadeIn: FADES.first, fadeOut: 0 });
    expect(crossfade('lobby', null)).toEqual({ fadeIn: 0, fadeOut: FADES.stop });
    expect(crossfade('normal', 'normal')).toEqual({ fadeIn: 0, fadeOut: 0 });
  });

  it('the normal loop and the lobby resume where they left off, the incident loop restarts from its top', () => {
    expect(RESUME).toEqual({ lobby: true, normal: true, incident: false });
  });
});

describe('equal-power curve', () => {
  const xs = Array.from({ length: 21 }, (_, i) => i / 20);

  it('a crossfade keeps the power constant (no dip in the middle, unlike a linear one)', () => {
    for (const x of xs) {
      const fin = equalPower(0, 1, 1, x);
      const fout = equalPower(1, 0, 1, x);
      expect(fin * fin + fout * fout, `x=${x}`).toBeCloseTo(1, 9);
    }
    expect(equalPower(0, 1, 1, 0.5)).toBeCloseTo(Math.SQRT1_2, 9); // −3 dB each at the midpoint
    const linear = 0.5 * 0.5 + 0.5 * 0.5;
    expect(10 * Math.log10(linear)).toBeCloseTo(-3.01, 2); // what a linear crossfade would sag
  });

  it('hits its ends exactly, scales with the track level and moves one way only', () => {
    expect(equalPower(0, 0.4, 0.4, 0)).toBe(0);
    expect(equalPower(0, 0.4, 0.4, 1)).toBeCloseTo(0.4, 12);
    expect(equalPower(0.4, 0, 0.4, 1)).toBeCloseTo(0, 12);
    expect(equalPower(0, 0.4, 0.4, 0.5)).toBeCloseTo(0.4 * Math.SQRT1_2, 9);
    for (let i = 1; i < xs.length; i++) {
      expect(equalPower(0, 1, 1, xs[i])).toBeGreaterThan(equalPower(0, 1, 1, xs[i - 1]));
      expect(equalPower(1, 0, 1, xs[i])).toBeLessThan(equalPower(1, 0, 1, xs[i - 1]));
    }
    expect(equalPower(0, 1, 0, 0.5)).toBe(0);
  });

  it('an interrupted fade carries on from where it was: the gain never jumps', () => {
    const up: Envelope = { from: 0, to: 0.7, full: 0.7, start: 10, duration: FADES.long };
    const at = 11.2;
    const g = envelopeAt(up, at);
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(0.7);
    const down: Envelope = { from: g, to: 0, full: 0.7, start: at, duration: FADES.short };
    expect(envelopeAt(down, at)).toBeCloseTo(g, 12);
    expect(envelopeAt(down, at + 0.001)).toBeCloseTo(g, 2);
    expect(envelopeAt(down, at + FADES.short)).toBe(0);
    // and back up again from there
    const again: Envelope = { from: envelopeAt(down, at + 0.1), to: 0.7, full: 0.7, start: at + 0.1, duration: FADES.long };
    expect(envelopeAt(again, at + 0.1)).toBeCloseTo(envelopeAt(down, at + 0.1), 12);
  });

  it('envelopeAt before, during and after', () => {
    const e: Envelope = { from: 0, to: 1, full: 1, start: 5, duration: 2 };
    expect(envelopeAt(e, 0)).toBe(0);
    expect(envelopeAt(e, 6)).toBeCloseTo(Math.SQRT1_2, 9);
    expect(envelopeAt(e, 9)).toBe(1);
    expect(envelopeAt({ ...e, duration: 0 }, 5)).toBe(1);
  });

  it('ramp breakpoints trace the curve closely (Web Audio has no sine ramp)', () => {
    const e: Envelope = { from: 0, to: 0.68, full: 0.68, start: 3, duration: FADES.long };
    const pts = envelopePoints(e);
    expect(pts.length).toBeGreaterThanOrEqual(8);
    expect(pts.length).toBeLessThanOrEqual(64);
    expect(pts[pts.length - 1].t).toBeCloseTo(3 + FADES.long, 9);
    expect(pts[pts.length - 1].v).toBeCloseTo(0.68, 9);
    for (let i = 1; i < pts.length; i++) expect(pts[i].t).toBeGreaterThan(pts[i - 1].t);
    // straight lines between the points stay within 0.5 % of full level of the true curve
    let prev = { t: e.start, v: e.from };
    for (const p of pts) {
      const mid = (prev.t + p.t) / 2;
      expect(Math.abs((prev.v + p.v) / 2 - envelopeAt(e, mid))).toBeLessThan(0.005 * e.full);
      prev = p;
    }
    expect(envelopePoints({ ...e, duration: 0 })).toEqual([]);
    expect(envelopePoints({ ...e, duration: FADES.short }).length).toBe(8);
  });
});

// ---------- loudness ----------

const sine = (freq: number, amp: number, seconds: number, rate: number) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate));

/** Reads a 32-bit float WAV (what `afconvert -d LEF32` writes). */
function readFloatWav(path: string): { channels: Float32Array[]; rate: number } {
  const buf = readFileSync(path);
  let off = 12;
  let ch = 0;
  let rate = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      ch = buf.readUInt16LE(off + 10);
      rate = buf.readUInt32LE(off + 12);
    }
    if (id === 'data') {
      const all = new Float32Array(buf.buffer.slice(buf.byteOffset + off + 8, buf.byteOffset + off + 8 + size));
      const n = Math.floor(all.length / ch);
      const channels = Array.from({ length: ch }, () => new Float32Array(n));
      for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) channels[c][i] = all[i * ch + c];
      return { channels, rate };
    }
    off += 8 + size + (size & 1);
  }
  throw new Error(`no audio data in ${path}`);
}

describe('loudness (BS.1770)', () => {
  it('reference tone: a full-scale 997 Hz sine on both channels is 0 LUFS, on one channel −3 LUFS', () => {
    for (const rate of [44100, 48000]) {
      const s = sine(997, 1, 3, rate);
      expect(loudness([s, s], rate)).toBeCloseTo(0, 1);
      expect(loudness([s, new Float32Array(s.length)], rate)).toBeCloseTo(-3.01, 1);
    }
  });

  it('20 dB quieter reads 20 LU lower', () => {
    const s = sine(997, 0.1, 3, 48000);
    expect(loudness([s, s], 48000)).toBeCloseTo(-20, 1);
  });

  it('K-weighting: bass counts less, presence (≈ 2–5 kHz) a little more', () => {
    const at = (f: number) => {
      const s = sine(f, 0.5, 3, 48000);
      return loudness([s, s], 48000);
    };
    const ref = at(997);
    expect(at(40) - ref).toBeLessThan(-2);
    expect(at(4000) - ref).toBeGreaterThan(2.5);
    expect(at(4000) - ref).toBeLessThan(4.5);
  });

  it('gated: silence in between does not make music read quieter; silence alone is −Infinity', () => {
    const rate = 44100;
    const tone = sine(997, 0.25, 6, rate);
    const gappy = new Float32Array(tone.length * 2);
    gappy.set(tone.subarray(0, tone.length / 2), 0);
    gappy.set(tone.subarray(tone.length / 2), tone.length * 1.5);
    expect(loudness([gappy, gappy], rate)).toBeCloseTo(loudness([tone, tone], rate), 0);
    expect(loudness([new Float32Array(rate * 2)], rate)).toBe(-Infinity);
    expect(loudness([new Float32Array(100)], rate)).toBe(-Infinity);
  });

  it('per-track gains bring all three loops to the normal loop’s loudness', () => {
    const gains = loudnessGains();
    expect(gains.normal).toBe(1);
    for (const t of ['lobby', 'normal', 'incident'] as MusicTrack[]) {
      expect(MUSIC_LUFS[t] + 20 * Math.log10(gains[t]), t).toBeCloseTo(MUSIC_LUFS.normal, 1);
    }
    // the incident loop is mastered far hotter than the others
    expect(gains.incident).toBeLessThan(0.4);
    // a quiet track is boosted at most ×2 (+6 dB)
    expect(loudnessGains({ lobby: -40, normal: -18, incident: -18 }).lobby).toBe(2);
    expect(loudnessGains({ lobby: -Infinity, normal: -18, incident: -18 }).lobby).toBe(1); // silent: left alone
  });

  // The constants are only worth something if they match the files: measure them again (macOS has a
  // decoder built in; other systems skip this).
  const afconvert = '/usr/bin/afconvert';
  it.skipIf(process.platform !== 'darwin' || !existsSync(afconvert))(
    'MUSIC_LUFS matches the music files as they are now',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'khu-loudness-'));
      try {
        for (const track of ['lobby', 'normal', 'incident'] as MusicTrack[]) {
          const wav = join(dir, `${track}.wav`);
          execFileSync(afconvert, ['-f', 'WAVE', '-d', 'LEF32', fileURLToPath(new URL(`../public/assets/audio/bgm_${track}.m4a`, import.meta.url)), wav]);
          const { channels, rate } = readFloatWav(wav);
          expect(Math.abs(loudness(channels, rate) - MUSIC_LUFS[track]), `bgm_${track}.m4a: update MUSIC_LUFS`).toBeLessThan(0.3);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});


describe('trimSilence (loop points)', () => {
  const sr = 1000;
  const sig = (lead: number, body: number, tail: number, v = 0.5) => new Float32Array([...Array(lead).fill(0), ...Array(body).fill(v), ...Array(tail).fill(0.0001)]);

  it('cuts encoder padding at both ends', () => {
    expect(trimSilence([sig(48, 900, 20)], sr)).toEqual({ start: 0.048, end: 0.948 });
  });
  it('any loud channel counts', () => {
    const left = sig(100, 800, 0);
    const right = new Float32Array(900).fill(0);
    right[10] = 0.3;
    expect(trimSilence([left, right], sr).start).toBe(0.01);
  });
  it('never cuts more than maxTrim (a quiet intro stays)', () => {
    expect(trimSilence([sig(500, 400, 300)], sr, { maxTrim: 0.25 })).toEqual({ start: 0.25, end: 0.95 });
  });
  it('content right at the edges is untouched; all-silent stays whole', () => {
    expect(trimSilence([sig(0, 1000, 0)], sr)).toEqual({ start: 0, end: 1 });
    expect(trimSilence([new Float32Array(1000)], sr)).toEqual({ start: 0, end: 1 });
    expect(trimSilence([new Float32Array(0)], sr)).toEqual({ start: 0, end: 0 });
  });
});

// ---------- alarm ----------

/** Manual clock + timer queue standing in for performance.now / setTimeout. */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const beeps: number[] = [];
  const cuts: number[] = [];
  const advance = (sec: number) => {
    const end = now + sec;
    for (;;) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= end + 1e-9).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = end;
  };
  const alarm = createAlarm({
    now: () => now,
    beep: () => beeps.push(Math.round(now * 1000) / 1000),
    cut: () => cuts.push(now),
    setTimer: (fn, ms) => {
      timers.set(++seq, { at: now + ms / 1000, fn });
      return seq;
    },
    clearTimer: (id) => timers.delete(id),
  });
  return { alarm, beeps, cuts, advance, timers };
}

describe('alarm cycle', () => {
  it('beeps at once, then every 3.5 s, 4 times in all, then stops', () => {
    const c = fakeClock();
    c.alarm.start();
    expect(c.beeps).toEqual([0]); // immediate, not on the next task
    c.advance(30);
    expect(c.beeps).toEqual([0, 3.5, 7, 10.5]);
    expect(c.alarm.pending).toBe(0);
    expect(ALARM).toMatchObject({ count: 4, interval: 3.5 });
  });

  it('a new incident restarts the cycle', () => {
    const c = fakeClock();
    c.alarm.start();
    c.advance(6); // beeps at 0, 3.5
    c.alarm.start(); // second incident at t=6 (the 3.5 s beep has finished)
    c.advance(30);
    expect(c.beeps).toEqual([0, 3.5, 6, 9.5, 13, 16.5]);
  });

  it('never overlaps: a restart during a beep waits for it to end', () => {
    const c = fakeClock();
    c.alarm.start();
    c.advance(0.5);
    c.alarm.start();
    c.advance(30);
    expect(c.beeps).toEqual([0, ALARM.length, ALARM.length + 3.5, ALARM.length + 7, ALARM.length + 10.5]);
    for (let i = 1; i < c.beeps.length; i++) expect(c.beeps[i] - c.beeps[i - 1]).toBeGreaterThanOrEqual(ALARM.length - 1e-9);
  });

  it('stop cancels the rest at once and cuts a beep that is still sounding', () => {
    const c = fakeClock();
    c.alarm.start();
    c.advance(4); // beeps 0, 3.5; the 3.5 one is still sounding
    c.alarm.stop();
    expect(c.cuts).toEqual([4]);
    expect(c.alarm.pending).toBe(0);
    c.advance(30);
    expect(c.beeps).toEqual([0, 3.5]);
    // stopping when nothing sounds doesn't cut; a later incident starts fresh and immediately
    c.alarm.stop();
    expect(c.cuts).toEqual([4]);
    c.alarm.start();
    expect(c.beeps).toEqual([0, 3.5, 34]);
  });

  it('alarmTimes', () => {
    expect(alarmTimes(10, null)).toEqual([10, 13.5, 17, 20.5]);
    expect(alarmTimes(10, 2)).toEqual([10, 13.5, 17, 20.5]);
    expect(alarmTimes(10, 9.5)).toEqual([9.5 + ALARM.length, 9.5 + ALARM.length + 3.5, 9.5 + ALARM.length + 7, 9.5 + ALARM.length + 10.5]);
  });
});


// ---------- win jingle & coin ----------

describe('win jingle cue', () => {
  const card = (scenarioId: string) => ({ scenarioId });
  const playing = (concepts: { scenarioId: string }[], dialogue: { then: string } | null = null) => view('playing', [], { concepts, dialogue });

  it('plays when an incident card pops up, not for objective cards', () => {
    expect(jingleCue(playing([]), playing([card('dhcp-off')]))).toBe('card');
    expect(jingleCue(playing([]), playing([card('objective:ping')]))).toBeNull();
  });

  it('plays for the next card when the first is dismissed, not while the same card stays up', () => {
    const a = card('a');
    const b = card('b');
    expect(jingleCue(playing([a, b]), playing([a, b]))).toBeNull();
    expect(jingleCue(playing([a]), playing([a, b]))).toBeNull(); // queued behind a
    expect(jingleCue(playing([a, b]), playing([b]))).toBe('card');
  });

  it('waits until the card is actually shown (hidden during the intro, shown during the outro)', () => {
    const a = card('a');
    expect(visibleCard(playing([a], { then: 'play' }))).toBeNull();
    expect(jingleCue(playing([], { then: 'play' }), playing([a], { then: 'play' }))).toBeNull();
    expect(jingleCue(playing([a], { then: 'play' }), playing([a]))).toBe('card');
    expect(visibleCard(playing([a], { then: 'results' }))).toBe(a);
    expect(visibleCard(view('results', null, { concepts: [a] }))).toBeNull();
  });

  it('plays when the stage clear popup appears, and when the ending certificate appears', () => {
    expect(jingleCue(playing([]), view('results', []))).toBe('results');
    expect(jingleCue(view('results', []), view('results', []))).toBeNull();
    expect(jingleCue(view('results', []), view('ending', null))).toBe('ending');
    expect(jingleCue(view('ending', null), view('ending', null))).toBeNull();
    expect(jingleCue(view('select', null), view('title', null))).toBeNull();
  });

  it('two cues within ~1 s play once', () => {
    expect(jingleAllowed(null, 5)).toBe(true);
    expect(jingleAllowed(5, 5.4)).toBe(false);
    expect(jingleAllowed(5, 5.99)).toBe(false);
    expect(jingleAllowed(5, 6)).toBe(true);
    expect(jingleAllowed(5, 30)).toBe(true);
  });
});

describe('coin cue', () => {
  const at = (t: number, done: Record<string, number>, cards: string[] = [], screen = 'playing', stage = 3): AudioView => ({
    ...view(screen, []),
    run: { stage, ctx: { stageTime: t }, scenarios: [], objectivesDone: done },
    save: { cards },
  });

  it('an objective done in this run', () => {
    expect(newObjectives(at(5, {}), at(5, { start: 5 }))).toEqual(['start']);
    expect(coinCue(at(5, {}), at(5, { start: 5 }))).toBe(true);
    expect(coinCue(at(5, { start: 5 }), at(6, { start: 5 }))).toBe(false); // nothing new
  });

  it('not for a new run (retry, next stage) or off the play screen', () => {
    expect(coinCue(at(50, {}), at(0, { start: 0 }))).toBe(false); // a retry starts at 0
    expect(coinCue(at(5, {}, [], 'playing', 3), at(5, { start: 5 }, [], 'playing', 4))).toBe(false);
    expect(coinCue(at(5, {}), at(5, { start: 5 }, [], 'results'))).toBe(false);
  });

  it('a card new to the collection; one already collected (a replay) stays quiet', () => {
    expect(newCards(at(5, {}, ['port']), at(5, {}, ['port', 'tcp']))).toEqual(['tcp']);
    expect(coinCue(at(5, {}, ['port']), at(5, {}, ['port', 'tcp']))).toBe(true);
    expect(coinCue(at(5, {}, ['port']), at(5, {}, ['port']))).toBe(false);
    expect(coinCue(at(5, {}, []), at(5, {}, ['port'], 'title'))).toBe(false); // e.g. a save loaded elsewhere
  });
});

describe('planCues: one coin per moment, jingle after the coin', () => {
  const none = { lastCoin: null, lastJingle: null };

  it('a coin alone, a jingle alone: right away', () => {
    expect(planCues({ coin: true, jingle: null }, 10, none).plays).toEqual([{ sfx: 'coin', delay: 0 }]);
    expect(planCues({ coin: false, jingle: 'card' }, 10, none).plays).toEqual([{ sfx: 'win', delay: 0 }]);
    expect(planCues({ coin: false, jingle: null }, 10, none).plays).toEqual([]);
  });

  it('an incident fixed with a new card: the coin first, the jingle ~0.5 s later', () => {
    const { plays, clock } = planCues({ coin: true, jingle: 'card' }, 10, none);
    expect(plays).toEqual([
      { sfx: 'coin', delay: 0 },
      { sfx: 'win', delay: JINGLE_AFTER_COIN },
    ]);
    expect(JINGLE_AFTER_COIN).toBeGreaterThanOrEqual(0.4);
    expect(JINGLE_AFTER_COIN).toBeLessThanOrEqual(0.6);
    expect(clock).toEqual({ lastCoin: 10, lastJingle: 10 + JINGLE_AFTER_COIN });
  });

  it('a jingle right after a coin (separate moments) still waits for the rest of the 0.5 s', () => {
    const c = planCues({ coin: true, jingle: null }, 10, none).clock;
    expect(planCues({ coin: false, jingle: 'results' }, 10.2, c).plays).toEqual([{ sfx: 'win', delay: 0.3 }]);
    expect(planCues({ coin: false, jingle: 'results' }, 11, c).plays).toEqual([{ sfx: 'win', delay: 0 }]);
  });

  it('no pile-up: coins in the same instant play once, a coin waits out a jingle about to start, jingles 1 s apart', () => {
    let clock = planCues({ coin: true, jingle: null }, 10, none).clock;
    expect(planCues({ coin: true, jingle: null }, 10 + COIN_GAP / 2, clock).plays).toEqual([]);
    expect(planCues({ coin: true, jingle: null }, 10.4, clock).plays).toEqual([{ sfx: 'coin', delay: 0 }]);
    clock = planCues({ coin: true, jingle: 'card' }, 20, none).clock; // jingle due at 20.5
    expect(planCues({ coin: true, jingle: null }, 20.3, clock).plays).toEqual([]);
    expect(planCues({ coin: false, jingle: 'card' }, 21, clock).plays).toEqual([]); // 0.5 s after the last jingle
    expect(planCues({ coin: true, jingle: 'card' }, 22, clock).plays.map((p) => p.sfx)).toEqual(['coin', 'win']);
  });
});

describe('audio setting', () => {
  it('sound is on by default and for anything unreadable', () => {
    expect(parseAudioPref(null)).toEqual({ muted: false });
    expect(parseAudioPref('')).toEqual({ muted: false });
    expect(parseAudioPref('{oops')).toEqual({ muted: false });
    expect(parseAudioPref('"muted"')).toEqual({ muted: false });
    expect(parseAudioPref('{"muted":"yes"}')).toEqual({ muted: false });
    expect(parseAudioPref('{"muted":false}')).toEqual({ muted: false });
    expect(parseAudioPref('{"muted":true}')).toEqual({ muted: true });
  });
});
