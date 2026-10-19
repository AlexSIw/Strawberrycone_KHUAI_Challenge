// Pure audio rules (src/audio/logic.ts): Hangul → animalese letters, voice pitches, which music plays,
// the 4-beep alarm cycle, the win-jingle cues and loop-point trimming.
import { describe, expect, it } from 'vitest';
import {
  ALARM,
  activeIncidents,
  alarmTimes,
  blipLetter,
  createAlarm,
  hangulToLetter,
  jingleAllowed,
  jingleCue,
  letterOffset,
  musicFor,
  newlyActive,
  parseAudioPref,
  sameRun,
  towardIsabelle,
  trimSilence,
  visibleCard,
  VOICE_PITCH,
  type AudioView,
} from '../src/audio/logic';
import { STAGES } from '../src/content/stages';
import { startStage, tickRun, type StageRun } from '../src/sim/engine';

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
  run: scenarios ? { stage: 2, ctx: { stageTime: 10 }, scenarios } : null,
  dialogue: null,
  concepts: [],
  ...extra,
});

describe('musicFor', () => {
  it('normal loop on every screen without an incident', () => {
    for (const screen of ['title', 'select', 'results', 'ending']) expect(musicFor(view(screen, null))).toBe('normal');
    expect(musicFor(view('playing', [{ id: 'a', state: 'waiting' }]))).toBe('normal');
    expect(musicFor(view('playing', [{ id: 'a', state: 'resolved' }]))).toBe('normal');
  });

  it('incident loop while any incident is active', () => {
    expect(musicFor(view('playing', [{ id: 'a', state: 'resolved' }, { id: 'b', state: 'active' }]))).toBe('incident');
    // leaving the stage (or the results screen) goes back to normal even with stale run data
    expect(musicFor(view('select', [{ id: 'b', state: 'active' }]))).toBe('normal');
    expect(musicFor(view('results', [{ id: 'b', state: 'active' }]))).toBe('normal');
  });

  it('follows a real stage run', () => {
    let found = 0;
    for (const def of STAGES) {
      let run: StageRun = startStage(def.id);
      expect(musicFor({ screen: 'playing', run })).toBe('normal');
      for (let i = 0; i < 400 && activeIncidents({ screen: 'playing', run }).length === 0; i++) run = tickRun(run).run;
      if (activeIncidents({ screen: 'playing', run }).length) {
        found++;
        expect(musicFor({ screen: 'playing', run })).toBe('incident');
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('newlyActive / sameRun', () => {
    expect(newlyActive(['a'], ['a', 'b'])).toEqual(['b']);
    expect(newlyActive(['a', 'b'], ['b'])).toEqual([]);
    const r = (stage: number, t: number) => ({ screen: 'playing', run: { stage, ctx: { stageTime: t }, scenarios: [] } });
    expect(sameRun(r(3, 5), r(3, 6))).toBe(true);
    expect(sameRun(r(3, 50), r(3, 0))).toBe(false); // retry
    expect(sameRun(r(3, 5), r(4, 6))).toBe(false);
    expect(sameRun({ screen: 'title', run: null }, r(3, 0))).toBe(false);
  });
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

// ---------- win jingle ----------

describe('win jingle', () => {
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

  it('plays when the results screen appears', () => {
    expect(jingleCue(playing([]), view('results', []))).toBe('results');
    expect(jingleCue(view('results', []), view('results', []))).toBeNull();
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
