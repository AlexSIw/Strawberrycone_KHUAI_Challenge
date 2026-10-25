import { useEffect, useState } from 'react';
import { CONCEPTS } from '../content/concepts';
import { STAGES } from '../content/stages';
import { koDate } from '../sim/clock';
import { LAST_DAY, type StageId } from '../sim/types';
import { gameStore, useGame } from '../store/game';
import './Calendar.css';

/** Same count as the in-game 개념 도감 (📖, C): every concept card, in book order. */
function cardTotals(cards: string[]) {
  return { owned: new Set(cards.filter((c) => c in CONCEPTS)), collectible: Object.keys(CONCEPTS) };
}

function Stars({ n }: { n: number }) {
  return (
    <span className="sel-stars" aria-label={`별 ${n}개`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= n ? 'on' : ''}>
          ★
        </span>
      ))}
    </span>
  );
}

/** The week up to 수강신청: every day is open from the start (judges can jump to D-Day). */
export function Calendar() {
  const save = useGame((s) => s.save);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const { owned, collectible } = cardTotals(save.cards);
  const totalStars = Object.values(save.best).reduce((a, b) => a + b.stars, 0);
  const nextDay = STAGES.find((st) => !save.best[st.id]) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') gameStore.getState().goTitle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const play = (id: StageId) => gameStore.getState().play(id);
  const detail = openCard ? CONCEPTS[openCard] : null;

  return (
    <main className="sel-screen">
      <header className="sel-head">
        <button className="btn sel-back" onClick={() => gameStore.getState().goTitle()}>
          ◀ 처음 화면
        </button>
        <div className="sel-head-text">
          <h1>📅 수강신청까지 달력</h1>
          <p>
            {nextDay
              ? `다음 할 일: ${nextDay.label} 「${nextDay.title}」. 어느 날이든 바로 골라서 할 수 있어요.`
              : '모든 날을 마쳤어요! 별 3개에 도전해보세요.'}
          </p>
        </div>
        <div className="sel-totals">
          <span title="모든 날에서 모은 별">
            ★ {totalStars}/{STAGES.length * 3}
          </span>
          <span title="모은 개념 카드">
            🃏 {owned.size}/{collectible.length}
          </span>
        </div>
      </header>

      <ol className="sel-grid">
        {STAGES.map((st) => {
          const best = save.best[st.id];
          const isNext = nextDay?.id === st.id;
          const dday = st.id === LAST_DAY;
          return (
            <li key={st.id}>
              <button
                className={`sel-card ${best ? 'cleared' : ''} ${isNext ? 'next' : ''} ${dday ? 'dday' : ''}`}
                onClick={() => play(st.id)}
                aria-label={`${st.label} ${koDate(st.date)} ${st.title}`}
              >
                <div className="sel-card-top">
                  <span className="sel-no">{st.label}</span>
                  <span className="sel-date">{koDate(st.date)}</span>
                  {best ? <Stars n={best.stars} /> : isNext ? <span className="sel-new">NEXT</span> : null}
                </div>
                <h2 className="sel-title">{st.title}</h2>
                <p className="sel-subtitle">{st.subtitle}</p>
                <div className="sel-topics">
                  {st.topics.map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                </div>
                <div className="sel-card-foot">
                  {best ? <span className="sel-best">최고 {best.points}점 · 다시 하기 ▶</span> : <span className="sel-go">{dday ? '실전 시작 ▶' : '출근하기 ▶'}</span>}
                </div>
              </button>
            </li>
          );
        })}
      </ol>

      <section className="sel-book panel" aria-label="개념 도감">
        <div className="sel-book-head">
          <h2>📖 개념 도감</h2>
          <span className="sel-book-count">
            {owned.size} / {collectible.length}장
          </span>
          <div className="sel-book-bar" aria-hidden>
            <i style={{ width: `${collectible.length ? (owned.size / collectible.length) * 100 : 0}%` }} />
          </div>
        </div>
        <p className="sel-book-help">장애를 해결하면 카드를 얻어요. 모은 카드를 누르면 비유를 다시 볼 수 있어요.</p>
        <ul className="sel-book-grid">
          {collectible.map((id) => {
            const c = CONCEPTS[id];
            const have = owned.has(id);
            return (
              <li key={id}>
                <button
                  className={`sel-chip ${have ? 'have' : ''} ${openCard === id ? 'open' : ''}`}
                  disabled={!have}
                  onClick={() => setOpenCard(openCard === id ? null : id)}
                  title={have ? c.analogy : '아직 못 모은 카드'}
                >
                  {have ? c.name : '???'}
                </button>
              </li>
            );
          })}
        </ul>
        {detail && (
          <div className="sel-detail">
            <strong>{detail.name}</strong>
            <p className="sel-detail-analogy">“{detail.analogy}”</p>
            <p>{detail.definition}</p>
          </div>
        )}
      </section>
    </main>
  );
}
