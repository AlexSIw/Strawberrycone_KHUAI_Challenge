import { useEffect, useRef, type ReactNode } from 'react';
import { CONCEPTS, type Concept } from '../content/concepts';
import { gameStore, useGame, type ConceptPopup } from '../store/game';
import './ConceptCardPopup.css';

const CONCEPT_IDS = Object.keys(CONCEPTS);

const conceptOr = (id: string): Concept => CONCEPTS[id] ?? { id, name: id, analogy: '새로운 개념', definition: '' };

/**
 * One popup at a time from store.concepts, in three kinds:
 *  - 미션 브리핑 (kind 'preview'): a mission just appeared; what it is for and the cards to read first.
 *  - 배운 것 정리 (kind 'recap'): a mission is done; its card(s) join the collection, with what just happened.
 *  - 새 개념 카드 획득 (an incident's card): after an incident is fixed ("개념 카드 복습" when already collected).
 * The game is paused until it's dismissed. Cards earned in a working window (terminal, NOC, mini-game…) or
 * during an incident wait (store.heldConcepts), and briefings wait for working windows too, so nothing lands
 * on what the player is typing or looking at.
 */
export function ConceptCardPopup() {
  const popup = useGame((s) => s.concepts[0]);
  // What comes after this one: more cards, and/or new missions' briefings (a briefing is not a card).
  const moreCards = useGame((s) => s.concepts.slice(1).filter((c) => c.kind !== 'preview').length);
  const moreBriefs = useGame((s) => s.concepts.slice(1).filter((c) => c.kind === 'preview').length);
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
    const shownAt = performance.now();
    const onKey = (e: KeyboardEvent) => {
      // The card sits on top of everything: hotkeys, the game and any open window wait until it's closed.
      // Typed letters go nowhere, and Space never "clicks" 계속하기: only Enter, Esc or a click close it.
      e.stopPropagation();
      if (e.key === 'Tab' || e.key === ' ') return e.preventDefault();
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      e.preventDefault();
      if (e.type !== 'keydown' || e.repeat) return;
      // A key already on its way when the card appeared (the end of a typed line) doesn't close it unseen.
      if (performance.now() - shownAt < 300) return;
      gameStore.getState().dismissConcept();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, [visible, cardKey]);

  if (!visible || !popup) return null;
  // Never render nothing here: the game stays paused until this card is dismissed.
  const nextText = [moreCards ? `카드 ${moreCards}장 더 있어요` : '', moreBriefs ? `다음: 새 미션 브리핑${moreBriefs > 1 ? ` ${moreBriefs}개` : ''}` : '']
    .filter(Boolean)
    .join(' · ');
  const more = nextText && <span className="ccard-more">{nextText}</span>;
  const button = (label: string) => (
    <button ref={btnRef} className="btn primary ccard-btn" onClick={() => gameStore.getState().dismissConcept()}>
      {label} <kbd>Enter</kbd>
    </button>
  );
  if (popup.kind === 'preview') return <Briefing popup={popup} more={more} button={button('알겠어요, 시작!')} />;

  const c = conceptOr(popup.concept);
  const no = CONCEPT_IDS.indexOf(c.id) + 1;
  const recap = popup.kind === 'recap';
  const banner = recap ? '배운 것 정리' : popup.review ? '개념 카드 복습' : '새 개념 카드 획득!';
  const label = recap ? `배운 것 정리: ${c.name}` : `${popup.review ? '개념 카드 복습' : '새 개념 카드'}: ${c.name}`;

  return (
    <div className="ccard-backdrop" role="dialog" aria-modal="true" aria-label={label}>
      <div className="ccard-wrap" key={popup.scenarioId}>
        <div className="ccard-banner">{banner}</div>
        {recap && popup.mission && (
          <p className="ccard-done">
            미션 완료: <strong>{popup.mission}</strong>
          </p>
        )}
        <article className="ccard">
          <div className="ccard-shine" aria-hidden />
          <header className="ccard-head">
            {no > 0 && <span className="ccard-no">No.{String(no).padStart(2, '0')}</span>}
            <h2 className="ccard-name">{c.name}</h2>
            {recap && <span className={`ccard-badge ${popup.review ? '' : 'new'}`}>{popup.review ? '복습' : '새 카드'}</span>}
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
            {popup.lesson && (
              <>
                <dt>{recap ? '방금 한 일' : '방금 일어난 일'}</dt>
                <dd className="ccard-lesson">{popup.lesson}</dd>
              </>
            )}
          </dl>
        </article>
        <div className="ccard-actions">
          {more}
          {button('계속하기')}
        </div>
        <p className="ccard-tip">모은 카드는 도감(C)에서 다시 볼 수 있어요.</p>
      </div>
    </div>
  );
}

/** 미션 브리핑: the new mission, why it matters today, and its cards to read first. Nothing is awarded yet. */
function Briefing({ popup, more, button }: { popup: ConceptPopup; more: ReactNode; button: ReactNode }) {
  const cards = (popup.cards ?? []).map(conceptOr);
  return (
    <div className="ccard-backdrop" role="dialog" aria-modal="true" aria-label={`미션 브리핑: ${popup.mission ?? ''}`}>
      <div className="ccard-wrap ccard-wrap-brief" key={popup.scenarioId}>
        <div className="ccard-banner">미션 브리핑</div>
        <article className="ccard ccard-brief">
          <header className="ccard-brief-head">
            <span className="ccard-brief-tag">새 미션</span>
            <h2 className="ccard-brief-mission">{popup.mission}</h2>
          </header>
          {popup.why && <p className="ccard-why">{popup.why}</p>}
          {cards.length > 0 && (
            <section className="ccard-ahead" aria-label="먼저 알고 가기">
              <h3>먼저 알고 가기</h3>
              <ul>
                {cards.map((c) => (
                  <li key={c.id} className="ccard-mini">
                    <strong>{c.name}</strong>
                    <span className="ccard-mini-analogy">“{c.analogy}”</span>
                    {c.definition && <span className="ccard-mini-def">{c.definition}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
        <div className="ccard-actions">
          {more}
          {button}
        </div>
        <p className="ccard-tip">{cards.length ? '이 카드는 미션을 끝내면 받아요. 도감(C)에서도 미리 읽을 수 있어요.' : '미션 목록은 왼쪽 패널에 있어요.'}</p>
      </div>
    </div>
  );
}
