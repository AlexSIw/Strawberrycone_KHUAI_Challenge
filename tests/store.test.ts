// Store rules behind the UI, independent of the day content: the window back-stack, terminal sessions per
// place (and network-gear consoles), the walking speed, alarm toasts, the save (seed, 이어하기), and the
// coin / jingle cues. D-5 is played with made-up missions and incidents.
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

import { createCueTracker, crossfade, FADES, JINGLE_AFTER_COIN, musicFor, type CuePlay } from '../src/audio/logic';
import { getStage } from '../src/content/stages';
import type { Objective } from '../src/content/types';
import { initRuntime, type Scenario, type Trigger } from '../src/sim/scenario';
import { LAST_DAY, type StageId } from '../src/sim/types';
import { gameStore, nextMoveSpeed, pushWindow, SAVE_KEY, SPEED_KEY, windowKey, type Modal } from '../src/store/game';

const S = () => gameStore.getState();
/** The open window and the ones waiting under it, top first, as window keys. */
const windows = () => [S().modal, ...[...S().modalStack].reverse()].filter((m): m is Modal => !!m).map(windowKey);

// ---------- a made-up D-5 ----------

const DAY = getStage(0);
const MISSIONS: Objective[] = [
  { id: 't-a', text: '테스트 목표 A', done: (_w, c) => c.events.includes('t:a') },
  { id: 't-b', text: '테스트 목표 B', done: (_w, c) => c.events.includes('t:b'), concept: 'datacenter', lesson: '테스트' },
];
Object.assign(DAY, { objectives: MISSIONS, intro: [{ who: 'boss', text: '시작' }], outro: [{ who: 'lion', text: '끝' }] });

function synth(id: string, over: Partial<Scenario> = {}): Scenario {
  return {
    id,
    stage: 0,
    title: `${id} 장애`,
    alert: `${id}: 포털이 안 열려요`,
    severity: 'major',
    alarm: { source: 'trap', device: 'CAMPUS-ENG', text: `${id} 링크 다운` },
    room: 'network',
    trigger: { type: 'stageStart' },
    inject: (w) => void (w.flags[id] = true),
    check: (w) => !w.flags[id],
    hints: ['관찰', '방향', '도구'],
    bannedPhrases: [],
    solution: '',
    solutionSteps: [],
    concept: 'spof',
    lesson: '테스트',
    ...over,
  };
}
DAY.scenarios.push(synth('s-trap'), synth('s-poll', { severity: 'critical', alarm: { source: 'poll', device: 'TOR-01', text: '업링크 사용률 100%' } }));

/** Starts a day with its briefing clicked through; on D-5 only `plan` happens. */
function play(stage: StageId, plan: { id: string; trigger: Trigger }[] = []) {
  S().play(stage);
  for (let i = 0; i < 50 && S().dialogue; i++) S().nextDialogue();
  if (stage === 0) gameStore.setState({ run: { ...S().run!, scenarios: initRuntime(plan) } });
}
const tickUntil = (until: () => boolean, max = 120) => {
  for (let i = 0; i < max && !until(); i++) {
    for (let j = 0; j < 20 && S().concepts.length; j++) S().dismissConcept();
    S().tick();
  }
};
const scState = (id: string) => S().run?.scenarios.find((x) => x.id === id)?.state;
const fixIt = (id: string) => S().act((w) => void (w.flags[id] = false));

