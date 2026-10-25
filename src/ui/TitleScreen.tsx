import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { LAST_DAY, type StageId } from '../sim/types';
import { gameStore, useGame, type GameState } from '../store/game';
import { Credits } from './Credits';
import { SoundToggle } from './SoundToggle';
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

/** 이어하기: the store's continueGame() when it has one, else the furthest day reached. */
function continueGame(): void {
  const s = gameStore.getState() as GameState & { continueGame?: () => void };
  if (typeof s.continueGame === 'function') s.continueGame();
  else s.play(Math.min(s.save.unlocked, LAST_DAY) as StageId);
}

const hasSave = (s: GameState) => s.save.unlocked > 0 || Object.keys(s.save.best).length > 0;

export function TitleScreen() {
  const save = useGame((s) => s.save);
  const hasProgress = save.unlocked > 0 || Object.keys(save.best).length > 0;
  const stars = Object.values(save.best).reduce((a, b) => a + b.stars, 0);
  const [credits, setCredits] = useState(false);
  const closeCredits = useCallback(() => setCredits(false), []);

  // Enter does what the hint line says: first visit → a new game from D-5, returning player → 이어하기.
  // (Guarded so a held key from the previous screen doesn't fire it; off while the credits are open.)
  useEffect(() => {
    if (credits) return;
    const shownAt = performance.now();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || performance.now() - shownAt < 400) return;
      if ((e.target as HTMLElement | null)?.closest('button')) return;
      e.preventDefault();
      const s = gameStore.getState();
      if (hasSave(s)) continueGame();
      else s.newGame();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [credits]);

  const { play, goSelect, newGame } = gameStore.getState();

  return (
    <>
      <main className="title-screen">
        <nav className="title-corner" aria-label="설정">
          <SoundToggle className="title-corner-btn" />
          <button
            type="button"
            className="btn title-corner-btn"
            onClick={(e) => {
              e.currentTarget.blur();
              setCredits(true);
            }}
          >
            크레딧
          </button>
        </nav>

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
            D-5 첫 출근부터 수강신청 당일까지, 케이블 한 줄부터 관제까지 직접 지켜내세요!
          </p>

          <div className="title-buttons">
            {hasProgress && (
              <button className="btn primary title-btn" onClick={continueGame}>
                ▶ 이어하기
              </button>
            )}
            <button className={`btn title-btn${hasProgress ? '' : ' primary'}`} onClick={() => newGame()}>
              ✨ 새로 시작
            </button>
            <button className="btn title-btn title-dday" onClick={() => play(LAST_DAY)}>
              🔥 D-Day 바로 체험
            </button>
            <button className="btn title-btn" onClick={() => goSelect()}>
              📅 달력
            </button>
          </div>

          <p className="title-next">
            {hasProgress ? (
              <>
                저장된 기록 ★ {stars}개 · <kbd>Enter</kbd> 또는 <strong>이어하기</strong>로 계속해요.
              </>
            ) : (
              <>
                <kbd>Enter</kbd> 또는 <strong>새로 시작</strong>을 눌러 첫 출근을 해요. 수강신청 날만 보고 싶다면 <strong>D-Day 바로 체험</strong>!
              </>
            )}
          </p>
        </section>
      </main>
      {credits && <Credits onClose={closeCredits} />}
    </>
  );
}
