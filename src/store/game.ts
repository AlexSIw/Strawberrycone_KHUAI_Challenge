import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { GUIDE_ASK, terminalLines } from '../ai/answer';
import { hintTarget, NO_MISSION, requestHintText, requestMissionText, type Want } from '../ai/client';
import { missionCards } from '../content/cards';
import { CONCEPTS } from '../content/concepts';
import { getStage } from '../content/stages';
import type { DialogueLine, InteractionKind, NocTab, Objective, SpotId, StageDef } from '../content/types';
import { alarmLine } from '../sim/alarms';
import { osOf } from '../sim/commands';
import { dim } from '../sim/commands/types';
import {
  ackAlarm,
  activeScenarios,
  applyAction,
  applyCommand,
  escalate,
  isCleared,
  recordEvents,
  revealSolution,
  scenarioOf,
  scoreRun,
  startStage,
  tickRun,
  visibleObjectives,
  type Score,
  type StageRun,
} from '../sim/engine';
import { USER_MODE } from '../sim/ios';
import { newSeed } from '../sim/scheduler';
import { LAST_DAY, type IosMode, type StageId, type World } from '../sim/types';
import { sourceName, unsavedGear } from '../ui/noc/facility';
import { objectiveStatus, termGuided } from '../ui/objectiveStatus';

// ---------- types ----------

export type Modal =
  /** `host` is the place the window was opened from (its session key): 'ops' for the 관리 PC desk, or a rack console's server */
  | { type: 'terminal'; host: string }
  | { type: 'consolePick'; hosts: string[] }
  | { type: 'dashboard' }
  | { type: 'hint'; scenarioId?: string }
  | { type: 'rack' }
  | { type: 'cable'; mode: 'build' | 'repair' }
  | { type: 'power' }
  | { type: 'repair'; target: 'crac' }
  | { type: 'board'; board: 'decompose' | 'dockerfile' | 'desired' | 'postmortem' }
  | { type: 'quiz' }
  | { type: 'inspect'; text: string }
  | { type: 'concepts' }
  /** The NOC console (NMS / SMS / FMS / NAC) */
  | { type: 'noc'; tab?: NocTab }
  /** A facility unit's read-only gauges */
  | { type: 'gauge'; target: 'ups' | 'pdu' | 'crac' };

export interface Toast {
  id: number;
  kind: 'alert' | 'resolved' | 'objective' | 'info';
  text: string;
  /** Incident an alert toast belongs to (dropped once that incident is solved) */
  scenarioId?: string;
  /** Who raised an alert: a user / the 팀장 calling in, or the NMS */
  source?: 'user' | 'nms';
}

/** At most this many toasts at once, so the stack stays clear of the map's upper rooms. */
const MAX_TOASTS = 3;

export interface HintMessage {
  from: 'mentor' | 'player' | 'system';
  text: string;
  source?: 'ai' | 'canned' | 'solution';
}

/** Key of the radio's mission thread in `hints` (the others are incident ids). */
export const MISSION_THREAD = 'mission';

export interface ConceptPopup {
  /** The card (a preview: the first card it previews, '' when it previews none) */
  concept: string;
  lesson: string;
  /**
   * Scenario id, or "objective:<id>" for cards from objectives ("objective:<id>:<card>" for its alsoConcepts,
   * "objective:<id>#preview" for its 미션 브리핑). Only incident cards (no "objective:" prefix) ring the jingle.
   */
  scenarioId: string;
  /** The card was already in the collection (an earlier run, or earlier today): shown as a review, not as new */
  review?: boolean;
  /**
   * Unset: an incident's card. 'recap': a mission's card on completion ('배운 것 정리', awarded).
   * 'preview': the 미션 브리핑 when a mission first appears (its why and the cards to read first; nothing awarded).
   */
  kind?: 'recap' | 'preview';
  /** recap / preview: the mission's text */
  mission?: string;
  /** preview: the mission's `why` */
  why?: string;
  /** preview: the cards shown under '먼저 알고 가기' (the mission's cards, minus any incident's) */
  cards?: string[];
}

export interface SaveData {
  /** Highest day reached: the day 이어서 하기 plays (완료한 날 다시 하기 goes by `best` instead) */
  unlocked: number;
  /** Seed of this save's incident plans: the same save replays the same surprises */
  seed: number;
  best: Record<number, { stars: number; points: number }>;
  cards: string[];
}

/** 'select' is 완료한 날 다시 하기 (Calendar.tsx): the days cleared on this save, to play again. */
export type Screen = 'title' | 'select' | 'playing' | 'results' | 'ending';

/** One terminal place's session (the 관리 PC desk, or one rack console), kept while the window is closed. */
export interface TerminalSession {
  /** Host the session is on now: starts at the place's own host, then follows ssh / exit */
  host: string;
  /** Scrollback */
  log: string[];
  /** Commands entered here, oldest first (↑/↓). Optional so a bare { host, log } is a fresh session. */
  history?: string[];
  /** The half-typed input line */
  draft?: string;
  /** IOS mode while the session is on network gear (CORE-01#), null on a shell */
  mode?: IosMode | null;
}

