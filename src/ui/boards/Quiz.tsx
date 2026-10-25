import { useEffect, useRef, useState } from 'react';
import { CONCEPTS } from '../../content/concepts';
import { getStage } from '../../content/stages';
import type { StageId } from '../../sim/types';
import { gameStore, useGame } from '../../store/game';
import { ModalFrame } from '../ModalFrame';
import { Portrait } from '../Portrait';
import { useStageState } from '../useStageState';
import './Quiz.css';

// Whiteboard quiz (stage 0). A nudge for wrong answers that doesn't give the answer away.
const NUDGE: Partial<Record<StageId, string>> = {
  0: '우리가 지금 서 있는 이 건물은 뭘 하는 곳일까? 수강신청 기록은 모든 학생이 함께 봐야 하잖아.',
};
const DEFAULT_NUDGE = '문제를 한 번 더 천천히 읽어봐. 오늘 둘러본 방들이 힌트야.';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

export function Quiz() {
  const stage = useGame((s) => s.run?.stage);
  // Reopening a quiz that is already solved shows the answer instead of asking again.
  const solvedBefore = useGame((s) => !!s.run?.ctx.events.includes('quiz:correct'));
  // Wrong guesses stay crossed out for the stage.
  const [wrong, setWrong] = useStageState<number[]>('quiz:wrong', []);
  const [last, setLast] = useState<number | null>(null);
  // Answered right, but kept for when this window closes (see choose). Kept for the stage, so a window
  // opened on top of the quiz (도감 with C, the radio with H) goes back to the explanation, not the question.
  const [pending, setPending] = useStageState('quiz:pending', false);
  const correct = solvedBefore || pending;
  const explainRef = useRef<HTMLDivElement>(null);
  // The explanation opens under the choices: bring it into view (on a small screen it starts below the fold).
  useEffect(() => {
    if (correct) explainRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [correct]);

  const quiz = stage === undefined ? undefined : getStage(stage).quiz;
  if (stage === undefined || !quiz) {
    return (
      <ModalFrame title="설계 보드 · 퀴즈" icon="❓" size="narrow">
        <p className="muted">오늘은 퀴즈가 없어요.</p>
      </ModalFrame>
    );
  }
  // The quiz objective awards a concept card (stage 0: 데이터센터) when it completes.
  const card = getStage(stage).objectives.find((o) => o.id === 'quiz')?.concept;
  const cardName = card ? CONCEPTS[card]?.name : undefined;

  const choose = (i: number) => {
    if (correct) return;
    setLast(i);
    if (i === quiz.answer) {
      // Recorded when the window closes ("알겠어요!"): the mission's concept card would cover the
      // explanation the moment it appears.
      setPending(true);
    } else if (!wrong.includes(i)) {
      setWrong((w) => [...w, i]);
    }
  };

  // After reopening (nothing picked yet this time) the nudge stays up if there were wrong guesses.
  const showNudge = !correct && (last !== null ? last !== quiz.answer : wrong.length > 0);
  // Reopened after it was solved (an answer still to be recorded is "just solved", not "solved before").
  const again = solvedBefore && last === null;

  // Closing (button, Esc or backdrop) records a deferred answer, which may finish the stage.
  const close = () => {
    const s = gameStore.getState();
    s.closeModal();
    if (pending && !s.run?.ctx.events.includes('quiz:correct')) s.event('quiz:correct');
  };

  return (
    <ModalFrame
      title="설계 보드 · 퀴즈"
      icon="❓"
      onClose={close}
      footer={
        correct ? (
          <button className="btn primary" onClick={close}>
            알겠어요!
          </button>
        ) : undefined
      }
    >
      <p className="qz-todo">
        {again
          ? '✅ 이미 푼 퀴즈예요. 설명을 한 번 더 읽어봐요.'
          : correct
            ? '🎉 정답! 설명을 읽고 "알겠어요!"를 눌러주세요.'
            : '👉 정답이라고 생각하는 답을 눌러주세요.'}
      </p>
      <div className="qz-board">
        <div className="qz-q">Q. {quiz.question}</div>
      </div>
      <div className="qz-choices">
        {quiz.choices.map((c, i) => {
          const isWrong = wrong.includes(i);
          const isRight = correct && i === quiz.answer;
          return (
            <button
              key={i}
              type="button"
              className={['qz-choice', isWrong ? 'wrong' : '', isRight ? 'right' : '', last === i && isWrong ? 'shake' : ''].join(' ')}
              onClick={() => choose(i)}
              disabled={isWrong || (correct && !isRight)}
            >
              <span className="qz-letter">{LETTERS[i] ?? i + 1}</span>
              <span className="qz-text">{c}</span>
              {isWrong && <span className="qz-mark">✕</span>}
              {isRight && <span className="qz-mark">○</span>}
            </button>
          );
        })}
      </div>

      {showNudge && (
        <div className="qz-mentor is-warn" key={`nudge-${wrong.length}`}>
          <Portrait who="mentor" size={44} />
          <p>
            <b>다시 생각해볼까?</b> {NUDGE[stage] ?? DEFAULT_NUDGE}
          </p>
        </div>
      )}
      {correct && (
        <div className="qz-mentor is-ok" ref={explainRef}>
          <Portrait who="mentor" size={44} />
          <div>
            <p>
              <b>정답!</b> {quiz.explain}
            </p>
            {cardName && (
              <p className="qz-card">
                📖 "알겠어요!"를 누르면 개념 카드 <b>{cardName}</b>을(를) 받아요. <span className="muted">(C 키 = 개념 도감)</span>
              </p>
            )}
          </div>
        </div>
      )}
    </ModalFrame>
  );
}
