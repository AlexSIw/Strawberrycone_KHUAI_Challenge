// The 퇴근 퀴즈's rules, without any UI: which questions an attempt draws from the day's pool, the order its
// choices are shown in, and the steps from question to question. Everything is decided by the save's seed,
// the day and the attempt number, so a reopened window shows the same draw and the same order.
import { daySeed, mulberry32 } from '../sim/scheduler';
import type { Quiz, QuizQuestion } from './types';

export type QuizPhase =
  /** A question is up */
  | 'ask'
  /** Answered right: its explanation, then the next question */
  | 'right'
  /** Answered wrong: its explanation, then a fresh attempt from the first question */
  | 'wrong'
  /** Every question of the attempt answered right in one go */
  | 'cleared';

export interface QuizProgress {
  /** From 0; every restart after a wrong answer is a new attempt with a new draw */
  attempt: number;
  /** Which question of the attempt is up (0 … draw − 1) */
  index: number;
  phase: QuizPhase;
  /** The choice picked for this question, by its authored index (null while asking) */
  picked: number | null;
}

export const QUIZ_START: QuizProgress = { attempt: 0, index: 0, phase: 'ask', picked: null };

export type QuizStep = { type: 'pick'; choice: number } | { type: 'next' } | { type: 'restart' };

/**
 * The next progress after a step. `questions` are this attempt's questions in the order they are asked.
 * pick (while asking): right → 'right' ('cleared' on the last question), wrong → 'wrong'.
 * next (after a right answer): the next question. restart (after a wrong answer): a new attempt from the first.
 * Any other step leaves the progress as it is.
 */
export function quizReduce(p: QuizProgress, step: QuizStep, questions: readonly Pick<QuizQuestion, 'answer'>[]): QuizProgress {
  switch (step.type) {
    case 'pick': {
      const q = questions[p.index];
      if (p.phase !== 'ask' || !q) return p;
      const phase = step.choice !== q.answer ? 'wrong' : p.index >= questions.length - 1 ? 'cleared' : 'right';
      return { ...p, phase, picked: step.choice };
    }
    case 'next':
      return p.phase === 'right' ? { attempt: p.attempt, index: p.index + 1, phase: 'ask', picked: null } : p;
    case 'restart':
      return p.phase === 'wrong' ? { attempt: p.attempt + 1, index: 0, phase: 'ask', picked: null } : p;
  }
}

/** A random stream of its own for (seed, day, attempt, salt). */
function stream(seed: number, stage: number, attempt: number, salt: number): () => number {
  return mulberry32((daySeed(seed, stage) ^ Math.imul(attempt + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0);
}

/** 0 … n − 1, shuffled (Fisher–Yates). */
function shuffled(n: number, rnd: () => number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sameSet = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x) => b.includes(x));

/** How many questions an attempt asks (never more than the pool holds). */
export const drawCount = (quiz: Quiz) => Math.max(0, Math.min(quiz.draw, quiz.pool.length));

interface Attempt {
  /** Pool indices, in pool order (the day's order) */
  questions: number[];
  /** Pool index → the authored choice indices in the order they are shown */
  orders: Map<number, number[]>;
}

/**
 * Attempts 0 … `upTo`, each built on the one before: a draw that isn't the same set as the previous one
 * (when the pool has more questions than a draw), and for each question asked again, the right answer in
 * another slot than the last time it was asked.
 */
function attempts(quiz: Quiz, seed: number, stage: number, upTo: number): Attempt[] {
  const n = drawCount(quiz);
  const out: Attempt[] = [];
  const lastSlot = new Map<number, number>();
  for (let a = 0; a <= upTo; a++) {
    const perm = shuffled(quiz.pool.length, stream(seed, stage, a, 0));
    let pick = perm.slice(0, n);
    const prev = out[a - 1]?.questions;
    // The same three again: swap the last one for the next question of the shuffle (outside the set).
    if (prev && sameSet(pick, prev) && quiz.pool.length > n && n > 0) pick = [...perm.slice(0, n - 1), perm[n]];
    const questions = [...pick].sort((x, y) => x - y);
    const orders = new Map<number, number[]>();
    for (const q of questions) {
      const choices = quiz.pool[q].choices.length;
      let order = shuffled(choices, stream(seed, stage, a, q + 1));
      const slot = () => order.indexOf(quiz.pool[q].answer);
      // Right where it was the last time: move every choice one slot down.
      if (choices > 1 && lastSlot.get(q) === slot()) order = [order[choices - 1], ...order.slice(0, choices - 1)];
      lastSlot.set(q, slot());
      orders.set(q, order);
    }
    out.push({ questions, orders });
  }
  return out;
}

/** The pool indices an attempt asks, in the order it asks them. */
export function drawQuestions(quiz: Quiz, seed: number, stage: number, attempt: number): number[] {
  return attempts(quiz, seed, stage, attempt)[attempt].questions;
}

/**
 * The order an attempt shows pool question `q`'s choices in: authored choice indices, slot by slot. For a
 * question the attempt doesn't ask, the order it would have had.
 */
export function choiceOrder(quiz: Quiz, seed: number, stage: number, attempt: number, q: number): number[] {
  const a = attempts(quiz, seed, stage, attempt)[attempt];
  return a.orders.get(q) ?? shuffled(quiz.pool[q].choices.length, stream(seed, stage, attempt, q + 1));
}

/** One attempt as the window shows it: its questions and each one's choice order. */
export function attemptView(quiz: Quiz, seed: number, stage: number, attempt: number): { questions: number[]; orders: number[][] } {
  const a = attempts(quiz, seed, stage, attempt)[attempt];
  return { questions: a.questions, orders: a.questions.map((q) => a.orders.get(q)!) };
}
