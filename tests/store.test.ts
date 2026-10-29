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

import { createCueTracker, crossfade, FADES, JINGLE_AFTER_COIN, jingleCue, musicFor, type CuePlay } from '../src/audio/logic';
import { cardAccess, dayRecap, FIRST_STAGE, fixedIncidentCards, missionCards, stageCards } from '../src/content/cards';
import { CONCEPTS } from '../src/content/concepts';
import { getStage } from '../src/content/stages';
import type { Objective } from '../src/content/types';
import { initRuntime, type Scenario, type Trigger } from '../src/sim/scenario';
import { LAST_DAY, type StageId } from '../src/sim/types';
import {
  clearedDays,
  gameStore,
  hasSave,
  incidentSpoilers,
  missionPreview,
  pushWindow,
  SAVE_KEY,
  windowKey,
  type Modal,
  type SaveData,
} from '../src/store/game';

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

/** Starts a day with its briefing (and the first missions' 미션 브리핑) clicked through; on D-5 only `plan` happens. */
function play(stage: StageId, plan: { id: string; trigger: Trigger }[] = []) {
  S().play(stage);
  for (let i = 0; i < 50 && S().dialogue; i++) S().nextDialogue();
  gameStore.setState({ concepts: S().concepts.filter((c) => c.kind !== 'preview') });
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
    // D-3: the servers are built and in their VLANs (on D-4 they only get there once the player does it).
    play(2);
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

  it('restarting the day and leaving it close every window', () => {
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
  });

  it('the last mission done with windows open: they stay, the clock stops, the outro waits for the last one to close', () => {
    S().event('t:a');
    S().openModal({ type: 'noc' });
    S().openModal({ type: 'hint' });
    S().event('t:b');
    expect(S().dayDone).toBe(true);
    expect(S().dialogue).toBeNull();
    expect(windows()).toEqual(['hint', 'noc']);
    // The player is told how to go home (over the window).
    expect(S().toasts.some((t) => t.kind === 'info' && t.text.includes('퇴근'))).toBe(true);
    const t = S().run!.ctx.stageTime;
    for (let i = 0; i < 5; i++) {
      S().dismissConcept();
      S().tick();
    }
    expect(S().run!.ctx.stageTime).toBe(t);
    S().closeModal();
    expect(S().dialogue).toBeNull();
    S().closeModal();
    expect(S().dialogue?.then).toBe('results');
    expect(windows()).toEqual([]);
  });

  it('퇴근하기 ends a finished day at once, closing every window; before that it does nothing', () => {
    S().openModal({ type: 'terminal', host: 'ops' });
    S().leaveWork();
    expect(S().dialogue).toBeNull();
    expect(windows()).toEqual(['terminal:ops']);
    S().event('t:a', 't:b');
    expect(S().dayDone).toBe(true);
    S().leaveWork();
    expect(S().dialogue?.then).toBe('results');
    expect(windows()).toEqual([]);
    expect(S().fixing).toBe(false);
  });

  it('the last mission done with no window open ends the day right away', () => {
    S().event('t:a', 't:b');
    expect(S().dialogue?.then).toBe('results');
  });

  it("a card earned with a terminal open waits until it closes (it never takes the keyboard mid-command)", () => {
    gameStore.setState({ save: { ...S().save, cards: [] } });
    S().openModal({ type: 'terminal', host: 'ops' });
    S().event('t:b');
    expect(S().concepts).toEqual([]);
    expect(S().heldConcepts.map((c) => c.concept)).toEqual(['datacenter']);
    // The card is in the collection already; only its popup waits.
    expect(S().save.cards).toContain('datacenter');
    // The game keeps running meanwhile (a card on screen would pause it).
    expect(S().isPaused()).toBe(false);
    // The radio on top of the terminal is a working window too: the card still waits…
    S().openModal({ type: 'hint' });
    expect(S().concepts).toEqual([]);
    S().closeModal();
    expect(S().concepts).toEqual([]);
    // …until no working window is open.
    S().closeModal();
    expect(S().concepts.map((c) => c.concept)).toEqual(['datacenter']);
    expect(S().heldConcepts).toEqual([]);
  });

  it('cards earned while an incident is going on wait until it is fixed (they would burst over the investigation)', () => {
    play(0, [{ id: 's-trap', trigger: { type: 'stageStart', delay: 1 } }]);
    gameStore.setState({ save: { ...S().save, cards: [] } });
    for (let i = 0; i < 5 && scState('s-trap') !== 'active'; i++) S().tick();
    expect(scState('s-trap')).toBe('active');
    S().event('t:b');
    expect(S().concepts).toEqual([]);
    expect(S().heldConcepts.map((c) => c.concept)).toEqual(['datacenter']);
    // Opening the NOC to investigate doesn't let them out either.
    S().openModal({ type: 'noc' });
    S().closeModal();
    expect(S().concepts).toEqual([]);
    fixIt('s-trap');
    for (let i = 0; i < 5 && scState('s-trap') !== 'resolved'; i++) S().tick();
    expect(S().concepts.map((c) => c.concept)).toEqual(['datacenter', 'spof']);
    expect(S().heldConcepts).toEqual([]);
  });

  it('cards and briefings wait while the NOC or a mini-game is open (they would cover what the mission asked to look at)', () => {
    gameStore.setState({ save: { ...S().save, cards: [] } });
    for (const m of [{ type: 'noc' }, { type: 'rack' }, { type: 'cable', mode: 'build' }] as const) {
      play(0);
      while (S().concepts.length) S().dismissConcept();
      S().openModal(m);
      S().event('t:b');
      expect(S().concepts, m.type).toEqual([]);
      expect(S().heldConcepts.map((c) => c.concept), m.type).toEqual(['datacenter']);
      S().closeModal();
      expect(S().concepts.map((c) => c.concept), m.type).toEqual(['datacenter']);
    }
  });

  it('a card already in the collection comes back as a review', () => {
    gameStore.setState({ save: { ...S().save, cards: ['datacenter'] } });
    S().event('t:b');
    expect(S().concepts[0]).toMatchObject({ concept: 'datacenter', review: true });
    S().dismissConcept();
    gameStore.setState({ save: { ...S().save, cards: [] } });
    play(0);
    S().event('t:b');
    expect(S().concepts[0].review).toBeUndefined();
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

describe('explain before doing: 미션 브리핑, 배운 것 정리, 도감, 지금까지', () => {
  // A made-up D-5 whose missions explain themselves: p-1 (why + two cards) → p-2 (one card), and p-inc whose
  // only card is the made-up incident's ('spof').
  const EXPLAINED: Objective[] = [
    { id: 'p-1', text: '랙에 서버 달기', why: '서버는 랙에 층층이 끼워요.', done: (_w, c) => c.events.includes('p:1'), concept: 'rack', alsoConcepts: ['pdu', 'rack'], lesson: '서버 3대를 달았어요' },
    { id: 'p-2', text: '전기 확인', after: ['p-1'], done: (_w, c) => c.events.includes('p:2'), concept: 'ups' },
    { id: 'p-inc', text: '이중화 확인', after: ['p-2'], done: (_w, c) => c.events.includes('p:inc'), concept: 'spof' },
  ];
  const kinds = () => S().concepts.map((c) => `${c.kind ?? 'card'}:${c.kind === 'preview' ? c.scenarioId : c.concept}`);
  /** Starts D-5 with `plan` in place before its briefing ends (the briefing's end is when the first missions show). */
  const start = (plan: { id: string; trigger: Trigger }[] = []) => {
    S().play(0);
    gameStore.setState({ run: { ...S().run!, scenarios: initRuntime(plan) } });
    for (let i = 0; i < 50 && S().dialogue; i++) S().nextDialogue();
  };

  beforeEach(() => {
    Object.assign(DAY, { objectives: EXPLAINED });
    gameStore.setState({ save: { unlocked: 0, seed: 9, best: {}, cards: [] } });
  });
  afterEach(() => Object.assign(DAY, { objectives: MISSIONS }));

  it('a mission gets its 미션 브리핑 once per run, after the briefing: text, why, and its cards to read first', () => {
    start();
    expect(S().concepts).toEqual([
      { kind: 'preview', concept: 'rack', lesson: '', scenarioId: 'objective:p-1#preview', mission: '랙에 서버 달기', why: '서버는 랙에 층층이 끼워요.', cards: ['rack', 'pdu'] },
    ]);
    // It pauses the game like a card, gives nothing yet, and never rings the incident jingle.
    expect(S().isPaused()).toBe(true);
    expect(S().save.cards).toEqual([]);
    expect(jingleCue({ screen: 'playing', dialogue: null, concepts: [] }, S())).toBeNull();
    S().dismissConcept();
    for (let i = 0; i < 3; i++) S().tick();
    S().event('room:server');
    expect(S().concepts).toEqual([]);
    // Done: its cards (concept + alsoConcepts) as '배운 것 정리', then the next mission's briefing.
    S().event('p:1');
    expect(kinds()).toEqual(['recap:rack', 'recap:pdu', 'preview:objective:p-2#preview']);
    expect(S().concepts[0]).toMatchObject({ mission: '랙에 서버 달기', lesson: '서버 3대를 달았어요', scenarioId: 'objective:p-1' });
    expect(S().concepts[1]).toMatchObject({ lesson: '', scenarioId: 'objective:p-1:pdu' });
    expect(S().save.cards).toEqual(['rack', 'pdu']);
    expect(S().previewed).toEqual(['p-1', 'p-2']);
    // A new run of the day briefs again.
    start();
    expect(kinds()).toEqual(['preview:objective:p-1#preview']);
  });

  it('never over an open terminal: the mission that appears there is explained in its side box instead', () => {
    // p-2 explains itself (a why) and is the mission to do now: the terminal's side box shows it.
    Object.assign(DAY, { objectives: [EXPLAINED[0], { ...EXPLAINED[1], why: '전기는 두 줄로 들어와요.' }, EXPLAINED[2]] });
    start();
    S().dismissConcept();
    S().openModal({ type: 'terminal', host: 'ops' });
    S().event('p:1');
    expect(S().concepts).toEqual([]);
    // The recaps wait for the terminal to close; p-2's briefing is never popped (the side box had it).
    expect(S().heldConcepts.map((c) => c.concept)).toEqual(['rack', 'pdu']);
    expect(S().previewed).toContain('p-2');
    S().closeModal();
    expect(kinds()).toEqual(['recap:rack', 'recap:pdu']);
    // Over another working window (the radio) the recap and the next briefing wait too, until it closes.
    for (let i = 0; i < 5; i++) S().dismissConcept();
    S().openModal({ type: 'hint' });
    S().event('p:2');
    expect(kinds()).toEqual([]);
    S().closeModal();
    expect(kinds()).toEqual(['recap:ups', 'preview:objective:p-inc#preview']);
  });

  it('a mission the terminal side box does not explain is briefed once the terminal closes', () => {
    // p-2 has no why or steps: the side box only lists it, so its card waits for its briefing, after the recaps.
    start();
    S().dismissConcept();
    S().openModal({ type: 'terminal', host: 'ops' });
    S().event('p:1');
    expect(S().previewed).not.toContain('p-2');
    S().event('noop');
    expect(S().concepts).toEqual([]);
    S().closeModal();
    expect(kinds()).toEqual(['recap:rack', 'recap:pdu', 'preview:objective:p-2#preview']);
    expect(S().previewed).toContain('p-2');
  });

  it("never previews an incident's card while that incident may still happen", () => {
    // A mission with a why: its card that is the incident's ('spof') is left out until the incident is solved.
    Object.assign(DAY, { objectives: [{ ...EXPLAINED[0], alsoConcepts: ['spof'] }, ...EXPLAINED.slice(1)] });
    start([{ id: 's-trap', trigger: { type: 'stageStart', delay: 200 } }]);
    expect(S().concepts[0].cards).toEqual(['rack']);
    expect(incidentSpoilers(S().run!)).toEqual(new Set(['spof']));
    S().dismissConcept();
    // A mission whose only card is the incident's, and no why: no briefing at all.
    S().event('p:1');
    S().event('p:2');
    expect(kinds()).toEqual(['recap:rack', 'recap:spof', 'preview:objective:p-2#preview', 'recap:ups']);
    expect(S().previewed).toContain('p-inc');
    // Solved, the incident's card is no secret any more.
    const solved = { ...S().run!, scenarios: S().run!.scenarios.map((r) => ({ ...r, state: 'resolved' as const })) };
    expect(incidentSpoilers(solved).size).toBe(0);
    expect(missionPreview(solved, EXPLAINED[2])?.cards).toEqual(['spof']);
  });

  it("an incident's own card keeps the incident framing (no kind), a mission's is a recap", () => {
    start([{ id: 's-trap', trigger: { type: 'stageStart', delay: 1 } }]);
    S().dismissConcept();
    for (let i = 0; i < 5 && scState('s-trap') !== 'active'; i++) S().tick();
    fixIt('s-trap');
    for (let i = 0; i < 5 && scState('s-trap') !== 'resolved'; i++) S().tick();
    expect(S().concepts[0]).toEqual({ concept: 'spof', lesson: '테스트', scenarioId: 's-trap' });
  });

  it('"지금까지" opens a day started cold (the day before not cleared), before its briefing, and pauses the game', () => {
    S().goSelect();
    S().play(3);
    expect(S().recap).toBe(3);
    expect(S().dialogue).toMatchObject({ lines: [], then: 'play' });
    expect(S().isPaused()).toBe(true);
    const t = S().run!.ctx.stageTime;
    S().tick();
    expect(S().run!.ctx.stageTime).toBe(t);
    // Enter / 계속 (or skipping the briefing) closes it, and the day's briefing starts.
    S().dismissRecap();
    expect(S().recap).toBeNull();
    expect(S().dialogue).toMatchObject({ lines: getStage(3).intro, index: 0, then: 'play' });
    // A retry of the same day doesn't show it again.
    S().play(3);
    expect(S().recap).toBeNull();
    // From the calendar again it does; leaving closes it; nextDialogue goes through it.
    S().goSelect();
    S().play(LAST_DAY);
    expect(S().recap).toBe(LAST_DAY);
    S().nextDialogue();
    expect(S().recap).toBeNull();
    expect(S().dialogue?.lines).toBe(getStage(LAST_DAY).intro);
    S().goSelect();
    S().play(2);
    S().goTitle();
    expect(S().recap).toBeNull();
  });

  it('"지금까지" only on a cold start: never on D-5, not when every earlier day is cleared, and the calendar can skip it', () => {
    S().goSelect();
    S().play(0);
    expect(S().recap).toBeNull();
    // The day before cleared, but an earlier one skipped: still a recap.
    gameStore.setState({ save: { ...S().save, best: { 2: { stars: 2, points: 70 } } } });
    S().goSelect();
    S().play(3);
    expect(S().recap).toBe(3);
    const done = { stars: 2 as const, points: 70 };
    gameStore.setState({ save: { ...S().save, best: { 0: done, 1: done, 2: done } } });
    S().goSelect();
    S().play(3);
    expect(S().recap).toBeNull();
    expect(S().dialogue?.lines).toBe(getStage(3).intro);
    S().goSelect();
    S().play(4, { recap: false });
    expect(S().recap).toBeNull();
    // Finishing a day and going on to the next: never cold.
    S().goSelect();
    S().play(4);
    expect(S().recap).toBe(4);
  });

  it('every day after D-5 has something to recap (its own, or what the days before were about)', () => {
    for (let d = 1; d <= LAST_DAY; d++) {
      const r = dayRecap(d as StageId);
      expect(r.built.length, `D${d}`).toBeGreaterThan(0);
      expect(r.concepts.length, `D${d}`).toBeGreaterThan(0);
      expect(r.concepts.every((c) => c in CONCEPTS)).toBe(true);
    }
  });

  it('a mission awards its concept and alsoConcepts, without duplicates', () => {
    expect(missionCards(EXPLAINED[0])).toEqual(['rack', 'pdu']);
    expect(missionCards({ alsoConcepts: ['dns'] })).toEqual(['dns']);
    expect(missionCards({})).toEqual([]);
    // And they count for the day the card is first met.
    expect(stageCards(0)).toEqual(expect.arrayContaining(['rack', 'pdu', 'ups', 'spof']));
  });

  it('도감: earned cards, cards whose day has come (readable ahead), later days and pending incidents locked', () => {
    const none = new Set<string>();
    // Owned is owned, on any day.
    expect(cardAccess('triage', 0, new Set(['triage']))).toBe('owned');
    // A card is met on its first day or later; never before.
    for (const [id, first] of Object.entries(FIRST_STAGE)) {
      if (first > 0) expect(cardAccess(id, first - 1, none), id).toBe('locked');
      if (first < LAST_DAY) expect(cardAccess(id, first + 1, none), id).toBe('ahead');
    }
    // On its first day: a mission's card reads ahead, an incident's only card stays a secret.
    const missionCard = getStage(1).objectives.flatMap(missionCards).find((c) => FIRST_STAGE[c] === 1);
    expect(missionCard).toBeDefined();
    if (!missionCard) return;
    expect(cardAccess(missionCard, 1, none)).toBe('ahead');
    expect(cardAccess(missionCard, 1, none, new Set([missionCard]))).toBe('locked');
    const incidentOnly = Object.keys(FIRST_STAGE).find((id) => FIRST_STAGE[id] === LAST_DAY && !getStage(LAST_DAY).objectives.some((o) => missionCards(o).includes(id)));
    if (incidentOnly) expect(cardAccess(incidentOnly, LAST_DAY, none)).toBe('locked');
    // The calendar keeps a day's always-on incident cards secret too.
    for (const d of [0, 1, 2, 3, 4, 5] as StageId[]) for (const c of fixedIncidentCards(d)) expect(FIRST_STAGE[c]).toBeLessThanOrEqual(d);
  });

  it("an extra that can't be drawn that day (extras [0, 0]) doesn't count as meeting its card there", () => {
    for (const st of [0, 1, 2, 3, 4, 5] as StageId[]) {
      const def = getStage(st);
      if (def.extras[1] > 0) continue;
      const allowed = new Set([...def.objectives.flatMap(missionCards), ...fixedIncidentCards(st)]);
      expect(stageCards(st).filter((c) => !allowed.has(c)), def.label).toEqual([]);
    }
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

describe('toasts: the call from users, then the NMS alarm', () => {
  const texts = () => S().toasts.map((t) => `${t.source ?? '-'}|${t.text}`);

  it('a trap: the call and the NMS alarm together; both go when the incident is fixed', () => {
    play(0, [{ id: 's-trap', trigger: { type: 'stageStart', delay: 2 } }]);
    tickUntil(() => scState('s-trap') === 'active');
    expect(texts()).toEqual(['user|s-trap: 포털이 안 열려요', 'nms|Major(중요) · CAMPUS-ENG: s-trap 링크 다운']);
    expect(S().toasts.every((t) => t.kind === 'alert' && t.scenarioId === 's-trap')).toBe(true);
    fixIt('s-trap');
    S().tick();
    expect(scState('s-trap')).toBe('resolved');
    expect(texts()).toEqual(["-|'s-trap 장애' 장애를 해결했어요!"]);
  });

  it('a polled metric: users call first, the alarm only shows at the next poll', () => {
    play(0, [{ id: 's-poll', trigger: { type: 'stageStart', delay: 2 } }]);
    tickUntil(() => scState('s-poll') === 'active');
    expect(texts()).toEqual(['user|s-poll: 포털이 안 열려요']);
    tickUntil(() => S().run!.alarms.length > 0);
    expect(S().run!.ctx.stageTime % 15).toBe(0);
    expect(texts()).toEqual(['user|s-poll: 포털이 안 열려요', 'nms|Critical(긴급) · TOR-01: 업링크 사용률 100%']);
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

describe('the 퇴근 퀴즈 comes up', () => {
  const FINALE: Objective = { id: 'quiz', text: '퇴근 퀴즈', finale: true, done: (_w, c) => c.events.includes('quiz:correct') };
  const notes = () => S().toasts.filter((t) => t.kind === 'info').map((t) => t.text);

  it('with gear not saved: one reminder to write memory before the quiz, once a run', () => {
    Object.assign(DAY, { objectives: [...MISSIONS, FINALE] });
    try {
      play(0);
      S().act((w) => void (w.devices['TOR-01'].nd!.dirty = true));
      S().event('t:a');
      expect(notes()).toEqual([]);
      S().event('t:b');
      expect(S().run!.objectivesDone).not.toHaveProperty('quiz');
      expect(notes()).toEqual(['퇴근 퀴즈가 열렸어요! 저장 안 한 장비(TOR-01)는 퀴즈 전에 write memory로 저장해 둬요.']);
      S().event('t:c');
      expect(notes()).toHaveLength(1);
      // Nothing left unsaved: no reminder.
      play(0);
      S().event('t:a', 't:b');
      expect(notes()).toEqual([]);
    } finally {
      Object.assign(DAY, { objectives: MISSIONS });
    }
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

  it('완료한 날 다시 하기 plays only a day cleared on this save, and never with "지금까지" (even past a day not cleared)', () => {
    gameStore.setState({ save: { unlocked: 4, seed: 7, best: { 3: { stars: 2, points: 70 } }, cards: [] } });
    S().goSelect();
    S().replay(1);
    expect(S().screen).toBe('select');
    expect(S().run).toBeNull();
    S().replay(3);
    expect(S().screen).toBe('playing');
    expect(S().run!.stage).toBe(3);
    expect(S().recap).toBeNull();
    expect(S().dialogue?.lines).toBe(getStage(3).intro);
  });

  it("the report's 처음 화면 goes to the title, and so does a report with no run behind it", () => {
    gameStore.setState({ save: { unlocked: 1, seed: 7, best: {}, cards: [] } });
    S().play(0);
    gameStore.setState({ screen: 'results', dialogue: null });
    S().finishResults('title');
    expect(S().screen).toBe('title');
    expect(S().run).toBeNull();
    gameStore.setState({ screen: 'results', run: null });
    S().finishResults('next');
    expect(S().screen).toBe('title');
  });

  it('hasSave (이어서 하기) and clearedDays (완료한 날 다시 하기) read the save', () => {
    const done = { stars: 2, points: 70 };
    const save = (over: Partial<SaveData>): SaveData => ({ unlocked: 0, seed: 7, best: {}, cards: [], ...over });
    expect(hasSave(save({}))).toBe(false);
    expect(hasSave(save({ cards: ['dns'] }))).toBe(false);
    expect(hasSave(save({ unlocked: 2 }))).toBe(true);
    expect(hasSave(save({ best: { 0: done } }))).toBe(true);
    expect(clearedDays(save({ unlocked: 3 }))).toEqual([]);
    expect(clearedDays(save({ best: { 4: done, 0: done, 2: done } }))).toEqual([0, 2, 4]);
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
