import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { requestHintText } from '../ai/client';
import { CONCEPTS } from '../content/concepts';
import { getStage, STAGES } from '../content/stages';
import type { DialogueLine, InteractionKind, NocTab, SpotId } from '../content/types';
import {
  ackAlarm,
  activeScenarios,
  applyAction,
  applyCommand,
  bumpHint,
  escalate,
  isCleared,
  recordEvents,
  revealSolution,
  scoreRun,
  startStage,
  tickRun,
  type Score,
  type StageRun,
} from '../sim/engine';
import { newSeed } from '../sim/scheduler';
import { LAST_DAY, type IosMode, type StageId, type World } from '../sim/types';

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
}

/** At most this many toasts at once, so the stack stays clear of the map's upper rooms. */
const MAX_TOASTS = 3;

export interface HintMessage {
  from: 'mentor' | 'player' | 'system';
  text: string;
  level?: number;
  source?: 'ai' | 'canned' | 'solution';
}

export interface ConceptPopup {
  concept: string;
  lesson: string;
  /** Scenario id, or "objective:<id>" for cards from objectives */
  scenarioId: string;
}

export interface SaveData {
  /** Highest day reached (every day is playable from the calendar; this only drives 이어하기) */
  unlocked: number;
  /** Seed of this save's incident plans: the same save replays the same surprises */
  seed: number;
  best: Record<number, { stars: number; points: number }>;
  cards: string[];
}

export type Screen = 'title' | 'select' | 'playing' | 'results' | 'ending';

/** Lion walking speed multiplier (the HUD's 🏃 button). */
export type MoveSpeed = 1 | 1.5 | 2;
export const MOVE_SPEEDS: readonly MoveSpeed[] = [1, 1.5, 2];

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

const freshSession = (host: string): TerminalSession => ({ host, log: [], history: [], draft: '' });

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
  /** Lion walking speed (kept in localStorage) */
  moveSpeed: MoveSpeed;
  /** 1x → 1.5x → 2x → 1x */
  cycleMoveSpeed(): void;
  dialogue: { lines: DialogueLine[]; index: number; then: 'play' | 'results' } | null;
  concepts: ConceptPopup[];
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
  goSelect(): void;
  play(stage: StageId): void;
  /** Start over: a fresh save seed (new surprises), progress kept */
  newGame(): void;
  finishResults(next: 'next' | 'retry' | 'select'): void;

  // loop
  tick(): void;
  isPaused(): boolean;

  // input
  interact(spot: SpotId): void;
  enterRoom(room: string): void;
  event(...events: string[]): void;
  act(action: (w: World) => void, ...events: string[]): void;
  /** Runs a line on the active terminal session's host (and keeps it in that session's history). */
  command(line: string): { lines: string[]; clear: boolean };
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
  reveal(scenarioId: string): void;
  /** NOC: acknowledge an alarm (MTTD stops here) */
  ackAlarm(alarmId: string): void;
  /** NOC: hand a shallow-area incident to its owning team */
  escalate(scenarioId: string): void;
}

// ---------- persistence ----------

const SAVE_KEY = 'khu-dc-save-v2';
const emptySave = (): SaveData => ({ unlocked: 0, seed: newSeed(), best: {}, cards: [] });

function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return emptySave();
    return { ...emptySave(), ...JSON.parse(raw) };
  } catch {
    return emptySave();
  }
}

function writeSave(s: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* private mode etc. — progress just won't persist */
  }
}

export const SPEED_KEY = 'khu-dc-speed';

function loadSpeed(): MoveSpeed {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return MOVE_SPEEDS.find((x) => x === v) ?? 1;
  } catch {
    return 1;
  }
}

function writeSpeed(v: MoveSpeed): void {
  try {
    localStorage.setItem(SPEED_KEY, String(v));
  } catch {
    /* storage blocked: the speed just resets next visit */
  }
}

export function nextMoveSpeed(v: MoveSpeed): MoveSpeed {
  return MOVE_SPEEDS[(MOVE_SPEEDS.indexOf(v) + 1) % MOVE_SPEEDS.length];
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

/** Event name recorded when a modal opens (objectives listen for these). */
function openEvent(m: Modal): string {
  if (m.type === 'hint') return 'open:mentor';
  return `open:${m.type}`;
}

const FIXING_MODALS: Modal['type'][] = ['terminal', 'rack', 'cable', 'power', 'repair', 'board'];

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
  return { terminals: { ...others, [s.terminalOrigin]: s.terminal }, terminal: session ?? freshSession(m.host), terminalOrigin: m.host };
}

