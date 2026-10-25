// Store rules behind the UI: the window back-stack (a window opened from another one goes back to it on
// close), the walking-speed setting, and what the objective list says while objectives are locked.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The store reads localStorage when it is created: give it one (node has none) before it loads.
const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  const ls = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
  (globalThis as { localStorage?: unknown }).localStorage = ls;
  return data;
});

import { getStage } from '../../src/content/stages';
import { applyCommand, startStage, tickRun, type StageRun } from '../../src/sim/engine';
import { gameStore, nextMoveSpeed, pushWindow, SPEED_KEY, windowKey, type Modal } from '../../src/store/game';
import { lockedText, nextStepText, objectiveStatus, waitingText } from '../../src/ui/objectiveStatus';

const S = () => gameStore.getState();
/** The open window and the ones waiting under it, top first, as window keys. */
const windows = () => [S().modal, ...[...S().modalStack].reverse()].filter((m): m is Modal => !!m).map(windowKey);

/** Starts a stage with its intro dialogue clicked through. */
function play(stage: Parameters<ReturnType<typeof S>['play']>[0]) {
  S().play(stage);
  for (let i = 0; i < 50 && S().dialogue; i++) S().nextDialogue();
}

describe('window stack', () => {
  beforeEach(() => play(3));

  it('a window opened from another one goes back to it when closed', () => {
    S().openModal({ type: 'terminal', host: 'ops' });
    S().openModal({ type: 'hint', scenarioId: 's3-port' });
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
    S().openModal({ type: 'terminal', host: 'ops' });
    S().appendTerminal(['hello']);
    S().command('ssh web');
    S().setTerminalDraft('hostna');
    const session = S().terminal;
    expect(session.host).toBe('web');
    S().openModal({ type: 'dashboard' });
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
    S().openModal({ type: 'hint', scenarioId: 's3-port' });
    expect(windows()).toEqual(['hint', 'terminal:ops']);
    expect(S().modal).toEqual({ type: 'hint', scenarioId: 's3-port' });
  });

  it('a window already waiting underneath is brought back, never duplicated', () => {
    S().openModal({ type: 'terminal', host: 'ops' });
    S().openModal({ type: 'hint' });
    S().openModal({ type: 'dashboard' });
    expect(windows()).toEqual(['dashboard', 'hint', 'terminal:ops']);
    // Back to the radio: the dashboard opened on top of it closes.
    S().openModal({ type: 'hint', scenarioId: 's3-port' });
    expect(windows()).toEqual(['hint', 'terminal:ops']);
    expect(S().modal).toEqual({ type: 'hint', scenarioId: 's3-port' });
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
    S().openModal({ type: 'dashboard' });
    expect(S().fixing).toBe(false);
    S().closeModal();
    expect(S().fixing).toBe(true);
    S().closeModal();
    expect(S().fixing).toBe(false);
  });

  it('restarting the stage, leaving it and the stage ending close every window', () => {
    const stack = () => {
      S().openModal({ type: 'terminal', host: 'ops' });
      S().openModal({ type: 'hint' });
      S().openModal({ type: 'concepts' });
      expect(windows()).toHaveLength(3);
    };
    stack();
    play(3);
    expect(windows()).toEqual([]);
    stack();
    S().goSelect();
    expect(windows()).toEqual([]);
    play(3);
    stack();
    S().goTitle();
    expect(windows()).toEqual([]);

    // Stage 0 ends when its last objective is done, with windows open.
    play(0);
    S().event('room:server', 'room:network', 'room:power', 'room:cooling', 'room:noc', 'open:dashboard');
    for (let i = 0; i < 20 && S().concepts.length; i++) S().dismissConcept();
    S().openModal({ type: 'quiz' });
    S().openModal({ type: 'hint' });
    expect(windows()).toEqual(['hint', 'quiz']);
    S().event('quiz:correct');
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

  it('a new stage keeps the speed', () => {
    gameStore.setState({ moveSpeed: 2 });
    play(2);
    expect(S().moveSpeed).toBe(2);
  });
});

describe('objective list wording', () => {
  /** Ticks until `until` holds (at most 300 s). */
  const tickUntil = (run: StageRun, until: (r: StageRun) => boolean) => {
    for (let i = 0; i < 300 && !until(run); i++) run = tickRun(run).run;
    return run;
  };
  const state = (r: StageRun, id: string) => r.scenarios.find((s) => s.id === id)!.state;

  it('stage 3: the 200 OK step opens when the port incident is solved, and says so', () => {
    const def = getStage(3);
    let run = startStage(3);
    let st = objectiveStatus(def, run);
    expect(st.open.map((o) => o.id)).toEqual(['start']);
    expect(lockedText(st)).toBe('이어지는 목표 1개 (앞 목표를 끝내면 열려요)');

    run = applyCommand(run, 'server start', 'web').run;
    expect(run.objectivesDone).toHaveProperty('start');
    st = objectiveStatus(def, run);
    // Waiting for the incident: not "목표 완료!" (one objective is still to come), and the lock says what opens it.
    expect(state(run, 's3-port')).toBe('waiting');
    expect(st.open).toEqual([]);
    expect(waitingText(st)).not.toContain('목표 완료');
    expect(lockedText(st)).toBe('이어지는 목표 1개 (장애를 해결하면 열려요)');

    run = tickUntil(run, (r) => state(r, 's3-port') === 'active');
    st = objectiveStatus(def, run);
    expect(nextStepText(st)).toContain('장애부터 해결하세요');
    expect(lockedText(st)).toBe('이어지는 목표 1개 (장애를 해결하면 열려요)');
  });

  it('stage 5: before the first incident nothing is "done", and the first objective opens soon', () => {
    const def = getStage(5);
    let run = startStage(5);
    let st = objectiveStatus(def, run);
    expect(st.open).toEqual([]);
    expect(nextStepText(st)).not.toContain('목표 완료');
    expect(lockedText(st)).toBe('이어지는 목표 5개 (첫 목표가 곧 열려요)');

    // Once the incident fires, the objectives are the way to solve it.
    run = tickUntil(run, (r) => state(r, 's5-drift') === 'active');
    st = objectiveStatus(def, run);
    expect(st.next?.id).toBe('log');
    expect(st.objectivesFixIncident).toBe(true);
    expect(nextStepText(st)).toContain('아래 목표를 차례로');
    expect(lockedText(st)).toBe('이어지는 목표 4개 (앞 목표를 끝내면 열려요)');
  });

  it('"목표 완료!" only once every objective is done', () => {
    const def = getStage(4);
    let run = startStage(4);
    expect(waitingText(objectiveStatus(def, run))).toBeNull();
    run = applyCommand(run, 'svc list', 'ops').run;
    const st = objectiveStatus(def, run);
    expect(st.doneCount).toBe(st.total);
    expect(waitingText(st)).toBe('목표 완료! 다음 상황을 기다리는 중이에요…');
  });
});
