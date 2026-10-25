// v1: needs stage content (ported in WP3). Excluded from the suite.
// Pure audio rules (src/audio/logic.ts): Hangul → animalese letters, voice pitches, which music plays
// where, crossfade lengths and their equal-power curve, loudness matching, the 4-beep alarm cycle, the
// coin and win-jingle cues (driven by the real store too) and loop-point trimming.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The store reads localStorage when it is created: give it one (node has none) before it loads.
const storage = vi.hoisted(() => {
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
  createCueTracker,
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
  type CuePlay,
  type Envelope,
  type MusicTrack,
} from '../../src/audio/logic';
import { STAGES } from '../../src/content/stages';
import { startStage, tickRun, type StageRun } from '../../src/sim/engine';
import { gameStore } from '../../src/store/game';

describe('cue tracker on the real store', () => {
  const S = () => gameStore.getState();
  let now = 100;
  let queue: (() => void)[] = [];
  let plays: { sfx: CuePlay['sfx']; at: number }[] = [];
  let unsubscribe = () => {};

  /** One player action or tick, then the end-of-action flush (the game's microtask). Returns its plays. */
  const act = (fn: () => void, wait = 3) => {
    now += wait;
    const before = plays.length;
    fn();
    queue.splice(0).forEach((f) => f());
    return plays.slice(before);
  };
  const drainIntro = () => {
    for (let i = 0; i < 50 && S().dialogue; i++) S().nextDialogue();
  };
  /** Runs a terminal line on `host` in a throwaway session. */
  const cmd = (host: string, line: string) => {
    gameStore.setState({ terminal: { host, log: [] } });
    S().command(line);
  };

  beforeEach(() => {
    storage.clear();
    gameStore.setState({ save: { unlocked: 7, best: {}, cards: [] }, screen: 'select', run: null, dialogue: null, concepts: [] });
    now = 100;
    queue = [];
    plays = [];
    const tracker = createCueTracker({
      now: () => now,
      defer: (fn) => queue.push(fn),
      play: (p) => plays.push({ sfx: p.sfx, at: Math.round((now + p.delay) * 1000) / 1000 }),
    });
    let prev = S();
    unsubscribe = gameStore.subscribe((s) => {
      tracker.observe(prev, s);
      prev = s;
    });
  });
  afterEach(() => unsubscribe());

  it('stage 0: a coin per objective, one for an objective and its new card together, the jingle on the clear popup', () => {
    expect(act(() => (S().play(0), drainIntro()))).toEqual([]);
    expect(act(() => S().event('open:dashboard'))).toEqual([{ sfx: 'coin', at: now }]);
    expect(act(() => S().event('open:mentor'))).toEqual([{ sfx: 'coin', at: now }]);
    expect(act(() => S().event('room:server', 'room:network', 'room:power', 'room:cooling', 'room:noc'))).toEqual([{ sfx: 'coin', at: now }]);
    // The quiz objective gives the 'datacenter' card (new) and clears the stage: still one coin.
    expect(S().save.cards).not.toContain('datacenter');
    expect(act(() => S().event('quiz:correct'))).toEqual([{ sfx: 'coin', at: now }]);
    expect(S().save.cards).toContain('datacenter');
    expect(S().dialogue?.then).toBe('results');
    // Objective cards don't jingle; the clear popup does, after the outro.
    expect(act(() => S().dismissConcept())).toEqual([]);
    const outro: { sfx: string; at: number }[] = [];
    for (let i = 0; i < 50 && S().dialogue; i++) outro.push(...act(() => S().nextDialogue(), 1));
    expect(S().screen).toBe('results');
    expect(outro).toEqual([{ sfx: 'win', at: now }]);

    // A replay: objectives still ring, the card is not new any more — one coin either way.
    act(() => (S().finishResults('retry'), drainIntro()));
    act(() => S().event('room:server', 'room:network', 'room:power', 'room:cooling', 'room:noc'));
    expect(act(() => S().event('quiz:correct'))).toEqual([{ sfx: 'coin', at: now }]);
  });

  it('stage 3: fixing an incident with a new card plays the coin, then the jingle 0.5 s later; on a replay only the jingle', () => {
    const fixPort = () => {
      act(() => (S().play(3), drainIntro()));
      expect(act(() => cmd('web', 'server start'))).toEqual([{ sfx: 'coin', at: now }]);
      for (let i = 0; i < 30 && !S().run?.scenarios.some((x) => x.id === 's3-port' && x.state === 'active'); i++) act(() => S().tick(), 1);
      expect(S().run?.scenarios.find((x) => x.id === 's3-port')?.state).toBe('active');
      act(() => cmd('web', 'server set port 80'));
      const out: { sfx: string; at: number }[] = [];
      for (let i = 0; i < 5 && S().run?.scenarios.find((x) => x.id === 's3-port')?.state !== 'resolved'; i++) out.push(...act(() => S().tick(), 1));
      expect(S().concepts[0]?.scenarioId).toBe('s3-port');
      return out;
    };
    expect(fixPort()).toEqual([
      { sfx: 'coin', at: now },
      { sfx: 'win', at: now + JINGLE_AFTER_COIN },
    ]);
    expect(S().save.cards).toContain('port');
    expect(fixPort()).toEqual([{ sfx: 'win', at: now }]);
  });

  it('the jingle once more on the ending certificate', () => {
    act(() => (S().play(7), drainIntro()));
    expect(act(() => gameStore.setState({ screen: 'results', dialogue: null, concepts: [] }))).toEqual([{ sfx: 'win', at: now }]);
    expect(act(() => S().finishResults('next'), 10)).toEqual([{ sfx: 'win', at: now }]);
    expect(S().screen).toBe('ending');
    expect(act(() => S().goTitle())).toEqual([]);
  });

  it('music along the way: lobby, long fade into the stage, short into an incident, long back, long out', () => {
    const fades: string[] = [];
    let track = musicFor(S());
    const off = gameStore.subscribe((s) => {
      const next = musicFor(s);
      if (next === track) return;
      const f = crossfade(track, next);
      fades.push(`${track}→${next} ${f.fadeIn}s`);
      track = next;
    });
    try {
      expect(track).toBe('lobby');
      S().play(3);
      drainIntro();
      cmd('web', 'server start');
      for (let i = 0; i < 30 && musicFor(S()) !== 'incident'; i++) S().tick();
      cmd('web', 'server set port 80');
      for (let i = 0; i < 5 && musicFor(S()) === 'incident'; i++) S().tick();
      S().goSelect();
    } finally {
      off();
    }
    expect(fades).toEqual([`lobby→normal ${FADES.long}s`, `normal→incident ${FADES.short}s`, `incident→normal ${FADES.long}s`, `normal→lobby ${FADES.long}s`]);
  });
});

