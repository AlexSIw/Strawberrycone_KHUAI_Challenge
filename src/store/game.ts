import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { requestHintText } from '../ai/client';
import { CONCEPTS } from '../content/concepts';
import { getStage, STAGES } from '../content/stages';
import type { DialogueLine, InteractionKind, SpotId } from '../content/types';
import {
  activeScenarios,
  applyAction,
  applyCommand,
  bumpHint,
  isCleared,
  recordEvents,
  revealSolution,
  scoreRun,
  startStage,
  tickRun,
  type Score,
  type StageRun,
} from '../sim/engine';
import type { StageId, World } from '../sim/types';

// ---------- types ----------

export type Modal =
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
  | { type: 'concepts' };

export interface Toast {
  id: number;
  kind: 'alert' | 'resolved' | 'objective' | 'info';
  text: string;
}

export interface HintMessage {
  from: 'mentor' | 'player' | 'system';
  text: string;
  level?: number;
  source?: 'ai' | 'canned' | 'solution';
}

export interface ConceptPopup {
  concept: string;
  lesson: string;
  scenarioId: string;
}

export interface SaveData {
  unlocked: number;
  best: Record<number, { stars: number; points: number }>;
  cards: string[];
}

export type Screen = 'title' | 'select' | 'playing' | 'results' | 'ending';

export interface GameState {
  screen: Screen;
  run: StageRun | null;
  save: SaveData;
  modal: Modal | null;
  dialogue: { lines: DialogueLine[]; index: number; then: 'play' | 'results' } | null;
  concepts: ConceptPopup[];
  toasts: Toast[];
  terminal: { host: string; log: string[] };
  hints: Record<string, HintMessage[]>;
  hintPending: boolean;
  lastScore: Score | null;
  /** Is the lion working on a device (plays the fix animation)? */
  fixing: boolean;

  // navigation
  goTitle(): void;
  goSelect(): void;
  play(stage: StageId): void;
  finishResults(next: 'next' | 'retry' | 'select'): void;

  // loop
  tick(): void;
  isPaused(): boolean;

  // input
  interact(spot: SpotId): void;
  enterRoom(room: string): void;
  event(...events: string[]): void;
  act(action: (w: World) => void, ...events: string[]): void;
  command(line: string): { lines: string[]; clear: boolean };
  /** Terminal scrollback kept across open/close (the Terminal component writes here) */
  appendTerminal(lines: string[]): void;
  clearTerminal(): void;
  openModal(m: Modal): void;
  closeModal(): void;
  nextDialogue(): void;
  dismissConcept(): void;
  dismissToast(id: number): void;
  askHint(scenarioId: string, question?: string): Promise<void>;
  reveal(scenarioId: string): void;
}

// ---------- persistence ----------

const SAVE_KEY = 'khu-dc-save-v1';
const emptySave = (): SaveData => ({ unlocked: 0, best: {}, cards: [] });

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

// ---------- store ----------

export const gameStore = createStore<GameState>()((set, get) => {
  const toast = (kind: Toast['kind'], text: string) => {
    const t: Toast = { id: ++toastSeq, kind, text };
    set((s) => ({ toasts: [...s.toasts.slice(-4), t] }));
  };

  const objectiveToasts = (run: StageRun, ids: string[]) => {
    const def = getStage(run.stage);
    for (const id of ids) {
      const o = def.objectives.find((x) => x.id === id);
      if (o) toast('objective', `✅ ${o.text}`);
    }
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
    set({ save, lastScore: score, modal: null, fixing: false, dialogue: { lines: def.outro, index: 0, then: 'results' } });
  };

  return {
    screen: 'title',
    run: null,
    save: loadSave(),
    modal: null,
    dialogue: null,
    concepts: [],
    toasts: [],
    terminal: { host: 'ops', log: [] },
    hints: {},
    hintPending: false,
    lastScore: null,
    fixing: false,

    goTitle: () => set({ screen: 'title', run: null, modal: null, dialogue: null }),
    goSelect: () => set({ screen: 'select', run: null, modal: null, dialogue: null }),

    play: (stage) => {
      const def = getStage(stage);
      set({
        screen: 'playing',
        run: startStage(stage),
        modal: null,
        concepts: [],
        toasts: [],
        hints: {},
        hintPending: false,
        terminal: { host: 'ops', log: [] },
        lastScore: null,
        fixing: false,
        dialogue: { lines: def.intro, index: 0, then: 'play' },
      });
    },

    finishResults: (next) => {
      const run = get().run;
      if (!run) return get().goSelect();
      if (next === 'retry') return get().play(run.stage);
      if (next === 'next') {
        if (run.stage === 7) return set({ screen: 'ending', modal: null });
        return get().play((run.stage + 1) as StageId);
      }
      get().goSelect();
    },

    isPaused: () => {
      const s = get();
      return s.screen !== 'playing' || !!s.dialogue || s.concepts.length > 0;
    },

    tick: () => {
      const s = get();
      if (!s.run || s.isPaused()) return;
      const { run, activated, resolved, completed } = tickRun(s.run);
      const def = getStage(run.stage);
      set({ run });
      for (const id of activated) {
        const sc = def.scenarios.find((x) => x.id === id)!;
        toast('alert', `🚨 ${sc.alert}`);
      }
      if (resolved.length) {
        const popups: ConceptPopup[] = resolved.map((id) => {
          const sc = def.scenarios.find((x) => x.id === id)!;
          toast('resolved', `🎉 해결: ${sc.title}`);
          return { concept: sc.concept, lesson: sc.lesson, scenarioId: id };
        });
        const save = { ...get().save, cards: [...new Set([...get().save.cards, ...popups.map((p) => p.concept)])] };
        writeSave(save);
        set((st) => ({ concepts: [...st.concepts, ...popups], save }));
      }
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
      const res = applyCommand(s.run, line, s.terminal.host);
      set({ run: res.run, terminal: { host: res.host, log: get().terminal.log } });
      objectiveToasts(res.run, res.completed);
      if (res.openHint) {
        const active = activeScenarios(res.run)[0];
        set({ modal: { type: 'hint', scenarioId: active?.rt.id } });
      }
      afterChange(res.run);
      return { lines: res.lines, clear: res.clear };
    },

    appendTerminal: (lines) => set((s) => ({ terminal: { ...s.terminal, log: [...s.terminal.log, ...lines].slice(-400) } })),
    clearTerminal: () => set((s) => ({ terminal: { ...s.terminal, log: [] } })),

    openModal: (m) => {
      const patch: Partial<GameState> = { modal: m, fixing: FIXING_MODALS.includes(m.type) };
      if (m.type === 'terminal') patch.terminal = { host: m.host, log: get().terminal.log };
      set(patch);
      get().event(openEvent(m));
    },

    closeModal: () => set({ modal: null, fixing: false }),

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
  };
});

export function useGame<T>(selector: (s: GameState) => T): T {
  return useStore(gameStore, selector);
}

export const conceptOf = (id: string) => CONCEPTS[id];