describe('window stack', () => {
  beforeEach(() => play(0));

  it('a window opened from another one goes back to it when closed', () => {
    S().openModal({ type: 'terminal', host: 'ops' });
    S().openModal({ type: 'hint', scenarioId: 's-trap' });
    expect(windows()).toEqual(['hint', 'terminal:ops']);
    S().closeModal();
    expect(S().modal).toEqual({ type: 'terminal', host: 'ops' });
    expect(S().modalStack).toEqual([]);
    S().closeModal();
    expect(S().modal).toBeNull();
    // Closing with nothing open is harmless.
    S().closeModal();
    expect(windows()).toEqual([]);
  });

  it('the terminal comes back with its session (host, scrollback, history, half-typed line)', () => {
    play(1);
    S().openModal({ type: 'terminal', host: 'ops' });
    S().appendTerminal(['hello']);
    S().command('ssh web');
    S().setTerminalDraft('hostna');
    const session = S().terminal;
    expect(session.host).toBe('web');
    S().openModal({ type: 'concepts' });
    S().closeModal();
    expect(S().modal).toEqual({ type: 'terminal', host: 'ops' });
    expect(S().terminal).toBe(session);
    expect(S().terminalOrigin).toBe('ops');
  });

  it('the `hint` command opens the radio on top of the terminal', () => {
    S().openModal({ type: 'terminal', host: 'ops' });
    S().command('hint');
    expect(windows()).toEqual(['hint', 'terminal:ops']);
    expect(S().run!.ctx.events).toContain('open:mentor');
    S().closeModal();
    expect(windows()).toEqual(['terminal:ops']);
    expect(S().terminal.history).toEqual(['hint']);
  });

  it('the same window again is updated in place, not stacked', () => {
    S().openModal({ type: 'terminal', host: 'ops' });
    S().openModal({ type: 'hint' });
    S().openModal({ type: 'hint', scenarioId: 's-trap' });
    expect(windows()).toEqual(['hint', 'terminal:ops']);
    expect(S().modal).toEqual({ type: 'hint', scenarioId: 's-trap' });
  });

  it('a window already waiting underneath is brought back, never duplicated', () => {
    S().openModal({ type: 'terminal', host: 'ops' });
    S().openModal({ type: 'hint' });
    S().openModal({ type: 'noc', tab: 'nms' });
    expect(windows()).toEqual(['noc', 'hint', 'terminal:ops']);
    // Back to the radio (e.g. 쿠사수에게 묻기 on an alarm): the NOC opened on top of it closes.
    S().openModal({ type: 'hint', scenarioId: 's-trap' });
    expect(windows()).toEqual(['hint', 'terminal:ops']);
    expect(S().modal).toEqual({ type: 'hint', scenarioId: 's-trap' });
    S().openModal({ type: 'concepts' });
    S().openModal({ type: 'terminal', host: 'ops' });
    expect(windows()).toEqual(['terminal:ops']);
  });

  it('the console chooser is replaced by the terminal it opens (but stays under the radio)', () => {
    S().openModal({ type: 'consolePick', hosts: ['web', 'db'] });
    S().openModal({ type: 'terminal', host: 'web' });
    expect(windows()).toEqual(['terminal:web']);
    S().closeModal();
    expect(S().modal).toBeNull();

    S().openModal({ type: 'consolePick', hosts: ['web', 'db'] });
    S().openModal({ type: 'hint' });
    expect(windows()).toEqual(['hint', 'consolePick']);
    S().closeModal();
    expect(S().modal?.type).toBe('consolePick');
  });

  it("each place's terminal is its own window, and gets its own session back", () => {
    S().openModal({ type: 'terminal', host: 'ops' });
    S().appendTerminal(['desk line']);
    S().openModal({ type: 'terminal', host: 'web' });
    expect(windows()).toEqual(['terminal:web', 'terminal:ops']);
    expect(S().terminalOrigin).toBe('web');
    expect(S().terminal.log).toEqual([]);
    S().appendTerminal(['console line']);
    S().closeModal();
    expect(S().terminalOrigin).toBe('ops');
    expect(S().terminal.log).toEqual(['desk line']);
    expect(S().terminals.web.log).toEqual(['console line']);
  });

  it('`fixing` (the lion works on a device) follows the window on top', () => {
    S().openModal({ type: 'terminal', host: 'ops' });
    expect(S().fixing).toBe(true);
    S().openModal({ type: 'noc' });
    expect(S().fixing).toBe(false);
    S().closeModal();
    expect(S().fixing).toBe(true);
    S().closeModal();
    expect(S().fixing).toBe(false);
  });

  it('restarting the day, leaving it and the day ending close every window', () => {
    const stack = () => {
      S().openModal({ type: 'terminal', host: 'ops' });
      S().openModal({ type: 'hint' });
      S().openModal({ type: 'concepts' });
      expect(windows()).toHaveLength(3);
    };
    stack();
    play(0);
    expect(windows()).toEqual([]);
    stack();
    S().goSelect();
    expect(windows()).toEqual([]);
    play(0);
    stack();
    S().goTitle();
    expect(windows()).toEqual([]);

    // The day ends when its last mission is done, with windows open.
    play(0);
    S().event('t:a');
    S().openModal({ type: 'noc' });
    S().openModal({ type: 'hint' });
    expect(windows()).toEqual(['hint', 'noc']);
    S().event('t:b');
    expect(S().dialogue?.then).toBe('results');
    expect(windows()).toEqual([]);
    expect(S().fixing).toBe(false);
  });

  it('pushWindow on its own', () => {
    const term: Modal = { type: 'terminal', host: 'ops' };
    const hint: Modal = { type: 'hint' };
    expect(pushWindow(null, [], term)).toEqual([]);
    expect(pushWindow(term, [], hint)).toEqual([term]);
    expect(pushWindow(hint, [term], { type: 'hint', scenarioId: 'x' })).toEqual([term]);
    expect(pushWindow(hint, [term], { type: 'terminal', host: 'ops' })).toEqual([]);
    expect(pushWindow(hint, [term], { type: 'terminal', host: 'web' })).toEqual([term, hint]);
    expect(pushWindow({ type: 'consolePick', hosts: ['a'] }, [], term)).toEqual([]);
    expect(pushWindow({ type: 'consolePick', hosts: ['a'] }, [], hint)).toEqual([{ type: 'consolePick', hosts: ['a'] }]);
  });
});