/** Terminal sessions and window progress are kept until the stage starts again; these are their bounds. */
const MAX_LOG = 400;
const MAX_HISTORY = 200;

/** Is this host network gear that speaks IOS (CORE-01, TOR-01 …)? */
const isGear = (w: World | undefined, host: string) => !!w && osOf(w, host) === 'ios';

/** A new session at a place: on network gear it starts at the console's `>` prompt. */
const freshSession = (host: string, w?: World): TerminalSession => ({
  host,
  log: [],
  history: [],
  draft: '',
  ...(isGear(w, host) ? { mode: USER_MODE } : {}),
});

export interface GameState {
  screen: Screen;
  run: StageRun | null;
  save: SaveData;
  /** The window that is open (on top) */
  modal: Modal | null;
  /**
   * Windows waiting under `modal`, oldest first. A window opened while another is open goes on top of it;
   * closing it brings back the one underneath, as it was (see openModal / closeModal).
   */
  modalStack: Modal[];
  dialogue: { lines: DialogueLine[]; index: number; then: 'play' | 'results' } | null;
  /**
   * The "지금까지" screen of a day started cold (some earlier day not cleared on this save: 이어서 하기 on an
   * old save with gaps): the day it is for, or null. It is part of the briefing: while it is open, `dialogue` is an
   * empty briefing (so the game is paused and the map, hotkeys and windows wait), and dismissRecap (Enter,
   * Space, 계속, or nextDialogue) closes it and starts the day's briefing.
   */
  recap: StageId | null;
  dismissRecap(): void;
  /** Objectives of this run already met: previewed (미션 브리핑), or first seen in the terminal, whose side box explains them */
  previewed: string[];
  /** Cards on screen, first one shown: incident cards, missions' recaps and 미션 브리핑 previews */
  concepts: ConceptPopup[];
  /**
   * Cards earned while the player is busy: in a working window (a terminal, the NOC, a mini-game, a board, the
   * radio: see holdsCards), or while an incident is going on. A card would cover what the player is looking at
   * or typing, so they wait here and pop up once no such window is open and no incident is going on.
   */
  heldConcepts: ConceptPopup[];
  /**
   * Today's work is all done. The day clock stops, and the outro starts once no window is open (or on
   * 퇴근하기), so the player can finish what they were doing (e.g. `write memory`) and read the screen.
   */
  dayDone: boolean;
  /** 퇴근하기: close every window and start the outro (only once today's work is done). */
  leaveWork(): void;
  toasts: Toast[];
  /** Session of the terminal window that is open (or was opened last); commands run on its host */
  terminal: TerminalSession;
  /** Place `terminal` belongs to ('ops' = 관리 PC desk, or a rack console's server) */
  terminalOrigin: string;
  /** Sessions of the other places, parked until their window opens again */
  terminals: Record<string, TerminalSession>;
  /** Half-done work in the other windows (see useStageState), by key; boxed so `undefined` can be stored */
  windowState: Record<string, { v: unknown }>;
  /** Goes up on every play(): late writes from the run before (a window's timer, a hint answer) are dropped */
  stageEpoch: number;
  hints: Record<string, HintMessage[]>;
  hintPending: boolean;
  /** The thread (incident id or MISSION_THREAD) the pending answer is for, so the "typing…" bubble shows there */
  hintThread: string | null;
  /**
   * Lines that arrived for a terminal place after its command returned (쿠사수's answer to `hint`). They are in
   * that session's log already; an open Terminal prints them above its prompt. `seq` tells repeats apart.
   */
  terminalFeed: { seq: number; origin: string; lines: string[] } | null;
  lastScore: Score | null;
  /** Best points for this stage before the run that just ended (null: first clear) */
  lastPrevBest: number | null;
  /** Is the lion working on a device (plays the fix animation)? */
  fixing: boolean;
  /** Extra pause requested by UI (e.g. the HUD's exit confirm) */
  paused: boolean;
  setPaused(p: boolean): void;

  // navigation
  goTitle(): void;
  /** 완료한 날 다시 하기 */
  goSelect(): void;
  /** Starts a day. `recap` forces the "지금까지" screen on or off (default: on for a cold start, see GameState.recap). */
  play(stage: StageId, opts?: { recap?: boolean }): void;
  /** Start over: a fresh save seed (new surprises), progress kept */
  newGame(): void;
  /** 이어서 하기: the furthest day reached (save.unlocked, at most D-Day) */
  continueGame(): void;
  /** 완료한 날 다시 하기: plays a day cleared on this save, never with "지금까지"; any other day does nothing. */
  replay(stage: StageId): void;
  finishResults(next: 'next' | 'retry' | 'title'): void;

  // loop
  tick(): void;
  isPaused(): boolean;

