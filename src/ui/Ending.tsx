import { useEffect, type CSSProperties } from 'react';
import { CONCEPTS } from '../content/concepts';
import { STAGES } from '../content/stages';
import { gameStore, useGame } from '../store/game';
import { Portrait } from './Portrait';
import './Ending.css';

const CONFETTI_COLORS = ['#d7262b', '#e9b77c', '#ffd166', '#4fd17a', '#6ab7ff', '#f4ece4'];

/** The finale after D-Day: a certificate for the whole week. */
export function Ending() {
  const save = useGame((s) => s.save);
  const totalStars = STAGES.reduce((a, st) => a + (save.best[st.id]?.stars ?? 0), 0);
  // The certificate says "from the first day on" only when every day was really played.
  const allDays = STAGES.every((st) => !!save.best[st.id]);
  const owned = [...new Set(save.cards)].filter((c) => c in CONCEPTS);
  const cardTotal = Object.keys(CONCEPTS).length; // same total as the 개념 도감
  // Name the cards still to collect, so a gap reads as a goal rather than a counting bug.
  const missing = Object.keys(CONCEPTS).filter((id) => !owned.includes(id));
  const perfect = totalStars === STAGES.length * 3;
  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  useEffect(() => {
    const shownAt = performance.now();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || performance.now() - shownAt < 800) return;
      if ((e.target as HTMLElement | null)?.closest('button')) return;
      gameStore.getState().goTitle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <main className="end-screen">
      <div className="end-confetti" aria-hidden>
        {Array.from({ length: 36 }, (_, i) => {
          const style = {
            left: `${(i * 37) % 100}%`,
            background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            animationDelay: `${((i * 0.29) % 4).toFixed(2)}s`,
            animationDuration: `${4 + (i % 5) * 0.8}s`,
          } as CSSProperties;
          return <i key={i} style={style} />;
        })}
      </div>

      <article className="end-cert" aria-label="수료증">
        <div className="end-cert-inner">
          <p className="end-kicker">CERTIFICATE OF COMPLETION</p>
          <h1 className="end-title">수료증</h1>
          <p className="end-course">KHU 데이터센터 신입 엔지니어 과정</p>

          <div className="end-who">
            <Portrait who="lion" mood="happy" size={128} />
            <div>
              <p className="end-name">KHU 사자</p>
              <p className="end-role">데이터센터 신입 엔지니어</p>
            </div>
          </div>

          {allDays ? (
            <p className="end-body">
              위 사람은 D-5 첫 출근부터 케이블 한 줄, 스위치 설정, 관제까지 직접 해내며
              <br />
              수강신청 날 서버를 끝까지 지켜냈기에 이 증서를 드립니다.
            </p>
          ) : (
            <p className="end-body">
              위 사람은 수강신청 날 서버를 끝까지 지켜냈기에 이 증서를 드립니다.
              <br />
              <span className="muted">앞 날들(D-5~D-1)도 달력에서 해 보면, 그날 무엇을 지켰는지 더 잘 보여요.</span>
            </p>
          )}

          <div className="end-stats">
            <div>
              <span className="end-stat-label">모은 별</span>
              <span className="end-stat-value gold">
                ★ {totalStars}
                <small>/{STAGES.length * 3}</small>
              </span>
            </div>
            <div>
              <span className="end-stat-label">개념 카드</span>
              <span className="end-stat-value">
                🃏 {owned.length}
                <small>/{cardTotal}</small>
              </span>
              {missing.length > 0 && missing.length <= 3 && (
                <small className="end-stat-note">남은 카드: {missing.map((id) => CONCEPTS[id].name).join(', ')}</small>
              )}
            </div>
            <div>
              <span className="end-stat-label">마친 날</span>
              <span className="end-stat-value">
                {STAGES.filter((st) => save.best[st.id]).length}
                <small>/{STAGES.length}</small>
              </span>
            </div>
          </div>

          <section className="end-recap">
            <h2>지금까지 익힌 것</h2>
            <ol>
              {STAGES.map((st) => (
                <li key={st.id}>
                  <span className="end-recap-no">{st.label}</span>
                  <span className="end-recap-title">{st.title}</span>
                  <span className="end-recap-topics">{st.topics.join(' · ')}</span>
                  <span className="end-recap-stars" aria-label={`별 ${save.best[st.id]?.stars ?? 0}개`}>
                    {'★'.repeat(save.best[st.id]?.stars ?? 0)}
                    <span className="dim">{'★'.repeat(3 - (save.best[st.id]?.stars ?? 0))}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <div className="end-sign">
            <span>{today}</span>
            <span className="end-seal" aria-hidden>
              KHU
              <br />
              DC
            </span>
            <span>KHU 데이터센터 팀장 · 사수 쿠사수</span>
          </div>
        </div>
      </article>

      {/* Sticky so the next step is visible without scrolling past the certificate */}
      <div className="end-actions">
        <p className="end-next">
          {perfect ? '모든 날 별 3개! 완벽한 수료예요 🏆' : '축하해요! 별 3개를 못 받은 날은 달력에서 다시 도전할 수 있어요.'}
        </p>
        <button className="btn primary end-btn" onClick={() => gameStore.getState().goTitle()}>
          처음 화면으로
        </button>
      </div>
    </main>
  );
}