describe('network gear sessions', () => {
  it('a console place on a switch starts at its `>` prompt', () => {
    play(0);
    S().openModal({ type: 'terminal', host: 'TOR-01' });
    expect(S().terminalOrigin).toBe('TOR-01');
    expect(S().terminal).toMatchObject({ host: 'TOR-01', mode: { level: 'user' } });
    // A server's console is a shell.
    S().openModal({ type: 'terminal', host: 'web' });
    expect(S().terminal.mode ?? null).toBeNull();
  });

  it('leaving the device on its own console frees the line instead of dropping to the 관리 PC', () => {
    play(0);
    S().openModal({ type: 'terminal', host: 'TOR-01' });
    S().command('enable');
    expect(S().terminal.mode).toEqual({ level: 'exec' });
    const out = S().command('exit');
    expect(S().terminal).toMatchObject({ host: 'TOR-01', mode: { level: 'user' } });
    expect(out.lines.join('\n')).toContain('Press RETURN to get started.');
    S().command('exit');
    expect(S().terminal).toMatchObject({ host: 'TOR-01', mode: { level: 'user' } });
    expect(S().terminal.history).toEqual(['enable', 'exit']);
  });

  it('ssh from the 관리 PC lands at the `>` prompt, and exit goes back to the 관리 PC', () => {
    play(1);
    S().openModal({ type: 'terminal', host: 'ops' });
    S().command('ssh TOR-01');
    expect(S().terminal).toMatchObject({ host: 'TOR-01', mode: { level: 'user' } });
    S().command('exit');
    expect(S().terminal.host).toBe('ops');
    expect(S().terminal.mode ?? null).toBeNull();
  });

  it('a line run without recording (Ctrl+Z → end) stays out of the ↑ history', () => {
    play(0);
    S().openModal({ type: 'terminal', host: 'TOR-01' });
    S().command('enable');
    S().command('end', false);
    expect(S().terminal.history).toEqual(['enable']);
    expect(S().run!.ctx.commands).toContain('end');
  });
});

describe('walking speed', () => {
  it('cycles 1x → 1.5x → 2x → 1x and is remembered', () => {
    expect(nextMoveSpeed(1)).toBe(1.5);
    expect(nextMoveSpeed(1.5)).toBe(2);
    expect(nextMoveSpeed(2)).toBe(1);
    gameStore.setState({ moveSpeed: 1 });
    S().cycleMoveSpeed();
    expect(S().moveSpeed).toBe(1.5);
    expect(storage.get(SPEED_KEY)).toBe('1.5');
    S().cycleMoveSpeed();
    expect(S().moveSpeed).toBe(2);
    expect(storage.get(SPEED_KEY)).toBe('2');
    S().cycleMoveSpeed();
    expect(S().moveSpeed).toBe(1);
    expect(storage.get(SPEED_KEY)).toBe('1');
  });

  it('a new day keeps the speed', () => {
    gameStore.setState({ moveSpeed: 2 });
    play(2);
    expect(S().moveSpeed).toBe(2);
  });
});

