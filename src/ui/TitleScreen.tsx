import { useCallback, useEffect, useState } from 'react';
import { STAGES } from '../content/stages';
import { LAST_DAY } from '../sim/types';
import { clearedDays, gameStore, hasSave, useGame } from '../store/game';
import { Credits } from './Credits';
import { KeySettings, useOwnKey } from './KeySettings';
import { SoundToggle } from './SoundToggle';
import { TitleBackdrop } from './TitleBackdrop';
import './TitleScreen.css';

export function TitleScreen() {
  const save = useGame((s) => s.save);
  const saved = hasSave(save);
  const canReplay = clearedDays(save).length > 0;
  const stars = Object.values(save.best).reduce((a, b) => a + b.stars, 0);
  const [credits, setCredits] = useState(false);
  const closeCredits = useCallback(() => setCredits(false), []);
  const [keyOpen, setKeyOpen] = useState(false);
  const closeKey = useCallback(() => setKeyOpen(false), []);
  const ownKeyInUse = useOwnKey();

  // Enter presses the button that shows it: 이어서 하기 with a save, else 새로 시작 (D-5).
  // (Guarded so a held key from the previous screen doesn't fire it; off while the credits or the key window are open.)
  useEffect(() => {
    if (credits || keyOpen) return;
    const shownAt = performance.now();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || performance.now() - shownAt < 400) return;
      if ((e.target as HTMLElement | null)?.closest('button')) return;
      e.preventDefault();
      const s = gameStore.getState();
      if (hasSave(s.save)) s.continueGame();
      else s.newGame();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [credits, keyOpen]);

  const { newGame, continueGame, goSelect } = gameStore.getState();

  return (
    <>
      <main className="title-screen">
        <nav className="title-corner" aria-label="설정">
          <SoundToggle className="title-corner-btn" />
          <button
            type="button"
            className="btn title-corner-btn"
            title="내 ChatKHU API 키로 AI 사수를 켜요 (선택)"
            onClick={(e) => {
              e.currentTarget.blur();
              setKeyOpen(true);
            }}
          >
            ChatKHU 키{ownKeyInUse ? ' ✓' : ''}
          </button>
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
          <TitleBackdrop />
        </div>

        <section className="title-center">
          <header className="title-head">
            <p className="title-kicker">경희대학교 데이터센터 운영 시뮬레이션</p>
            <h1 className="title-logo">
              <span className="title-logo-khu">KHU</span> 데이터센터
            </h1>
            <p className="title-sub">수강신청을 지켜라!</p>
          </header>

          <div className="title-body">
            <p className="title-pitch">서버를 몰라도 괜찮아요. D-5 첫 출근부터 수강신청 날까지, 학교 서버를 직접 지켜 내세요.</p>

            {/* A button that can't do anything yet stays in place, disabled, without its note. */}
            <div className="title-buttons">
              <button className={`btn title-btn${saved ? '' : ' primary'}`} onClick={() => newGame()} title="D-5부터 시작해요. 모은 별과 카드는 그대로예요.">
                새로 시작
                {!saved && <kbd>Enter</kbd>}
              </button>
              <button className={`btn title-btn${saved ? ' primary' : ''}`} disabled={!saved} onClick={() => continueGame()}>
                이어서 하기
                {saved && (
                  <>
                    <small className="title-btn-note">{STAGES[Math.min(save.unlocked, LAST_DAY)].label}</small>
                    <kbd>Enter</kbd>
                  </>
                )}
              </button>
              <button className="btn title-btn" disabled={!canReplay} onClick={() => goSelect()}>
                완료한 날 다시 하기
                {canReplay && <small className="title-btn-note">★ {stars}</small>}
              </button>
            </div>
          </div>
        </section>
      </main>
      {credits && <Credits onClose={closeCredits} />}
      {keyOpen && <KeySettings onClose={closeKey} />}
    </>
  );
}
