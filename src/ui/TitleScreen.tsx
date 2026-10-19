import { useEffect, type CSSProperties } from 'react';
import { gameStore, useGame } from '../store/game';
import './TitleScreen.css';

/** Decorative server racks with blinking LEDs. */
function Rack({ units, seed }: { units: number; seed: number }) {
  return (
    <div className="title-rack" aria-hidden>
      {Array.from({ length: units }, (_, i) => (
        <div key={i} className="title-unit">
          {[0, 1, 2].map((l) => {
            const k = (seed * 7 + i * 3 + l * 5) % 11;
            const style = { animationDelay: `${(k * 0.37).toFixed(2)}s`, animationDuration: `${0.6 + (k % 4) * 0.35}s` } as CSSProperties;
            return <i key={l} className={`title-led ${k % 5 === 0 ? 'amber' : k % 7 === 0 ? 'red' : ''}`} style={style} />;
          })}
          <b />
        </div>
      ))}
    </div>
  );
}

export function TitleScreen() {
  const save = useGame((s) => s.save);
  const hasProgress = save.unlocked > 0 || Object.keys(save.best).length > 0;
  const stars = Object.values(save.best).reduce((a, b) => a + b.stars, 0);

  // Enter does what the hint line says: first visit → start Stage 0, returning player → stage select.
  // (Guarded so a held key from the previous screen doesn't fire it.)
  useEffect(() => {
    const shownAt = performance.now();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || performance.now() - shownAt < 400) return;
      if ((e.target as HTMLElement | null)?.closest('button')) return;
      e.preventDefault();
      const s = gameStore.getState();
      if (s.save.unlocked > 0 || Object.keys(s.save.best).length > 0) s.goSelect();
      else s.play(0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { play, goSelect } = gameStore.getState();

  return (
    <main className="title-screen">
      <div className="title-bg" aria-hidden>
        <div className="title-racks left">
          <Rack units={9} seed={1} />
          <Rack units={9} seed={2} />
        </div>
        <div className="title-racks right">
          <Rack units={9} seed={3} />
          <Rack units={9} seed={4} />
        </div>
        <div className="title-floor" />
        <div className="title-walker" />
      </div>

      <section className="title-center">
        <p className="title-kicker">경희대학교 데이터센터 운영 시뮬레이션</p>
        <h1 className="title-logo">
          <span className="title-logo-khu">KHU</span> 데이터센터
        </h1>
        <p className="title-sub">수강신청을 지켜라!</p>

        <div className="title-hero" aria-hidden>
          <div className="title-lion" />
          <div className="title-shadow" />
        </div>

        <p className="title-pitch">
          서버를 하나도 몰라도 괜찮아요.
          <br />
          케이블 한 줄부터 쿠버네티스까지, 수강신청 날 서버를 지켜내세요!
        </p>

        <div className="title-buttons">
          <button className="btn primary title-btn" onClick={() => play(0)}>
            ▶ 처음부터 시작
          </button>
          <button className="btn title-btn" onClick={() => goSelect()}>
            🗂 스테이지 선택
          </button>
        </div>

        <p className="title-next">
          {hasProgress ? (
            <>
              저장된 기록 ★ {stars}개 · 이어 하려면 <kbd>Enter</kbd> 또는 <strong>스테이지 선택</strong>을 눌러요.
            </>
          ) : (
            <>
              <kbd>Enter</kbd> 또는 <strong>처음부터 시작</strong>을 눌러 첫 출근을 해요.
            </>
          )}
        </p>
      </section>

    </main>
  );
}