describe('toasts: the call from users, then the NMS alarm', () => {
  const texts = () => S().toasts.map((t) => `${t.source ?? '-'}|${t.text}`);

  it('a trap: the 📞 complaint and the 🚨 alarm together; both go when the incident is fixed', () => {
    play(0, [{ id: 's-trap', trigger: { type: 'stageStart', delay: 2 } }]);
    tickUntil(() => scState('s-trap') === 'active');
    expect(texts()).toEqual(['user|📞 s-trap: 포털이 안 열려요', 'nms|🚨 Major(중요) · CAMPUS-ENG: s-trap 링크 다운']);
    expect(S().toasts.every((t) => t.kind === 'alert' && t.scenarioId === 's-trap')).toBe(true);
    fixIt('s-trap');
    S().tick();
    expect(scState('s-trap')).toBe('resolved');
    expect(texts()).toEqual(["-|🎉 's-trap 장애' 장애를 해결했어요!"]);
  });

  it('a polled metric: users call first, the alarm only shows at the next poll', () => {
    play(0, [{ id: 's-poll', trigger: { type: 'stageStart', delay: 2 } }]);
    tickUntil(() => scState('s-poll') === 'active');
    expect(texts()).toEqual(['user|📞 s-poll: 포털이 안 열려요']);
    tickUntil(() => S().run!.alarms.length > 0);
    expect(S().run!.ctx.stageTime % 15).toBe(0);
    expect(texts()).toEqual(['user|📞 s-poll: 포털이 안 열려요', 'nms|🚨 Critical(긴급) · TOR-01: 업링크 사용률 100%']);
  });

  it('fixed before the poll: no alarm toast ever', () => {
    play(0, [{ id: 's-poll', trigger: { type: 'stageStart', delay: 2 } }]);
    tickUntil(() => scState('s-poll') === 'active');
    fixIt('s-poll');
    tickUntil(() => S().run!.ctx.stageTime >= 40);
    expect(S().toasts.some((t) => t.source === 'nms')).toBe(false);
  });

  it('ACK and escalate go through the store', () => {
    play(0, [{ id: 's-trap', trigger: { type: 'stageStart', delay: 1 } }]);
    tickUntil(() => S().run!.alarms.length > 0);
    S().ackAlarm('s-trap');
    expect(S().run!.alarms[0].ackAt).toBe(S().run!.ctx.stageTime);
    // Not a shallow incident: nothing happens, no toast.
    const before = S().run;
    S().escalate('s-trap');
    expect(S().run).toBe(before);
  });
});

describe('save', () => {
  afterEach(() => vi.resetModules());

  /** A fresh copy of the store module, as on a page load. */
  const reload = async () => (await import('../src/store/game')).gameStore;

  it('a save without a seed gets one, written back at once, and it stays the same across loads', async () => {
    storage.clear();
    storage.set(SAVE_KEY, JSON.stringify({ unlocked: 2, best: {}, cards: ['dns'] }));
    vi.resetModules();
    const a = (await reload()).getState().save;
    expect(a.seed).toBeGreaterThan(0);
    expect(a).toMatchObject({ unlocked: 2, cards: ['dns'] });
    expect(JSON.parse(storage.get(SAVE_KEY)!).seed).toBe(a.seed);
    vi.resetModules();
    expect((await reload()).getState().save.seed).toBe(a.seed);
  });

  it('no save at all: a seed is made and kept; junk is cleaned up', async () => {
    storage.clear();
    vi.resetModules();
    const seed = (await reload()).getState().save.seed;
    vi.resetModules();
    expect((await reload()).getState().save.seed).toBe(seed);
    storage.set(SAVE_KEY, JSON.stringify({ unlocked: 99, seed: -3, cards: 'x' }));
    vi.resetModules();
    const junk = (await reload()).getState().save;
    expect(junk.unlocked).toBe(LAST_DAY);
    expect(junk.seed).toBeGreaterThan(0);
    expect(junk.cards).toEqual([]);
  });

  it('the run uses the save seed; newGame draws a new one and keeps progress', () => {
    gameStore.setState({ save: { unlocked: 3, seed: 1234, best: { 0: { stars: 3, points: 100 } }, cards: [] } });
    play(2);
    expect(S().run!.seed).toBe(1234);
    S().newGame();
    expect(S().save.seed).not.toBe(1234);
    expect(S().save).toMatchObject({ unlocked: 3, best: { 0: { stars: 3, points: 100 } } });
    expect(S().run!.stage).toBe(0);
    expect(S().run!.seed).toBe(S().save.seed);
    expect(JSON.parse(storage.get(SAVE_KEY)!).seed).toBe(S().save.seed);
  });

  it('finishing a day opens the next one for 이어하기 (never past D-Day, never backwards)', () => {
    const finish = (day: StageId) => {
      S().play(day);
      for (let i = 0; i < 50 && S().dialogue; i++) S().nextDialogue();
      const run = S().run!;
      const def = getStage(day);
      gameStore.setState({ run: { ...run, scenarios: [], objectivesDone: Object.fromEntries(def.objectives.map((o) => [o.id, 0])) } });
      S().event('t:done');
      expect(S().dialogue?.then).toBe('results');
    };
    gameStore.setState({ save: { unlocked: 0, seed: 7, best: {}, cards: [] } });
    finish(0);
    expect(S().save.unlocked).toBe(1);
    finish(LAST_DAY);
    expect(S().save.unlocked).toBe(LAST_DAY);
    finish(1);
    expect(S().save.unlocked).toBe(LAST_DAY);
    expect(JSON.parse(storage.get(SAVE_KEY)!).unlocked).toBe(LAST_DAY);
  });

  it('이어하기 plays the furthest day reached', () => {
    gameStore.setState({ save: { unlocked: 3, seed: 7, best: {}, cards: [] } });
    S().continueGame();
    expect(S().screen).toBe('playing');
    expect(S().run!.stage).toBe(3);
    gameStore.setState({ save: { unlocked: 0, seed: 7, best: {}, cards: [] } });
    S().continueGame();
    expect(S().run!.stage).toBe(0);
    gameStore.setState({ save: { unlocked: 42, seed: 7, best: {}, cards: [] } });
    S().continueGame();
    expect(S().run!.stage).toBe(LAST_DAY);
  });
});

