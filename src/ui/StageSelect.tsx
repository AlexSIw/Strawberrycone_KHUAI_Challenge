import { useEffect, useState } from 'react';
import { CONCEPTS } from '../content/concepts';
import { STAGES } from '../content/stages';
import type { StageId } from '../sim/types';
import { gameStore, useGame } from '../store/game';
import './StageSelect.css';

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

/** Pick a stage. Locked stages open one by one as you clear them. */
export function StageSelect() {
  const save = useGame((s) => s.save);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const { owned, collectible } = cardTotals(save.cards);
  const totalStars = Object.values(save.best).reduce((a, b) => a + b.stars, 0);
  const nextStage = STAGES.find((st) => st.id <= save.unlocked && !save.best[st.id]) ?? null;

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
          <h1>스테이지 선택</h1>
          <p>
            {nextStage
              ? `다음 할 일: Stage ${nextStage.id} 「${nextStage.title}」 카드를 눌러 시작하세요.`
              : '모든 스테이지를 클리어했어요! 별 3개에 도전해보세요.'}
          </p>
        </div>
        <div className="sel-totals">
          <span title="모든 스테이지에서 모은 별">
            ★ {totalStars}/{STAGES.length * 3}
          </span>
          <span title="모은 개념 카드">
            🃏 {owned.size}/{collectible.length}
          </span>
        </div>
      </header>

      <ol className="sel-grid">
        {STAGES.map((st) => {
          const locked = st.id > save.unlocked;
          const best = save.best[st.id];
          const isNext = nextStage?.id === st.id;
          return (
            <li key={st.id}>
              <button
                className={`sel-card ${locked ? 'locked' : ''} ${best ? 'cleared' : ''} ${isNext ? 'next' : ''}`}
                onClick={() => !locked && play(st.id)}
                disabled={locked}
                aria-label={`Stage ${st.id} ${st.title}${locked ? ' (잠김)' : ''}`}
              >
                <div className="sel-card-top">
                  <span className="sel-no">Stage {st.id}</span>
                  {locked ? <span className="sel-lock">🔒</span> : best ? <Stars n={best.stars} /> : isNext ? <span className="sel-new">NEW</span> : null}
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
                  {locked ? (
                    <span className="sel-locked-msg">이전 스테이지를 클리어하세요</span>
                  ) : best ? (
                    <span className="sel-best">최고 {best.points}점 · 다시 하기 ▶</span>
                  ) : (
                    <span className="sel-go">시작하기 ▶</span>
                  )}
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
            <span className="muted">📚 {detail.course}</span>
          </div>
        )}
      </section>
    </main>
  );
}
