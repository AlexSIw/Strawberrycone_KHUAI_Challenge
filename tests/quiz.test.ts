// The 퇴근 퀴즈: the day's finale objective shows up only once every other mission is done and every
// incident is settled; each attempt draws its questions and shuffles their choices, and only a clean run clears it.
import { describe, expect, it } from 'vitest';
import { missionCards } from '../src/content/cards';
import { CONCEPTS } from '../src/content/concepts';
import { attemptView, choiceOrder, drawQuestions, QUIZ_START, quizReduce, type QuizProgress } from '../src/content/quizRun';
import { getStage, planIncidents, STAGES } from '../src/content/stages';
import type { Objective, Quiz, StageDef } from '../src/content/types';
import { incidentsSettled, startStage, visibleObjectives, type StageRun } from '../src/sim/engine';
import type { ScenarioRuntime } from '../src/sim/scenario';
import { interactionAt } from '../src/store/game';
import { lockedText, objectiveStatus, waitingText } from '../src/ui/objectiveStatus';

// ---------- the finale rule ----------

const FINALE: Objective = { id: 'finale', text: '퇴근 전 복습 퀴즈', finale: true, done: (_w, c) => c.events.includes('quiz:correct') };

/** D-3 with a finale objective added at the end (the rule doesn't depend on the day's content). */
const withFinale = (): StageDef => {
  const def = getStage(2);
  return { ...def, objectives: [...def.objectives.filter((o) => !o.finale), FINALE] };
};

/** Every objective of `def` but the finale done; the incidents set to `state`. */
function missionsDone(def: StageDef, state: ScenarioRuntime['state'] | ((r: ScenarioRuntime, i: number) => ScenarioRuntime['state'])): StageRun {
  const run = startStage(def.id, 1);
  const objectivesDone = Object.fromEntries(def.objectives.filter((o) => !o.finale).map((o) => [o.id, 0]));
  const scenarios = run.scenarios.map((r, i) => ({ ...r, state: typeof state === 'function' ? state(r, i) : state }));
  return { ...run, objectivesDone, scenarios };
}

const finaleShown = (def: StageDef, run: StageRun) => visibleObjectives(def, run).some((o) => o.finale);

describe('the finale objective', () => {
  it('is not shown at the start, nor while a mission is left', () => {
    const def = withFinale();
    expect(finaleShown(def, startStage(2, 1))).toBe(false);
    const run = missionsDone(def, 'resolved');
    const { [def.objectives[0].id]: _first, ...rest } = run.objectivesDone;
    const left = { ...run, objectivesDone: rest };
    expect(finaleShown(def, left)).toBe(false);
    const st = objectiveStatus(def, left);
    expect(st.lockReason).toBe('objective');
    expect(st.finaleLocked).toBe(false);
  });

  it('waits for an incident going on, and for one still to fire', () => {
    const def = withFinale();
    for (const state of ['active', 'waiting'] as const) {
      const run = missionsDone(def, (_r, i) => (i === 0 ? state : 'resolved'));
      expect(incidentsSettled(def, run), state).toBe(false);
      expect(finaleShown(def, run), state).toBe(false);
      const st = objectiveStatus(def, run);
      expect(st.lockReason, state).toBe('incident');
      expect(st.finaleLocked, state).toBe(true);
      expect(lockedText(st)).toBe('퇴근 전 복습 퀴즈 (오늘 미션과 장애를 다 끝내면 열려요)');
    }
    // Nothing on the list to do and nothing going on yet: the panel says the next thing is on its way.
    expect(waitingText(objectiveStatus(def, missionsDone(def, (_r, i) => (i === 0 ? 'waiting' : 'resolved'))))).toBe(
      '지금 할 목표는 다 했어요! 다음 상황을 기다리는 중이에요…',
    );
  });

  it('shows up once every mission is done and every incident is settled', () => {
    const def = withFinale();
    const run = missionsDone(def, 'resolved');
    expect(incidentsSettled(def, run)).toBe(true);
    expect(finaleShown(def, run)).toBe(true);
    const st = objectiveStatus(def, run);
    expect(st.next?.id).toBe('finale');
    expect(st.lockedCount).toBe(0);
    expect(lockedText(st)).toBeNull();
  });

  it('an optional incident that never fired counts as settled', () => {
    // D-2's container-port mistake (a condition trigger) may never happen.
    const def = getStage(3);
    const run = startStage(3, 1);
    const scenarios = run.scenarios.map((r) => ({ ...r, state: r.trigger.type === 'condition' ? ('waiting' as const) : ('resolved' as const) }));
    expect(scenarios.some((r) => r.state === 'waiting')).toBe(true);
    expect(incidentsSettled(def, { ...run, scenarios })).toBe(true);
  });
});

// ---------- one attempt after another ----------