  // input
  interact(spot: SpotId): void;
  enterRoom(room: string): void;
  event(...events: string[]): void;
  act(action: (w: World) => void, ...events: string[]): void;
  /**
   * Runs a line on the active terminal session's host (and keeps it in that session's history unless
   * `record` is false, e.g. the `end` Ctrl+Z sends).
   */
  command(line: string, record?: boolean): { lines: string[]; clear: boolean };
  /** Scrollback of the active terminal session (the Terminal component writes here) */
  appendTerminal(lines: string[]): void;
  clearTerminal(): void;
  /** The active terminal session's half-typed line */
  setTerminalDraft(text: string): void;
  setWindowState(key: string, value: unknown): void;
  /**
   * Opens a window. With none open it just opens. With one open, the new one goes on top and the open one
   * waits underneath (closeModal brings it back), except:
   *  - the same window again (e.g. the radio for another incident) is updated in place;
   *  - a window already waiting underneath is brought back (the ones above it close), never duplicated;
   *  - a chooser (consolePick) is replaced by the window it leads to (a terminal).
   */
  openModal(m: Modal): void;
  /** Closes the open window and brings back the one underneath, if any. */
  closeModal(): void;
  nextDialogue(): void;
  dismissConcept(): void;
  dismissToast(id: number): void;
  askHint(scenarioId: string, question?: string): Promise<void>;
  /**
   * The radio's mission mode: a question about the mission being built or a term on screen (no question:
   * "what's next?"). Free, no hint ladder. The thread is hints[MISSION_THREAD].
   */
  askMission(question?: string): Promise<void>;
  reveal(scenarioId: string): void;
  /** NOC: acknowledge an alarm (MTTD stops here) */
  ackAlarm(alarmId: string): void;
  /** NOC: hand a shallow-area incident to its owning team */
  escalate(scenarioId: string): void;
}

// ---------- persistence ----------

export const SAVE_KEY = 'khu-dc-save-v2';
const emptySave = (): SaveData => ({ unlocked: 0, seed: newSeed(), best: {}, cards: [] });

const validSeed = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 0xffffffff;

/** The save, cleaned up. A save without a seed gets one, written back at once so it stays the same. */
export function loadSave(): SaveData {
  let raw: Partial<SaveData> | null = null;
  try {
    const text = localStorage.getItem(SAVE_KEY);
    raw = text ? (JSON.parse(text) as Partial<SaveData>) : null;
  } catch {
    raw = null;
  }
  const base = emptySave();
  const r = raw && typeof raw === 'object' ? raw : {};
  const unlocked = Number.isInteger(r.unlocked) ? Math.max(0, Math.min(LAST_DAY, r.unlocked as number)) : 0;
  const save: SaveData = {
    unlocked,
    seed: validSeed(r.seed) ? r.seed : base.seed,
    best: r.best && typeof r.best === 'object' ? r.best : {},
    cards: Array.isArray(r.cards) ? r.cards.filter((c): c is string => typeof c === 'string') : [],
  };
  if (!raw || !validSeed(raw.seed)) writeSave(save);
  return save;
}

/** There is something to go on with (이어서 하기): a day reached or cleared. */
export const hasSave = (s: SaveData): boolean => s.unlocked > 0 || Object.keys(s.best).length > 0;

/** The days cleared on this save, in order: the ones 완료한 날 다시 하기 can play. */
export const clearedDays = (s: SaveData): StageId[] =>
  Array.from({ length: LAST_DAY + 1 }, (_, d) => d as StageId).filter((d) => !!s.best[d]);

function writeSave(s: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* private mode etc. — progress just won't persist */
  }
}

// ---------- helpers ----------

let toastSeq = 0;

function interactionToModal(k: InteractionKind): Modal {
  switch (k.kind) {
    case 'console':
      return { type: 'terminal', host: k.host };
    case 'terminal':
      return { type: 'terminal', host: 'ops' };
    case 'consolePick':
      return { type: 'consolePick', hosts: k.hosts };
    case 'mentor':
      return { type: 'hint' };
    case 'board':
      return { type: 'board', board: k.board };
    case 'cable':
      return { type: 'cable', mode: k.mode };
    case 'repair':
      return { type: 'repair', target: k.target };
    case 'inspect':
      return { type: 'inspect', text: k.text };
    case 'noc':
      return { type: 'noc', tab: k.tab };
    case 'gauge':
      return { type: 'gauge', target: k.target };
    case 'dashboard':
    case 'rack':
    case 'power':
    case 'quiz':
      return { type: k.kind };
  }
}

/**
 * What pressing E at `spot` opens right now: the day's own interaction, except that the 설계 보드 opens the
 * 퇴근 퀴즈 while the day's finale objective is on the list and not done yet.
 */
export function interactionAt(run: StageRun, spot: SpotId): InteractionKind | undefined {
  const def = getStage(run.stage);
  if (spot === 'board' && def.quiz && visibleObjectives(def, run).some((o) => o.finale && !(o.id in run.objectivesDone))) return { kind: 'quiz' };
  return def.interactions[spot];
}

/** Event name recorded when a modal opens (objectives listen for these). */
function openEvent(m: Modal): string {
  if (m.type === 'hint') return 'open:mentor';
  return `open:${m.type}`;
}

const FIXING_MODALS: Modal['type'][] = ['terminal', 'rack', 'cable', 'power', 'repair', 'board'];

/**
 * Windows the player works in. Cards earned there (and new missions' 미션 브리핑) wait until the window is
 * closed, so they never cover what a mission just asked to look at (the NOC's port table, the FMS), a
 * mini-game's 완료 line, or the line being typed.
 */