// ---------- store ----------

export const gameStore = createStore<GameState>()((set, get) => {
  const toast = (kind: Toast['kind'], text: string, scenarioId?: string) => {
    const t: Toast = { id: ++toastSeq, kind, text, scenarioId };
    set((s) => ({ toasts: [...s.toasts.slice(-(MAX_TOASTS - 1)), t] }));
  };

  const awardCards = (popups: ConceptPopup[]) => {
    if (!popups.length) return;
    const save = { ...get().save, cards: [...new Set([...get().save.cards, ...popups.map((p) => p.concept)])] };
    writeSave(save);
    set((st) => ({ concepts: [...st.concepts, ...popups], save }));
  };

  const objectiveToasts = (run: StageRun, ids: string[]) => {
    const def = getStage(run.stage);
    const popups: ConceptPopup[] = [];
    for (const id of ids) {
      const o = def.objectives.find((x) => x.id === id);
      if (!o) continue;
      toast('objective', `✅ ${o.text}`);
      if (o.concept) popups.push({ concept: o.concept, lesson: o.lesson ?? CONCEPTS[o.concept]?.definition ?? '', scenarioId: `objective:${id}` });
    }
    awardCards(popups);
  };

  const afterChange = (run: StageRun) => {
    if (isCleared(run) && get().screen === 'playing' && !get().dialogue) finishStage(run);
  };

  const finishStage = (run: StageRun) => {
    const def = getStage(run.stage);
    const score = scoreRun(run);
    const save = { ...get().save, best: { ...get().save.best }, cards: [...get().save.cards] };
    const prev = save.best[run.stage];
    if (!prev || score.points > prev.points) save.best[run.stage] = { stars: score.stars, points: score.points };
    save.unlocked = Math.max(save.unlocked, Math.min(STAGES.length - 1, run.stage + 1));
    writeSave(save);
    set({
      save,
      lastScore: score,
      lastPrevBest: prev?.points ?? null,
      ...NO_WINDOWS,
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
    moveSpeed: loadSpeed(),
    cycleMoveSpeed: () => {
      const moveSpeed = nextMoveSpeed(get().moveSpeed);
      writeSpeed(moveSpeed);
      set({ moveSpeed });
    },
    dialogue: null,
    concepts: [],
    toasts: [],
    terminal: freshSession('ops'),
    terminalOrigin: 'ops',
    terminals: {},
    windowState: {},
    stageEpoch: 0,
    hints: {},
    hintPending: false,
    lastScore: null,
    lastPrevBest: null,
    fixing: false,
    paused: false,
    setPaused: (paused) => set({ paused }),

    goTitle: () => set({ screen: 'title', run: null, ...NO_WINDOWS, dialogue: null, toasts: [] }),
    goSelect: () => set({ screen: 'select', run: null, ...NO_WINDOWS, dialogue: null, toasts: [] }),
    newGame: () => {
      const save = { ...get().save, seed: newSeed() };
      writeSave(save);
      set({ save });
      get().play(0);
    },

    play: (stage) => {
      const def = getStage(stage);
      set({
        screen: 'playing',
        run: startStage(stage, get().save.seed),
        ...NO_WINDOWS,
        concepts: [],
        toasts: [],
        hints: {},
        hintPending: false,
        // Every place's terminal and every window's half-done work start over with the stage.
        terminal: freshSession('ops'),
        terminalOrigin: 'ops',
        terminals: {},
        windowState: {},
        stageEpoch: get().stageEpoch + 1,
        lastScore: null,
        lastPrevBest: null,
        paused: false,
        dialogue: { lines: def.intro, index: 0, then: 'play' },
      });
    },

    finishResults: (next) => {
      const run = get().run;
      if (!run) return get().goSelect();
      if (next === 'retry') return get().play(run.stage);
      if (next === 'next') {
        if (run.stage === LAST_DAY) return set({ screen: 'ending', ...NO_WINDOWS });
        return get().play((run.stage + 1) as StageId);
      }
      get().goSelect();
    },

    isPaused: () => {
      const s = get();
      return s.screen !== 'playing' || s.paused || !!s.dialogue || s.concepts.length > 0;
    },

    tick: () => {
      const s = get();
      if (!s.run || s.isPaused()) return;
      const { run, activated, resolved, completed } = tickRun(s.run);
      const def = getStage(run.stage);
      set({ run });
      for (const id of activated) {
        const sc = def.scenarios.find((x) => x.id === id)!;
        toast('alert', `🚨 ${sc.alert}`, id);
      }
      awardCards(
        resolved.map((id) => {
          const sc = def.scenarios.find((x) => x.id === id)!;
          // The alert for a solved incident would read as if it were still going on.
          set((st) => ({ toasts: st.toasts.filter((t) => t.scenarioId !== id) }));
          toast('resolved', `🎉 '${sc.title}' 장애를 해결했어요!`);
          return { concept: sc.concept, lesson: sc.lesson, scenarioId: id };
        }),
      );
      objectiveToasts(run, completed);
      afterChange(run);
    },

    interact: (spot) => {
      const s = get();
      if (!s.run || s.modal || s.dialogue) return;
      const k = getStage(s.run.stage).interactions[spot];
      if (!k) return;
      if (k.kind === 'quiz' && !getStage(s.run.stage).quiz) return;
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

    command: (line) => {
      const s = get();
      if (!s.run) return { lines: [], clear: false };
      const res = applyCommand(s.run, line, s.terminal.host, s.terminal.mode ?? null);
      const trimmed = line.trim();
      set((st) => {
        const history = st.terminal.history ?? [];
        // No repeats in a row, like a shell.
        const next = trimmed && history[history.length - 1] !== trimmed ? [...history, trimmed].slice(-MAX_HISTORY) : history;
        return { run: res.run, terminal: { ...st.terminal, host: res.host, mode: res.mode, history: next } };
      });
      objectiveToasts(res.run, res.completed);
      if (res.openHint) {
        const active = activeScenarios(res.run)[0];
        get().openModal({ type: 'hint', scenarioId: active?.rt.id });
      }
      afterChange(res.run);
      return { lines: res.lines, clear: res.clear };
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
      get().event(openEvent(m));
    },

    closeModal: () => {
      const s = get();
      const back = s.modalStack[s.modalStack.length - 1] ?? null;
      if (!back) return set(NO_WINDOWS);
      // The terminal underneath gets its own place's session back (it is still the active one unless
      // another place's terminal was opened on top meanwhile).
      set({ modal: back, modalStack: s.modalStack.slice(0, -1), fixing: isFixing(back), ...sessionFor(s, back) });
    },

    nextDialogue: () => {
      const d = get().dialogue;
      if (!d) return;
      if (d.index + 1 < d.lines.length) return set({ dialogue: { ...d, index: d.index + 1 } });
      set({ dialogue: null });
      if (d.then === 'results') set({ screen: 'results' });
      else {
        const run = get().run;
        if (run) afterChange(run);
      }
    },

    dismissConcept: () => set((s) => ({ concepts: s.concepts.slice(1) })),
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    askHint: async (scenarioId, question) => {
      const s = get();
      if (!s.run || s.hintPending) return;
      const def = getStage(s.run.stage);
      const sc = def.scenarios.find((x) => x.id === scenarioId);
      if (!sc) return;
      let run = s.run;
      let level = run.hintLevel[scenarioId] ?? 0;
      // Asking for "the next hint" climbs the ladder; a free question stays on the current rung.
      if (!question || level === 0) {
        const b = bumpHint(run, scenarioId);
        run = b.run;
        level = b.level;
      }
      const thread = [...(s.hints[scenarioId] ?? [])];
      if (question) thread.push({ from: 'player', text: question });
      set({ run, hintPending: true, hints: { ...s.hints, [scenarioId]: thread } });
      const reply = await requestHintText({ run, scenario: sc, level, question, history: thread, host: get().terminal.host });
      const cur = get();
      // The stage was started again while the answer was on its way: it belongs to the old run.
      if (cur.stageEpoch !== s.stageEpoch) return;
      const updated = [...(cur.hints[scenarioId] ?? thread), { from: 'mentor' as const, text: reply.text, level, source: reply.source }];
      set({ hintPending: false, hints: { ...cur.hints, [scenarioId]: updated } });
    },

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
      set({ run });
      const sc = getStage(run.stage).scenarios.find((x) => x.id === scenarioId);
      if (sc?.escalate) toast('info', `📨 ${sc.escalate.team}에 이관했어요. 처리될 때까지 지켜봐요.`);
    },
  };
});

export function useGame<T>(selector: (s: GameState) => T): T {
  return useStore(gameStore, selector);
}

export const conceptOf = (id: string) => CONCEPTS[id];