/** A pool of five made-up questions (3 or 4 choices). */
const POOL: Quiz = {
  draw: 3,
  pool: Array.from({ length: 5 }, (_, i) => ({
    question: `Q${i}`,
    choices: Array.from({ length: i % 2 ? 3 : 4 }, (_, c) => `${i}-${c}`),
    answer: i % 3,
    explain: '해설이야.',
    concept: 'rack',
  })),
};

describe('quizReduce', () => {
  const asked = [0, 1, 2].map((q) => POOL.pool[q]);
  const pick = (p: QuizProgress, choice: number) => quizReduce(p, { type: 'pick', choice }, asked);

  it('a wrong answer stops the attempt; restart is a new attempt from the first question', () => {
    let p = pick(QUIZ_START, asked[0].answer);
    expect(p).toMatchObject({ phase: 'right', index: 0, picked: asked[0].answer });
    p = quizReduce(p, { type: 'next' }, asked);
    expect(p).toEqual({ attempt: 0, index: 1, phase: 'ask', picked: null });
    p = pick(p, asked[1].answer + 1);
    expect(p).toMatchObject({ phase: 'wrong', index: 1, picked: asked[1].answer + 1 });
    p = quizReduce(p, { type: 'restart' }, asked);
    expect(p).toEqual({ attempt: 1, index: 0, phase: 'ask', picked: null });
  });

  it('all right in one go clears it', () => {
    let p = QUIZ_START;
    for (let i = 0; i < asked.length; i++) {
      p = pick(p, asked[i].answer);
      if (i < asked.length - 1) p = quizReduce(p, { type: 'next' }, asked);
    }
    expect(p).toMatchObject({ phase: 'cleared', index: 2 });
  });

  it('steps only work where they belong', () => {
    expect(quizReduce(QUIZ_START, { type: 'next' }, asked)).toBe(QUIZ_START);
    expect(quizReduce(QUIZ_START, { type: 'restart' }, asked)).toBe(QUIZ_START);
    const right = pick(QUIZ_START, asked[0].answer);
    expect(pick(right, 3)).toBe(right);
    expect(quizReduce(right, { type: 'restart' }, asked)).toBe(right);
    const wrong = pick(QUIZ_START, asked[0].answer + 1);
    expect(quizReduce(wrong, { type: 'next' }, asked)).toBe(wrong);
    expect(pick(wrong, asked[0].answer)).toBe(wrong);
  });
});

describe('the draw and the choice order', () => {
  const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

  it('draws `draw` different questions, in pool order, the same for the same seed / day / attempt', () => {
    for (const seed of SEEDS) {
      for (let a = 0; a < 6; a++) {
        const qs = drawQuestions(POOL, seed, 2, a);
        expect(qs).toHaveLength(3);
        expect(new Set(qs).size).toBe(3);
        expect([...qs].sort((x, y) => x - y)).toEqual(qs);
        expect(drawQuestions(POOL, seed, 2, a)).toEqual(qs);
      }
    }
    // Other seeds and other days draw differently (not one fixed set for everyone).
    expect(new Set(SEEDS.map((s) => drawQuestions(POOL, s, 2, 0).join())).size).toBeGreaterThan(3);
    expect(new Set([0, 1, 2, 3, 4].map((d) => drawQuestions(POOL, 7, d, 0).join())).size).toBeGreaterThan(1);
  });

  it('a restart never draws the same three again', () => {
    for (const seed of SEEDS) {
      for (let a = 1; a < 12; a++) {
        expect(drawQuestions(POOL, seed, 0, a).join(), `seed ${seed} attempt ${a}`).not.toBe(drawQuestions(POOL, seed, 0, a - 1).join());
      }
    }
    // A pool of exactly `draw` questions has nothing else to draw.
    const small: Quiz = { draw: 3, pool: POOL.pool.slice(0, 3) };
    expect(drawQuestions(small, 1, 0, 1)).toEqual([0, 1, 2]);
  });

  it('shows every choice once, and the right one never in the same slot twice in a row for a question', () => {
    for (const seed of SEEDS) {
      const last = new Map<number, number>();
      for (let a = 0; a < 12; a++) {
        const view = attemptView(POOL, seed, 1, a);
        expect(view.questions).toEqual(drawQuestions(POOL, seed, 1, a));
        view.questions.forEach((q, i) => {
          const order = view.orders[i];
          expect([...order].sort()).toEqual(POOL.pool[q].choices.map((_, c) => c));
          expect(choiceOrder(POOL, seed, 1, a, q)).toEqual(order);
          const slot = order.indexOf(POOL.pool[q].answer);
          expect(slot, `seed ${seed} attempt ${a} question ${q}`).not.toBe(last.get(q));
          last.set(q, slot);
        });
      }
    }
  });

  it('the right answer lands in every slot over many seeds (the shuffle is not stuck)', () => {
    const slots = new Set(
      SEEDS.map((s) => attemptView(POOL, s, 0, 0)).flatMap((v) => v.questions.map((q, i) => v.orders[i].indexOf(POOL.pool[q].answer))),
    );
    expect(slots.size).toBe(4);
  });
});

// ---------- the days' quizzes ----------