const HOLDING_MODALS: Modal['type'][] = ['terminal', 'noc', 'dashboard', 'rack', 'cable', 'power', 'board', 'hint'];

/** Does this open window hold cards and briefings back? */
export const holdsCards = (m: Modal | null) => !!m && HOLDING_MODALS.includes(m.type);

/**
 * Is a serious incident (Critical / Major) going on? Cards earned meanwhile wait until it is fixed: five cards
 * bursting over the NOC would come between the player and the outage. A Minor / Warning one doesn't hold them.
 */
export const cardsWaitForIncident = (run: StageRun) => activeScenarios(run).some((a) => a.def.severity === 'critical' || a.def.severity === 'major');

const isFixing = (m: Modal | null) => !!m && FIXING_MODALS.includes(m.type);

/**
 * Which window a Modal is. Two Modals with the same key are the same window: the radio stays one window
 * whichever incident it was opened for, while each place's terminal is a window of its own.
 */
export function windowKey(m: Modal): string {
  switch (m.type) {
    case 'terminal':
      return `terminal:${m.host}`;
    case 'board':
      return `board:${m.board}`;
    case 'cable':
      return `cable:${m.mode}`;
    case 'repair':
      return `repair:${m.target}`;
    default:
      return m.type;
  }
}

/** Choosers that only lead to another window: the window they lead to takes their place instead of stacking. */
const CHOOSER_LEADS_TO: Partial<Record<Modal['type'], Modal['type']>> = { consolePick: 'terminal' };

/** The window stack after opening `m` (pure; see GameState.openModal). */
export function pushWindow(open: Modal | null, stack: Modal[], m: Modal): Modal[] {
  if (!open) return [];
  const key = windowKey(m);
  if (windowKey(open) === key) return stack;
  const i = stack.findIndex((w) => windowKey(w) === key);
  if (i >= 0) return stack.slice(0, i);
  return CHOOSER_LEADS_TO[open.type] === m.type ? stack : [...stack, open];
}

/** No window open, none waiting. */
const NO_WINDOWS = { modal: null, modalStack: [] as Modal[], fixing: false };

/** Opening `m`: a terminal of another place parks the active session and brings back (or starts) its own. */
function sessionFor(s: GameState, m: Modal): Partial<GameState> {
  if (m.type !== 'terminal' || m.host === s.terminalOrigin) return {};
  const { [m.host]: session, ...others } = s.terminals;
  return { terminals: { ...others, [s.terminalOrigin]: s.terminal }, terminal: session ?? freshSession(m.host, s.run?.world), terminalOrigin: m.host };
}

/**
 * Cards of this run's incidents that aren't solved yet (planned, going on, or a mistake that may still happen).
 * Nothing shows them ahead (미션 브리핑, the 도감): an incident stays a puzzle until it is solved.
 */
export function incidentSpoilers(run: StageRun): Set<string> {
  const def = getStage(run.stage);
  return new Set(run.scenarios.filter((r) => r.state !== 'resolved').map((r) => scenarioOf(def, r.id).concept));
}

/**
 * The 미션 브리핑 for a mission that just appeared: its text, its `why`, and its cards to read first (concept +
 * alsoConcepts, without any card of an incident not solved yet). Null when there is nothing to explain.
 */
export function missionPreview(run: StageRun, o: Objective): ConceptPopup | null {
  const spoilers = incidentSpoilers(run);
  const cards = missionCards(o).filter((c) => c in CONCEPTS && !spoilers.has(c));
  if (!o.why && !cards.length) return null;
  return { kind: 'preview', concept: cards[0] ?? '', lesson: '', scenarioId: `objective:${o.id}#preview`, mission: o.text, why: o.why, cards };
}

/** A mission's cards on completion, framed as its '배운 것 정리': the first one carries the lesson. */
function missionRecaps(o: Objective): ConceptPopup[] {
  return missionCards(o).map((concept, i) => ({
    kind: 'recap' as const,
    concept,
    mission: o.text,
    lesson: i === 0 ? (o.lesson ?? CONCEPTS[concept]?.definition ?? '') : '',
    scenarioId: i === 0 ? `objective:${o.id}` : `objective:${o.id}:${concept}`,
  }));
}

/** The briefing of a day whose "지금까지" screen is open: empty, so nothing shows, but the game waits as in a briefing. */
const RECAP_BRIEFING = { lines: [] as DialogueLine[], index: 0, then: 'play' as const };

const intro = (def: StageDef) => ({ lines: def.intro, index: 0, then: 'play' as const });

// ---------- store ----------

