import { useEffect, useRef } from 'react';
import { CONCEPTS } from '../content/concepts';
import { gameStore, useGame } from '../store/game';
import './ConceptCardPopup.css';

const CONCEPT_IDS = Object.keys(CONCEPTS);

/** "새 개념 카드 획득!" — shown after an incident is fixed. The game is paused until it's dismissed. */
export function ConceptCardPopup() {
  const popup = useGame((s) => s.concepts[0]);
  const queued = useGame((s) => s.concepts.length);
  // The intro hides cards; the outro waits for them (DialogueBox holds it back while cards are queued).
  const blocked = useGame((s) => s.screen !== 'playing' || (!!s.dialogue && s.dialogue.then !== 'results'));
  const visible = !!popup && !blocked;
  const btnRef = useRef<HTMLButtonElement>(null);

  // Take focus while open (so typing doesn't go into a terminal underneath) and give it back afterwards.
  useEffect(() => {
    if (!visible) return;
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (prev && prev.isConnected) prev.focus({ preventScroll: true });
    };
  }, [visible]);
  // Each card remounts (key = scenario), so focus the new button every time.
  const cardKey = popup?.scenarioId;
  useEffect(() => {
    if (visible) btnRef.current?.focus({ preventScroll: true });
  }, [visible, cardKey]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      // The card sits on top of everything: hotkeys, the game and any open window wait until it's closed.
      e.stopPropagation();
      if (e.key === 'Tab') return e.preventDefault(); // keep focus on the only button
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      e.preventDefault();
      if (!e.repeat) gameStore.getState().dismissConcept();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [visible]);

  if (!visible || !popup) return null;
  // Never render nothing here: the game stays paused until this card is dismissed.
  const c = CONCEPTS[popup.concept] ?? { id: popup.concept, name: popup.concept, analogy: '새로운 개념', definition: '', course: '' };
  const no = CONCEPT_IDS.indexOf(c.id) + 1;

  return (
    <div className="ccard-backdrop" role="dialog" aria-modal="true" aria-label={`새 개념 카드: ${c.name}`}>
      <div className="ccard-wrap" key={popup.scenarioId}>
        <div className="ccard-banner">✨ 새 개념 카드 획득! ✨</div>
        <article className="ccard">
          <div className="ccard-shine" aria-hidden />
          <header className="ccard-head">
            {no > 0 && <span className="ccard-no">No.{String(no).padStart(2, '0')}</span>}
            <h2 className="ccard-name">{c.name}</h2>
          </header>
          <div className="ccard-art">
            <span className="ccard-quote" aria-hidden>
              “
            </span>
            <p className="ccard-analogy">{c.analogy}</p>
            <span className="ccard-art-label">한 줄 비유</span>
          </div>
          <dl className="ccard-body">
            {c.definition && (
              <>
                <dt>뜻</dt>
                <dd>{c.definition}</dd>
              </>
            )}
            <dt>방금 일어난 일</dt>
            <dd className="ccard-lesson">{popup.lesson}</dd>
          </dl>
          <footer className="ccard-foot">
            {c.course && <span className="ccard-course">📚 {c.course}</span>}
          </footer>
        </article>
        <div className="ccard-actions">
          {queued > 1 && <span className="ccard-more">카드 {queued - 1}장 더 있어요</span>}
          <button ref={btnRef} className="btn primary ccard-btn" onClick={() => gameStore.getState().dismissConcept()}>
            계속하기 <kbd>Enter</kbd>
          </button>
        </div>
        <p className="ccard-tip">모은 카드는 📖 도감(C)에서 다시 볼 수 있어요.</p>
      </div>
    </div>
  );
}
