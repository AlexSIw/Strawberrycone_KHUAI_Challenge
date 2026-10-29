import { useEffect, type KeyboardEvent } from 'react';
import { STAGES } from '../content/stages';
import { koDate } from '../sim/clock';
import { LAST_DAY } from '../sim/types';
import { clearedDays, gameStore, useGame } from '../store/game';
import { PixelIcon } from './PixelIcon';
import './Calendar.css';

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

/** A held Enter (the key that opened this screen) must not start the card it lands on. */
const ignoreHeldEnter = (e: KeyboardEvent<HTMLButtonElement>) => {
  if (e.key === 'Enter' && e.repeat) e.preventDefault();
};

/** 완료한 날 다시 하기: the six days, the ones cleared on this save open to play again, the rest locked. */
export function Calendar() {
  const save = useGame((s) => s.save);
  const totalStars = Object.values(save.best).reduce((a, b) => a + b.stars, 0);
  const maxStars = STAGES.length * 3;
  const cleared = clearedDays(save).length;

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') gameStore.getState().goTitle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The first day to play gets the focus, a moment after the screen opens (so the Enter that opened it is let go).
  useEffect(() => {
    const id = window.setTimeout(() => document.querySelector<HTMLButtonElement>('.sel-card:not(:disabled)')?.focus({ preventScroll: true }), 300);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <main className="sel-screen">
      <header className="sel-head">
        <button className="btn sel-back" onClick={() => gameStore.getState().goTitle()}>
          ◀ 처음 화면
        </button>
        <div className="sel-head-text">
          <h1>완료한 날 다시 하기</h1>
          <p>{totalStars === maxStars ? '모든 날 별 3개! 마음에 드는 날을 다시 해 보세요.' : '끝낸 날을 골라 다시 해 보세요. 별 3개에 도전!'}</p>
        </div>
        <div className="sel-totals">
          <span title="모든 날에서 모은 별">
            ★ {totalStars}/{maxStars}
          </span>
          <span title="끝낸 날">
            {cleared}/{STAGES.length}일 완료
          </span>
        </div>
      </header>

      <ol className="sel-grid">
        {STAGES.map((st) => {
          const best = save.best[st.id];
          const dday = st.id === LAST_DAY;
          // Not cleared yet, and it is the day 이어서 하기 starts.
          const upNext = !best && st.id === save.unlocked;
          return (
            <li key={st.id}>
              <button
                className={`sel-card ${best ? 'cleared' : ''} ${dday ? 'dday' : ''}`}
                disabled={!best}
                onClick={() => gameStore.getState().replay(st.id)}
                onKeyDown={ignoreHeldEnter}
                aria-label={`${st.label} ${koDate(st.date)} ${st.title}${best ? '' : ' (잠김)'}`}
              >
                <div className="sel-card-top">
                  <span className="sel-no">{st.label}</span>
                  <span className="sel-date">{koDate(st.date)}</span>
                  {best && <Stars n={best.stars} />}
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
                  {best ? (
                    <span className="sel-best">최고 {best.points}점 · 다시 하기 ▶</span>
                  ) : upNext ? (
                    <span className="sel-locked">다음 차례 · '이어서 하기'로 시작</span>
                  ) : (
                    <span className="sel-locked">
                      <PixelIcon name="lock" />
                      아직 안 한 날
                    </span>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
