import { useEffect, useState } from 'react';
import { CONCEPTS } from '../content/concepts';
import { getStage, STAGES } from '../content/stages';
import { gameStore, useGame } from '../store/game';
import './Results.css';

/** Counts up from 0 to `to` over ~0.9s. */
function useCountUp(to: number): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      const p = Math.min(1, (now - start) / 900);
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return v;
}

function advice(stars: number, hintPenalty: number, revealed: number, mttr: number | null, availability: number): string {
  if (stars === 3) return '완벽해요! 이 실력이면 수강신청 날도 문제없어요.';
  if (revealed > 0) return '다음엔 "정답 보기" 전에 힌트를 한 단계씩 먼저 받아보세요.';
  if (hintPenalty > 2) return '힌트를 조금만 아끼면 별이 더 늘어나요.';
  if (mttr !== null && mttr > 60) return '장애 알림이 오면 대시보드부터 보고 빨리 움직여보세요.';
  if (availability < 0.9) return '서비스가 멈춘 시간이 길었어요. 장애를 빨리 고치면 가용성이 올라가요.';
  return '좋아요! 다시 하면 별 3개도 노려볼 수 있어요.';
}

/**
 * Cards no incident awards but that belong to a stage (same mapping as the concept book).
 * Listed here once the save holds them, so Results stays right whichever way the store grants them.
 */
const STAGE_EXTRA_CARDS: Partial<Record<number, string[]>> = { 0: ['datacenter'], 2: ['dhcp'], 7: ['postmortem'] };

/** Stage clear screen with score breakdown and the cards earned. */
export function Results() {
  const score = useGame((s) => s.lastScore);
  const run = useGame((s) => s.run);
  const best = useGame((s) => (s.run ? s.save.best[s.run.stage] : undefined));
  const savedCards = useGame((s) => s.save.cards);
  const points = useCountUp(score?.points ?? 0);

  const isFinal = run?.stage === STAGES.length - 1;

  useEffect(() => {
    const shownAt = performance.now();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      // A focused results button handles Enter itself. Any other focused button (e.g. a HUD button
      // clicked earlier, now hidden under this screen) must never be pressed by it.
      if ((e.target as HTMLElement | null)?.closest('.res-card button')) return;
      e.preventDefault();
      if (e.repeat || performance.now() - shownAt < 500) return; // the key that closed the outro dialogue
      gameStore.getState().finishResults('next');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!run || !score) return null;
  const def = getStage(run.stage);

  const earned = [
    ...new Set([
      ...run.scenarios
        .filter((r) => r.state === 'resolved')
        .map((r) => def.scenarios.find((s) => s.id === r.id)?.concept),
      ...(STAGE_EXTRA_CARDS[run.stage] ?? []).filter((c) => savedCards.includes(c)),
    ]),
  ]
    .filter((c): c is string => !!c && c in CONCEPTS)
    .map((id) => CONCEPTS[id]);

  const finish = gameStore.getState().finishResults;
  const hintPoints = score.hintPenalty * 5;
  const revealPoints = score.revealed * 15;

  return (
    <div className="res-backdrop" role="dialog" aria-modal="true" aria-label={`Stage ${run.stage} 결과`}>
      <div className="res-card panel">
        <p className="res-kicker">
          Stage {run.stage} · {def.title}
        </p>
        <h1 className="res-title">Stage {run.stage} 클리어!</h1>

        <div className="res-stars" aria-label={`별 ${score.stars}개`}>
          {[1, 2, 3].map((n) => (
            <span key={n} className={`res-star ${n <= score.stars ? 'on' : ''}`} style={{ animationDelay: `${0.25 + n * 0.3}s` }}>
              ★
            </span>
          ))}
        </div>

        <div className="res-points">
          <span className="res-points-value">{points}</span>
          <span className="res-points-unit">/ 100점</span>
          {best && <span className="res-best">최고 기록 {best.points}점</span>}
        </div>

        <dl className="res-stats">
          <div>
            <dt>가용성 평균</dt>
            <dd className={score.availability >= 0.99 ? 'ok' : score.availability >= 0.8 ? 'warn' : 'bad'}>{(score.availability * 100).toFixed(1)}%</dd>
          </div>
          <div>
            <dt>평균 복구시간 (MTTR)</dt>
            <dd>{score.mttr === null ? '장애 없음' : `${Math.round(score.mttr)}초`}</dd>
          </div>
          <div>
            <dt>힌트 감점</dt>
            <dd className={hintPoints ? 'warn' : 'ok'}>{hintPoints ? `−${hintPoints}점` : '없음'}</dd>
          </div>
          <div>
            <dt>정답 보기</dt>
            <dd className={score.revealed ? 'bad' : 'ok'}>
              {score.revealed}회{revealPoints ? ` (−${revealPoints}점)` : ''}
            </dd>
          </div>
        </dl>

        <p className="res-advice">💬 {advice(score.stars, score.hintPenalty, score.revealed, score.mttr, score.availability)}</p>

        <section className="res-cards">
          <h2>이번 스테이지에서 얻은 개념 카드</h2>
          {earned.length === 0 ? (
            <p className="muted res-none">
              {def.scenarios.length === 0 ? '튜토리얼에는 카드가 없어요. 다음 스테이지부터 장애를 고치면 카드를 얻어요!' : '이번엔 얻은 카드가 없어요.'}
            </p>
          ) : (
            <ul>
              {earned.map((c, i) => (
                <li key={c.id} className="res-mini" style={{ animationDelay: `${1.2 + i * 0.12}s` }} title={c.definition}>
                  <strong>{c.name}</strong>
                  <span>{c.analogy}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="res-next-hint">{isFinal ? 'Enter를 누르면 엔딩을 볼 수 있어요.' : 'Enter를 누르면 다음 스테이지로 가요.'}</p>

        <div className="res-actions">
          <button className="btn" onClick={() => finish('select')}>
            스테이지 선택
          </button>
          <button className="btn" onClick={() => finish('retry')}>
            다시 하기
          </button>
          <button className="btn primary res-primary" onClick={() => finish('next')}>
            {isFinal ? '엔딩 보기 🎓' : '다음 스테이지 ▶'}
          </button>
        </div>
      </div>
    </div>
  );
}