export const gameStore = createStore<GameState>()((set, get) => {
  const toast = (kind: Toast['kind'], text: string, scenarioId?: string, source?: Toast['source']) => {
    const t: Toast = { id: ++toastSeq, kind, text, scenarioId, ...(source ? { source } : {}) };
    set((s) => ({ toasts: [...s.toasts.slice(-(MAX_TOASTS - 1)), t] }));
  };

  /** Cards wait: a working window is open, or a serious incident is going on (they'd burst over the investigation). */
  const holdingCards = () => {
    const s = get();
    return holdsCards(s.modal) || (!!s.run && cardsWaitForIncident(s.run));
  };

  const awardCards = (popups: ConceptPopup[]) => {
    if (!popups.length) return;
    // A card already in the collection (from an earlier run, or earlier today) is a review, not a new card.
    const owned = new Set(get().save.cards);
    const cards = popups.map((p) => {
      if (owned.has(p.concept)) return { ...p, review: true };
      owned.add(p.concept);
      return p;
    });
    const save = { ...get().save, cards: [...owned] };
    writeSave(save);
    if (holdingCards()) set((st) => ({ heldConcepts: [...st.heldConcepts, ...cards], save }));
    else set((st) => ({ concepts: [...st.concepts, ...st.heldConcepts, ...cards], heldConcepts: [], save }));
  };

  /** Cards held back come up once no working window is open and no incident is going on. */
  const releaseCards = () => {
    const s = get();
    if (!s.heldConcepts.length || holdingCards()) return;
    set({ concepts: [...s.concepts, ...s.heldConcepts], heldConcepts: [] });
  };

  /**
   * Missions that just appeared get their 미션 브리핑 (explain before doing), once per run. Not over a working
   * window (holdsCards): the briefing waits until it is closed. Over a terminal the side box explains the
   * mission to do now inline (termGuided), so that one counts as met; any other waits for the terminal to close.
   */
  const previewMissions = (run: StageRun) => {
    const s = get();
    if (s.screen !== 'playing' || s.dayDone) return;
    const seen = new Set(s.previewed);
    let fresh = visibleObjectives(getStage(run.stage), run).filter((o) => !seen.has(o.id));
    if (s.modal?.type === 'terminal') {
      const inBox = termGuided(objectiveStatus(getStage(run.stage), run));
      fresh = fresh.filter((o) => o === inBox || o.id in run.objectivesDone);
      if (fresh.length) set((st) => ({ previewed: [...st.previewed, ...fresh.map((o) => o.id)] }));
      return;
    }
    if (holdsCards(s.modal)) {
      // Done before its briefing could show: nothing left to brief.
      const done = fresh.filter((o) => o.id in run.objectivesDone);
      if (done.length) set((st) => ({ previewed: [...st.previewed, ...done.map((o) => o.id)] }));
      return;
    }
    if (!fresh.length) return;
    const popups = fresh.flatMap((o) => {
      const p = o.id in run.objectivesDone ? null : missionPreview(run, o);
      return p ? [p] : [];
    });
    set((st) => ({ previewed: [...st.previewed, ...fresh.map((o) => o.id)], concepts: [...st.concepts, ...popups] }));
  };

  /** After every change: missions done get their toast and card(s) (배운 것 정리), missions now shown their 브리핑. */
  const objectiveToasts = (run: StageRun, ids: string[]) => {
    const def = getStage(run.stage);
    const popups: ConceptPopup[] = [];
    for (const id of ids) {
      const o = def.objectives.find((x) => x.id === id);
      if (!o) continue;
      toast('objective', o.text);
      popups.push(...missionRecaps(o));
    }
    awardCards(popups);
    previewMissions(run);
  };

  /** The run (its stageEpoch) whose 퇴근 퀴즈 has come up and had its reminder. */
  let finaleSeen = -1;
  /**
   * The 퇴근 퀴즈 just came up. The day now ends from its window, so the reminder to save changed gear comes
   * here, while there is still time for `write memory` (the one at the clear below can't show any more).
   */
  const finaleReminder = (run: StageRun) => {
    const epoch = get().stageEpoch;
    if (finaleSeen === epoch || !visibleObjectives(getStage(run.stage), run).some((o) => o.finale && !(o.id in run.objectivesDone))) return;
    finaleSeen = epoch;
    const unsaved = unsavedGear(run.world);
    if (unsaved.length) toast('info', `퇴근 퀴즈가 열렸어요! 저장 안 한 장비(${unsaved.join(', ')})는 퀴즈 전에 write memory로 저장해 둬요.`);
  };

  /**
   * Today's work is done once every mission and incident is: the clock stops there. The outro waits
   * until no window is open, so whatever the player was doing (a terminal mid-`write memory`, the FMS
   * tab the last mission asked to look at) stays on screen; 퇴근하기 in the HUD ends the day at once.
   */
  /**
   * Ask 쿠사수 in a radio thread (an incident id or MISSION_THREAD) and put the answer there. Free. No question:
   * "what now?" in the player's name. Resolves to the answer, or null when nothing was asked or the stage
   * started again meanwhile (the answer belongs to the old run).
   */
  const askInThread = async (thread: string, question?: string, want?: Want): Promise<HintMessage | null> => {
    const s = get();
    if (!s.run || s.hintPending) return null;
    const run = s.run;
    const sc = thread === MISSION_THREAD ? undefined : getStage(run.stage).scenarios.find((x) => x.id === thread);
    if (thread !== MISSION_THREAD && !sc) return null;
    const history = [...(s.hints[thread] ?? []), { from: 'player' as const, text: question || GUIDE_ASK }];
    set({ hintPending: true, hintThread: thread, hints: { ...s.hints, [thread]: history } });
    const term = get().terminal;
    const where = { question, want, history, host: term.host, iosMode: term.mode?.level ?? null };
    const reply = sc ? await requestHintText({ run, scenario: sc, ...where }) : await requestMissionText({ run, ...where });
    const cur = get();
    if (cur.stageEpoch !== s.stageEpoch) return null;
    const msg: HintMessage = { from: 'mentor', text: reply.text, source: reply.source };
    set({ hintPending: false, hintThread: null, hints: { ...cur.hints, [thread]: [...(cur.hints[thread] ?? history), msg] } });
    return msg;
  };

  /**
   * Late lines for a terminal place: into its session's log, and to its open Terminal. Dropped when the stage
   * started again, or when that session has moved to another host since (the radio thread still has them).
   */
  const pushTerminal = (origin: string, host: string, epoch: number, lines: string[]) => {
    const cur = get();
    if (cur.stageEpoch !== epoch) return;
    const active = cur.terminalOrigin === origin;
    const session = active ? cur.terminal : cur.terminals[origin];
    if (!session || session.host !== host) return;
    const next = { ...session, log: [...session.log, ...lines].slice(-MAX_LOG) };
    if (active) set({ terminal: next, terminalFeed: { seq: (cur.terminalFeed?.seq ?? 0) + 1, origin, lines } });
    else set({ terminals: { ...cur.terminals, [origin]: next } });
  };

  /**
   * The terminal's `hint`: what the player is stuck on (an incident, else the mission), asked as a guide. Returns
   * the lines to print now; 쿠사수's three lines follow when the answer comes (pushTerminal), and land in the
   * radio thread too, which H then opens on.
   */
  const terminalHint = (): string[] => {
    const s = get();
    if (!s.run) return [];
    if (s.hintPending) return terminalLines('다른 질문에 답하는 중이야. 조금 뒤에 다시 hint 해 줘.');
    const target = hintTarget(s.run, s.terminal.host);
    if (!target) return terminalLines(NO_MISSION);
    const thread = target.kind === 'incident' ? target.id : MISSION_THREAD;
    if (target.kind === 'incident') get().setWindowState('hint:tab', target.id);
    const { terminalOrigin: origin, stageEpoch: epoch } = s;
    const host = s.terminal.host;
    void askInThread(thread, undefined, 'guide').then((msg) => {
      if (msg) pushTerminal(origin, host, epoch, terminalLines(msg.text));
    });
    return [dim('쿠사수> 생각 중…')];
  };

  const afterChange = (run: StageRun) => {
    const s = get();
    if (s.screen !== 'playing' || s.dialogue) return;
    if (!s.dayDone) {
      finaleReminder(run);
      if (!isCleared(run)) return;
      // The clock stops here, so the polls that would clear the alarms of fixed incidents never come: clear them now.
      const fixed = new Set(run.scenarios.filter((r) => r.state === 'resolved').map((r) => r.id));
      const alarms = run.alarms.map((a) => (a.clearedAt === null && a.scenarioId && fixed.has(a.scenarioId) ? { ...a, clearedAt: run.ctx.stageTime } : a));
      run = { ...run, alarms };
      set({ dayDone: true, run });
      if (s.modal) {
        const unsaved = unsavedGear(run.world);
        toast(
          'info',
          unsaved.length
            ? `오늘 일 끝! 저장 안 한 장비(${unsaved.join(', ')})는 write memory로 저장하고, 창을 닫거나 위의 '퇴근하기'를 누르면 퇴근해요.`
            : `오늘 일 끝! 창을 닫거나 위의 '퇴근하기'를 누르면 퇴근해요.`,
        );
      }
    }
    if (!get().modal) finishStage(get().run ?? run);
  };

  const finishStage = (run: StageRun) => {
    const def = getStage(run.stage);
    const score = scoreRun(run);
    const save = { ...get().save, best: { ...get().save.best }, cards: [...get().save.cards] };
    const prev = save.best[run.stage];
    if (!prev || score.points > prev.points) save.best[run.stage] = { stars: score.stars, points: score.points };
    // Tomorrow opens for 이어서 하기.
    save.unlocked = Math.max(save.unlocked, Math.min(LAST_DAY, run.stage + 1));
    writeSave(save);
    set({
      save,
      lastScore: score,
      lastPrevBest: prev?.points ?? null,
      ...NO_WINDOWS,
      // Cards held back for a terminal come up before the outro (DialogueBox waits for them).
      concepts: [...get().concepts, ...get().heldConcepts],
      heldConcepts: [],
      dayDone: true,
      toasts: [],
      dialogue: { lines: def.outro, index: 0, then: 'results' },
    });
  };

  return {
    screen: 'title',
    run: null,
    save: loadSave(),
    modal: null,
    modalStack: [],
    dialogue: null,
    recap: null,
    previewed: [],
    concepts: [],
    heldConcepts: [],
    dayDone: false,
    toasts: [],
    terminal: freshSession('ops'),
    terminalOrigin: 'ops',
    terminals: {},
    windowState: {},
    stageEpoch: 0,
    hints: {},
    hintPending: false,
    hintThread: null,
    terminalFeed: null,
    lastScore: null,
    lastPrevBest: null,
    fixing: false,
    paused: false,
    setPaused: (paused) => set({ paused }),

    goTitle: () => set({ screen: 'title', run: null, ...NO_WINDOWS, dialogue: null, recap: null, toasts: [], heldConcepts: [], dayDone: false }),
    goSelect: () => set({ screen: 'select', run: null, ...NO_WINDOWS, dialogue: null, recap: null, toasts: [], heldConcepts: [], dayDone: false }),
    newGame: () => {
      const save = { ...get().save, seed: newSeed() };
      writeSave(save);
      set({ save });
      get().play(0);
    },
    continueGame: () => get().play(Math.max(0, Math.min(LAST_DAY, get().save.unlocked)) as StageId),
    replay: (stage) => {
      if (get().save.best[stage]) get().play(stage, { recap: false });
    },

    play: (stage, opts = {}) => {
      const def = getStage(stage);
      const s = get();
      // Started with some earlier day not cleared on this save (an old save with gaps): "지금까지" first.
      // A retry of the same day doesn't show it again.
      const skipped = Array.from({ length: stage }, (_, d) => d).some((d) => !s.save.best[d]);
      const cold = opts.recap ?? (stage > 0 && skipped && s.run?.stage !== stage);
      set({
        screen: 'playing',
        run: startStage(stage, get().save.seed),
        ...NO_WINDOWS,
        concepts: [],
        heldConcepts: [],
        dayDone: false,
        toasts: [],
        hints: {},
        hintPending: false,
        hintThread: null,
        terminalFeed: null,
        // Every place's terminal and every window's half-done work start over with the stage.
        terminal: freshSession('ops'),
        terminalOrigin: 'ops',
        terminals: {},
        windowState: {},
        stageEpoch: get().stageEpoch + 1,
        lastScore: null,
        lastPrevBest: null,
        paused: false,
        previewed: [],
        recap: cold ? stage : null,
        dialogue: cold ? RECAP_BRIEFING : intro(def),
      });
    },

    dismissRecap: () => {
      const s = get();
      if (s.recap === null) return;
      // The briefing starts now (the empty one held the game while "지금까지" was open).
      set({ recap: null, dialogue: s.run ? intro(getStage(s.run.stage)) : null });
    },

    finishResults: (next) => {
      const run = get().run;
      if (!run) return get().goTitle();
      if (next === 'retry') return get().play(run.stage);
      if (next === 'next') {
        if (run.stage === LAST_DAY) return set({ screen: 'ending', ...NO_WINDOWS });
        return get().play((run.stage + 1) as StageId);
      }
      get().goTitle();
    },

    isPaused: () => {
      const s = get();
      return s.screen !== 'playing' || s.paused || !!s.dialogue || s.recap !== null || s.concepts.length > 0;
    },

    tick: () => {
      const s = get();
      // Today's work is done: the clock stops while the player wraps up (no new incident, no score drift).
      if (!s.run || s.isPaused() || s.dayDone) return;
      const { run, activated, resolved, completed, raised } = tickRun(s.run);
      const def = getStage(run.stage);
      set({ run });
      // Users and the 팀장 call in about the symptom as soon as it starts…
      for (const id of activated) {
        const sc = scenarioOf(def, id);
        if (sc.alert) toast('alert', sc.alert, id, 'user');
      }
      // …the NMS only once its trap / syslog / poll sees it.
      for (const id of raised) {
        const a = run.alarms.find((x) => x.id === id);
        if (!a || (a.scenarioId && run.scenarios.find((r) => r.id === a.scenarioId)?.state === 'resolved')) continue;
        // The same name the alarm list shows: a device's label, a campus service's name, or a place ('rack2' → '랙 2').
        toast('alert', alarmLine(a, sourceName(run.world, a.device)), a.scenarioId ?? undefined, 'nms');
      }
      awardCards(
        resolved.map((id) => {
          const sc = scenarioOf(def, id);
          // The alerts for a solved incident (the call and the alarm) would read as if it were still going on.
          set((st) => ({ toasts: st.toasts.filter((t) => t.scenarioId !== id) }));
          toast('resolved', `'${sc.title}' 장애를 해결했어요!`);
          return { concept: sc.concept, lesson: sc.lesson, scenarioId: id };
        }),
      );
      objectiveToasts(run, completed);
      // The last incident just got fixed: what waited for it comes up (unless a working window is open).
      if (resolved.length) releaseCards();
      afterChange(run);
    },

    interact: (spot) => {
      const s = get();
      if (!s.run || s.modal || s.dialogue) return;
      const k = interactionAt(s.run, spot);
      if (!k) return;
      get().openModal(interactionToModal(k));
      get().event(`interact:${spot}`);
    },

    enterRoom: (room) => get().event(`room:${room}`),

    event: (...events) => {
      const s = get();
      if (!s.run) return;
      const { run, completed } = recordEvents(s.run, events);
      set({ run });
      objectiveToasts(run, completed);
      afterChange(run);
    },

    act: (action, ...events) => {
      const s = get();
      if (!s.run) return;
      const { run, completed } = applyAction(s.run, action, events);
      set({ run });
      objectiveToasts(run, completed);
      afterChange(run);
    },

    command: (line, record = true) => {
      const s = get();
      if (!s.run) return { lines: [], clear: false };
      const res = applyCommand(s.run, line, s.terminal.host, s.terminal.mode ?? null);
      const trimmed = line.trim();
      let { host, mode, lines } = res;
      // A console cable doesn't log out to the 관리 PC: leaving the device from its own console just
      // frees the line, and the next Enter is back at the `>` prompt.
      if (mode === null && s.terminal.host === s.terminalOrigin && isGear(s.run.world, s.terminalOrigin)) {
        const name = s.run.world.devices[s.terminalOrigin]?.label ?? s.terminalOrigin;
        host = s.terminalOrigin;
        mode = USER_MODE;
        lines = [...lines, '', `${name} con0 is now available`, '', 'Press RETURN to get started.', ''];
      }
      set((st) => {
        const history = st.terminal.history ?? [];
        // No repeats in a row, like a shell.
        const next = record && trimmed && history[history.length - 1] !== trimmed ? [...history, trimmed].slice(-MAX_HISTORY) : history;
        return { run: res.run, terminal: { ...st.terminal, host, mode, history: next } };
      });
      objectiveToasts(res.run, res.completed);
      if (res.hint) lines = [...lines, ...terminalHint()];
      afterChange(res.run);
      return { lines, clear: res.clear };
    },

    appendTerminal: (lines) => set((s) => ({ terminal: { ...s.terminal, log: [...s.terminal.log, ...lines].slice(-MAX_LOG) } })),
    clearTerminal: () => set((s) => ({ terminal: { ...s.terminal, log: [] } })),
    setTerminalDraft: (text) => {
      if ((get().terminal.draft ?? '') !== text) set((s) => ({ terminal: { ...s.terminal, draft: text } }));
    },
    setWindowState: (key, value) => set((s) => ({ windowState: { ...s.windowState, [key]: { v: value } } })),

    openModal: (m) => {
      const s = get();
      set({ modal: m, modalStack: pushWindow(s.modal, s.modalStack, m), fixing: isFixing(m), ...sessionFor(s, m) });
      releaseCards();
      get().event(openEvent(m));
    },

    closeModal: () => {
      const s = get();
      const back = s.modalStack[s.modalStack.length - 1] ?? null;
      if (!back) {
        set(NO_WINDOWS);
        releaseCards();
        // Today's work was done with this window open: the last one closed, so the day ends now.
        const run = get().run;
        if (run && get().dayDone) afterChange(run);
        // Missions that showed up in the terminal, other than the one its side box explained, are briefed now.
        else if (run) previewMissions(run);
        return;
      }
      // The terminal underneath gets its own place's session back (it is still the active one unless
      // another place's terminal was opened on top meanwhile).
      set({ modal: back, modalStack: s.modalStack.slice(0, -1), fixing: isFixing(back), ...sessionFor(s, back) });
      releaseCards();
      const run = get().run;
      if (run) previewMissions(run);
    },

    leaveWork: () => {
      const s = get();
      if (!s.run || !s.dayDone || s.screen !== 'playing' || s.dialogue) return;
      finishStage(s.run);
    },

    nextDialogue: () => {
      // "지금까지" is the first page of the briefing: going on closes it and starts the day's lines.
      if (get().recap !== null) return get().dismissRecap();
      const d = get().dialogue;
      if (!d) return;
      if (d.index + 1 < d.lines.length) return set({ dialogue: { ...d, index: d.index + 1 } });
      set({ dialogue: null });
      if (d.then === 'results') set({ screen: 'results' });
      else {
        const run = get().run;
        // The day starts: its first missions are on the list now, each with its 미션 브리핑.
        if (run) {
          previewMissions(run);
          afterChange(run);
        }
      }
    },

    dismissConcept: () => set((s) => ({ concepts: s.concepts.slice(1) })),
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    // Free: the 힌트 받기 / 다음 단계 buttons ask "what now?" for the player, a typed question goes as it is.
    askHint: async (scenarioId, question) => void (await askInThread(scenarioId, question)),
    askMission: async (question) => void (await askInThread(MISSION_THREAD, question)),

    reveal: (scenarioId) => {
      const s = get();
      if (!s.run) return;
      const sc = getStage(s.run.stage).scenarios.find((x) => x.id === scenarioId);
      if (!sc) return;
      const run = revealSolution(s.run, scenarioId);
      const thread = [...(s.hints[scenarioId] ?? []), { from: 'system' as const, text: `정답: ${sc.solution}`, source: 'solution' as const }];
      set({ run, hints: { ...s.hints, [scenarioId]: thread } });
    },

    ackAlarm: (alarmId) => {
      const s = get();
      if (s.run) set({ run: ackAlarm(s.run, alarmId) });
    },

    escalate: (scenarioId) => {
      const s = get();
      if (!s.run) return;
      const run = escalate(s.run, scenarioId);
      if (run === s.run) return;
      set({ run });
      const team = scenarioOf(getStage(run.stage), scenarioId).escalate?.team;
      if (team) toast('info', `${team}에 이관했어요. 처리될 때까지 지켜봐요.`);
    },
  };
});

export function useGame<T>(selector: (s: GameState) => T): T {
  return useStore(gameStore, selector);
}

export const conceptOf = (id: string) => CONCEPTS[id];
