import { useEffect, useRef, type ReactNode } from 'react';
import { dayRecap } from '../content/cards';
import { CONCEPTS } from '../content/concepts';
import { STAGES } from '../content/stages';
import type { StageId } from '../sim/types';
import { gameStore, useGame } from '../store/game';
import './Recap.css';

/**
 * "지금까지": what the days before `stage` built and the cards they teach (each opens to its meaning), plus the
 * tools today needs when the day has a primer. Shown before the briefing of a day started cold, and from the
 * calendar's '지금까지 요약'.
 */
export function RecapPanel({ stage, actions, titleId }: { stage: StageId; actions: ReactNode; titleId: string }) {
  const def = STAGES[stage];
  const { built, concepts, primer } = dayRecap(stage);
  const owned = new Set(useGame((s) => s.save.cards));
  const first = STAGES[0];
  const prev = STAGES[stage - 1];
  const span = prev ? (prev.id === first.id ? first.label : `${first.label}~${prev.label}`) : '';

  return (
    <section className="rcp panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="rcp-head">
        <span className="rcp-kicker">
          {def.label} 「{def.title}」 시작 전
        </span>
        <h2 id={titleId}>지금까지</h2>
        <p className="rcp-lead">
          {span ? `${span}에 한 일과 배운 개념을 짧게 정리했어요. 오늘은 이 위에서 시작해요.` : '오늘 쓸 도구를 먼저 짚고 가요.'}
        </p>
      </header>

      <div className="rcp-body">
        {built.length > 0 && (
          <section className="rcp-sec" aria-label="지금까지 만든 것">
            <h3>지금까지 만든 것</h3>
            <ul className="rcp-built">
              {built.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </section>
        )}

        {concepts.length > 0 && (
          <section className="rcp-sec" aria-label="알고 가면 좋은 개념">
            <h3>알고 가면 좋은 개념</h3>
            <p className="rcp-help">누르면 뜻이 펼쳐져요.</p>
            <div className="rcp-cards">
              {concepts.map((id) => {
                const c = CONCEPTS[id];
                return (
                  <details key={id} className="rcp-card">
                    <summary>
                      <strong>{c.name}</strong>
                      <span className="rcp-analogy">“{c.analogy}”</span>
                      {owned.has(id) && <span className="rcp-have">모은 카드</span>}
                    </summary>
                    <p>{c.definition}</p>
                  </details>
                );
              })}
            </div>
          </section>
        )}

        {primer.length > 0 && (
          <section className="rcp-sec" aria-label="오늘 쓸 도구">
            <h3>오늘 쓸 도구</h3>
            <table className="rcp-tools">
              <thead>
                <tr>
                  <th scope="col">도구</th>
                  <th scope="col">하는 일</th>
                </tr>
              </thead>
              <tbody>
                {primer.map((p) => (
                  <tr key={p.tool}>
                    <th scope="row">{p.tool}</th>
                    <td>{p.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      <footer className="rcp-foot">{actions}</footer>
    </section>
  );
}

const FOCUSABLE = 'button, summary, [href], [tabindex]:not([tabindex="-1"])';

/** Tab / Shift+Tab cycle inside `root` (the screen covers everything, so focus never wanders under it). */
function trapTab(e: KeyboardEvent, root: HTMLElement | null) {
  if (!root) return;
  const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
  if (!items.length) return;
  e.preventDefault();
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i < 0 || i === items.length - 1 ? 0 : i + 1;
  items[next].focus();
}

/**
 * The in-game "지금까지" screen (store.recap), over everything before the day's briefing. The game is paused
 * meanwhile. Enter, Space or 계속 closes it and the briefing starts (Enter/Space on a card reached with Tab opens it).
 */
export function Recap() {
  const stage = useGame((s) => s.recap);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  /** Focus is on a card the player moved to with Tab (not one just clicked open with the mouse). */
  const tabbed = useRef(false);

  useEffect(() => {
    if (stage === null) return;
    btn.current?.focus({ preventScroll: true });
    const shownAt = performance.now();
    const onKey = (e: KeyboardEvent) => {
      // Hotkeys, the map and the briefing wait until this is closed.
      e.stopPropagation();
      if (e.type !== 'keydown') return;
      if (e.key === 'Tab') {
        tabbed.current = true;
        return trapTab(e, root.current);
      }
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Escape') return;
      // A card reached with Tab opens / closes with Enter or Space; a card clicked open doesn't keep the keys.
      const onCard = e.target instanceof HTMLElement && e.target.tagName === 'SUMMARY' && tabbed.current;
      if (onCard && e.key !== 'Escape') return;
      e.preventDefault();
      // The key that started the day (Enter on the calendar) doesn't close it unseen.
      if (e.repeat || performance.now() - shownAt < 300) return;
      gameStore.getState().dismissRecap();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, [stage]);

  if (stage === null) return null;
  return (
    <div className="rcp-backdrop" ref={root} onPointerDown={() => (tabbed.current = false)}>
      <RecapPanel
        stage={stage}
        titleId="rcp-title-game"
        actions={
          <>
            <span className="rcp-keys">
              <kbd>Enter</kbd> · <kbd>Space</kbd>
            </span>
            <button ref={btn} className="btn primary rcp-go" onClick={() => gameStore.getState().dismissRecap()}>
              계속 ▶ 오늘 브리핑 듣기
            </button>
          </>
        }
      />
    </div>
  );
}
