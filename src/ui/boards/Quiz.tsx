import { useEffect, useRef } from 'react';
import { attemptView, QUIZ_START, quizReduce, runSeed, type QuizProgress, type QuizStep } from '../../content/quizRun';
import { getStage } from '../../content/stages';
import { gameStore, useGame } from '../../store/game';
import { ModalFrame } from '../ModalFrame';
import { Portrait } from '../Portrait';
import { useStageState } from '../useStageState';
import './Quiz.css';

// The 퇴근 퀴즈 on the 설계 보드: the questions of this attempt one by one, its choices shuffled. A wrong answer
// shows the explanation and starts a fresh draw from the first question; all right in one go clears it.

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const TITLE = '설계 보드 · 퇴근 퀴즈';

const TODO: Record<QuizProgress['phase'], string> = {
  ask: '답이라고 생각하는 보기를 눌러요. 틀리면 해설을 읽고 1번 문제부터 다시 풀어요.',
  right: '맞았어요! 해설을 읽고 다음 문제로 가요.',
  wrong: "아쉬워요. 해설을 읽고 '처음부터 다시'를 누르면 새로 뽑은 문제로 다시 풀어요.",
  cleared: "다 맞혔어요! 해설을 읽고 '알겠어요!'를 눌러요.",
};

export function Quiz() {
  const stage = useGame((s) => s.run?.stage);
  // A fresh draw for every run of the day (a retry or a replay), the same one while this run lasts.
  const seed = useGame((s) => runSeed(s.run?.seed ?? 1, s.stageEpoch));
  // One record for the whole quiz, kept for the stage: closing it (or a window opened on top, the 도감 with C,
  // the radio with H) comes back to the same question, choice order and explanation.
  const [progress, setProgress] = useStageState<QuizProgress>('quiz', QUIZ_START);
  const explainRef = useRef<HTMLDivElement>(null);
  // The explanation opens under the choices: bring it into view (on a small screen it starts below the fold).
  useEffect(() => {
    if (progress.phase !== 'ask') explainRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [progress.phase, progress.index, progress.attempt]);

  const quiz = stage === undefined ? undefined : getStage(stage).quiz;
  if (stage === undefined || !quiz || !quiz.pool.length) {
    return (
      <ModalFrame title={TITLE} size="narrow">
        <p className="muted">오늘은 퀴즈가 없어요.</p>
      </ModalFrame>
    );
  }

  const view = attemptView(quiz, seed, stage, progress.attempt);
  const at = Math.min(progress.index, view.questions.length - 1);
  const question = quiz.pool[view.questions[at]];
  const order = view.orders[at];
  const asked = view.questions.map((q) => quiz.pool[q]);
  const { phase, picked } = progress;
  const step = (s: QuizStep) => setProgress((p) => quizReduce(p, s, asked));

  // Closing (button, Esc or backdrop) after the last right answer records the quiz, which may end the day.
  const close = () => {
    const s = gameStore.getState();
    s.closeModal();
    if (phase === 'cleared' && !s.run?.ctx.events.includes('quiz:correct')) s.event('quiz:correct');
  };

  const footer =
    phase === 'right' ? (
      <button className="btn primary" onClick={() => step({ type: 'next' })}>
        다음 문제 ▶
      </button>
    ) : phase === 'wrong' ? (
      <button className="btn primary" onClick={() => step({ type: 'restart' })}>
        처음부터 다시 ▶
      </button>
    ) : phase === 'cleared' ? (
      <button className="btn primary" onClick={close}>
        알겠어요!
      </button>
    ) : undefined;

  const answered = phase === 'right' || phase === 'cleared';
  const dots = view.questions.map((_, i) => (i < at || (i === at && answered) ? '●' : '○')).join('');

  // The progress sits in the title bar, so it stays in sight when the explanation scrolls the body.
  const title = (
    <>
      {TITLE}
      <span className="qz-progress">
        문제 {at + 1}/{view.questions.length} <span aria-hidden>{dots}</span>
      </span>
    </>
  );

  return (
    <ModalFrame title={title} onClose={close} footer={footer}>
      <p className="qz-todo">{TODO[phase]}</p>
      <div className="qz-board">
        <div className="qz-q" data-q={view.questions[at]}>
          Q. {question.question}
        </div>
      </div>
      <div className="qz-choices">
        {order.map((c, slot) => {
          const isPicked = picked === c;
          const isWrong = phase === 'wrong' && isPicked;
          const isRight = answered && isPicked;
          return (
            <button
              key={`${progress.attempt}-${at}-${c}`}
              type="button"
              data-choice={c}
              className={['qz-choice', isWrong ? 'wrong shake' : '', isRight ? 'right' : ''].join(' ')}
              onClick={() => step({ type: 'pick', choice: c })}
              disabled={phase !== 'ask'}
            >
              <span className="qz-letter">{LETTERS[slot] ?? slot + 1}</span>
              <span className="qz-text">{question.choices[c]}</span>
              {isWrong && <span className="qz-mark">✕</span>}
              {isRight && <span className="qz-mark">○</span>}
            </button>
          );
        })}
      </div>

      {phase !== 'ask' && (
        <div className={`qz-mentor ${phase === 'wrong' ? 'is-warn' : 'is-ok'}`} ref={explainRef} key={`${progress.attempt}-${at}`}>
          <Portrait who="mentor" size={32} />
          <p>
            {phase === 'wrong' ? (
              <>
                <b>아깝다.</b> {question.explain} 처음부터 다시 풀어 보자.
              </>
            ) : (
              <>
                <b>맞았어!</b> {question.explain}
              </>
            )}
          </p>
        </div>
      )}
    </ModalFrame>
  );
}