const QUIZ_DAYS = STAGES.filter((d) => d.quiz);
const ABSOLUTE = /항상|절대|모든|반드시|무조건|전혀/;
/** Sentences of a text (a period inside 10.10.20.11 or (.1) doesn't end one). */
const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).filter((s) => s.trim());

describe.each(QUIZ_DAYS.map((d) => [d.label, d] as const))('%s 퇴근 퀴즈', (_label, def) => {
  const quiz = def.quiz!;
  const cards = new Set(def.objectives.filter((o) => !o.finale).flatMap(missionCards));

  it('a pool of 5, 3 drawn; closed by a finale mission at the 설계 보드 that gives no card', () => {
    expect(quiz.pool).toHaveLength(5);
    expect(quiz.draw).toBe(3);
    const last = def.objectives[def.objectives.length - 1];
    expect(last).toMatchObject({ id: 'quiz', finale: true, spot: 'board' });
    expect(missionCards(last)).toEqual([]);
    expect(def.objectives.filter((o) => o.finale)).toHaveLength(1);
    // The board's own use until the quiz is up (the quiz takes it over then).
    expect(def.interactions.board).toBeDefined();
    expect(def.interactions.board?.kind).not.toBe('quiz');
  });

  it.each(quiz.pool.map((q, i) => [i, q] as const))('question %i keeps the writing rules', (_i, q) => {
    expect(q.choices.length).toBeGreaterThanOrEqual(3);
    expect(q.choices.length).toBeLessThanOrEqual(4);
    expect(new Set(q.choices).size).toBe(q.choices.length);
    expect(q.answer).toBeGreaterThanOrEqual(0);
    expect(q.answer).toBeLessThan(q.choices.length);
    // Board text in 해요체; 쿠사수's explanation in 반말.
    expect(q.question).toMatch(/요\?$/);
    expect(q.explain.length).toBeLessThanOrEqual(120);
    expect(sentences(q.explain).length).toBeLessThanOrEqual(2);
    for (const s of sentences(q.explain)) expect(s, q.explain).not.toMatch(/요[.!?]$/);
    for (const t of [q.question, ...q.choices, q.explain]) expect(t).not.toMatch(ABSOLUTE);
    // No answer by length alone.
    const len = q.choices.map((c) => c.length);
    const right = len[q.answer];
    const others = len.filter((_, i) => i !== q.answer);
    expect(others.every((l) => l < right), `the only longest: ${q.choices[q.answer]}`).toBe(false);
    expect(others.every((l) => l > right), `the only shortest: ${q.choices[q.answer]}`).toBe(false);
    // It checks a card a mission of this day awards (never one from an incident).
    expect(q.concept in CONCEPTS).toBe(true);
    expect([...cards], q.question).toContain(q.concept);
  });

  it('no incident waits for the quiz (seeds 1–12)', () => {
    const finale = def.objectives.filter((o) => o.finale).map((o) => o.id);
    for (let seed = 1; seed <= 12; seed++) {
      for (const p of planIncidents(def, seed)) {
        if (p.trigger.type !== 'gate') continue;
        for (const id of finale) expect(p.trigger.objectives ?? [], `seed ${seed} ${p.id}`).not.toContain(id);
      }
    }
  });
});

describe('the 설계 보드 during the day and at its end', () => {
  it('D-Day has no quiz; every day with a quiz ends with it', () => {
    expect(getStage(5).quiz).toBeUndefined();
    expect(getStage(5).objectives.some((o) => o.finale)).toBe(false);
    for (const d of STAGES) expect(!!d.quiz, d.label).toBe(d.objectives.some((o) => o.finale));
  });

  it('D-5: the tour gives the EPS·TPS card, and the rack follows the tour', () => {
    const def = getStage(0);
    const o = (id: string) => def.objectives.find((x) => x.id === id)!;
    expect(missionCards(o('tour'))).toEqual(['datacenter', 'epstps']);
    expect(o('tour').why).toContain('TPS실');
    expect(o('mount').after).toEqual(['tour']);
  });

  it.each(QUIZ_DAYS.map((d) => [d.label, d] as const))('%s: the board opens the quiz only while it is on the list', (_label, def) => {
    let run = startStage(def.id, 1);
    expect(interactionAt(run, 'board')).toEqual(def.interactions.board);
    expect(interactionAt(run, 'desk')).toEqual(def.interactions.desk);
    run = missionsDone(def, 'resolved');
    expect(interactionAt(run, 'board')).toEqual({ kind: 'quiz' });
    expect(interactionAt(run, 'desk')).toEqual(def.interactions.desk);
    // An incident going on hides the quiz again (and gives the board back).
    expect(interactionAt(missionsDone(def, (_r, i) => (i === 0 ? 'active' : 'resolved')), 'board')).toEqual(def.interactions.board);
    run = { ...run, objectivesDone: { ...run.objectivesDone, quiz: 1 } };
    expect(interactionAt(run, 'board')).toEqual(def.interactions.board);
  });
});