describe('cue tracker on the real store', () => {
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

  beforeEach(() => {
    gameStore.setState({ save: { unlocked: 0, seed: 5, best: {}, cards: [] }, screen: 'select', run: null, dialogue: null, concepts: [] });
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

  it('a coin per mission, one for a mission and its new card together, the jingle on the clear popup', () => {
    expect(act(() => play(0))).toEqual([]);
    expect(act(() => S().event('t:a'))).toEqual([{ sfx: 'coin', at: now }]);
    // The last mission gives a new card and clears the day: still one coin.
    expect(S().save.cards).not.toContain('datacenter');
    expect(act(() => S().event('t:b'))).toEqual([{ sfx: 'coin', at: now }]);
    expect(S().save.cards).toContain('datacenter');
    expect(S().dialogue?.then).toBe('results');
    // Mission cards don't jingle; the clear popup does, after the outro.
    expect(act(() => S().dismissConcept())).toEqual([]);
    const outro: { sfx: string; at: number }[] = [];
    for (let i = 0; i < 50 && S().dialogue; i++) outro.push(...act(() => S().nextDialogue(), 1));
    expect(S().screen).toBe('results');
    expect(outro).toEqual([{ sfx: 'win', at: now }]);

    // A replay: missions still ring, the card is not new any more — one coin either way.
    act(() => (S().finishResults('retry'), play(0)));
    act(() => S().event('t:a'));
    expect(act(() => S().event('t:b'))).toEqual([{ sfx: 'coin', at: now }]);
  });

  it('fixing an incident with a new card: the coin, then the jingle 0.5 s later; on a replay only the jingle', () => {
    const fixOnce = () => {
      act(() => play(0, [{ id: 's-trap', trigger: { type: 'stageStart', delay: 2 } }]));
      for (let i = 0; i < 10 && scState('s-trap') !== 'active'; i++) act(() => S().tick(), 1);
      expect(scState('s-trap')).toBe('active');
      act(() => fixIt('s-trap'));
      const out: { sfx: string; at: number }[] = [];
      for (let i = 0; i < 5 && scState('s-trap') !== 'resolved'; i++) out.push(...act(() => S().tick(), 1));
      expect(S().concepts[0]?.scenarioId).toBe('s-trap');
      return out;
    };
    expect(fixOnce()).toEqual([
      { sfx: 'coin', at: now },
      { sfx: 'win', at: now + JINGLE_AFTER_COIN },
    ]);
    expect(S().save.cards).toContain('spof');
    expect(fixOnce()).toEqual([{ sfx: 'win', at: now }]);
  });

  it('the jingle once more on the ending certificate', () => {
    act(() => play(LAST_DAY));
    expect(act(() => gameStore.setState({ screen: 'results', dialogue: null, concepts: [] }))).toEqual([{ sfx: 'win', at: now }]);
    expect(act(() => S().finishResults('next'), 10)).toEqual([{ sfx: 'win', at: now }]);
    expect(S().screen).toBe('ending');
    expect(act(() => S().goTitle())).toEqual([]);
  });

  it('music along the way: lobby, long fade into the day, short into an incident, long back, long out', () => {
    const fades: string[] = [];
    let track = musicFor(S());
    const off = gameStore.subscribe((s) => {
      const next = musicFor(s);
      if (next === track) return;
      fades.push(`${track}→${next} ${crossfade(track, next).fadeIn}s`);
      track = next;
    });
    try {
      expect(track).toBe('lobby');
      play(0, [{ id: 's-trap', trigger: { type: 'stageStart', delay: 2 } }]);
      tickUntil(() => musicFor(S()) === 'incident');
      fixIt('s-trap');
      tickUntil(() => musicFor(S()) !== 'incident', 5);
      S().goSelect();
    } finally {
      off();
    }
    expect(fades).toEqual([`lobby→normal ${FADES.long}s`, `normal→incident ${FADES.short}s`, `incident→normal ${FADES.long}s`, `normal→lobby ${FADES.long}s`]);
  });
});
