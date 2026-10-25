import { useEffect, useState } from 'react';
import { CONCEPTS } from '../content/concepts';
import { ddayAvailability } from '../content/days/day5';
import { getStage } from '../content/stages';
import { koDate } from '../sim/clock';
import { LAST_DAY, type StageId } from '../sim/types';
import { gameStore, useGame } from '../store/game';
import { availLevel } from './levels';
import './Results.css';

/** Counts up from 0 to `to` over ~0.7s, starting once the card has dropped in. */
function useCountUp(to: number, delayMs = 250): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now() + delayMs;
    const frame = (now: number) => {
      const p = Math.max(0, Math.min(1, (now - start) / 700));
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [to, delayMs]);
  return v;
}

function advice(stars: number, hintPenalty: number, revealed: number, mttd: number | null, mttr: number | null, availability: number | null, final: boolean): string {
  if (stars === 3) return final ? '완벽해요! 수강신청을 끝까지 지켜냈어요.' : '완벽해요! 이 실력이면 수강신청 날도 문제없어요.';
  if (revealed > 0) return '다음엔 "정답 보기" 전에 힌트를 한 단계씩 먼저 받아보세요.';
  if (hintPenalty > 2) return '힌트를 조금만 아끼면 별이 더 늘어나요.';
  if (mttd !== null && mttd > 30) return '경보가 뜨면 관제 화면(N)에서 바로 확인(ACK)부터 눌러보세요.';
  if (mttr !== null && mttr > 60) return '경보를 확인했으면 장비 로그와 포트 상태부터 보고 빨리 움직여보세요.';
  if (availability !== null && availability < 0.9) return '서비스가 멈춘 시간이 길었어요. 장애를 빨리 고치면 가용성이 올라가요.';
  return '좋아요! 다시 하면 별 3개도 노려볼 수 있어요.';
}

const secs = (v: number | null, none: string) => (v === null ? none : `${Math.round(v)}초`);

/** One line of the report: a number and what it means in plain words. */
function Stat({ label, value, cls = '', gloss }: { label: string; value: string; cls?: string; gloss: string }) {
  return (
    <div title={gloss}>
      <dt>{label}</dt>
      <dd className={cls}>{value}</dd>
      <p className="res-gloss">{gloss}</p>
    </div>
  );
}

/** End of a day: the daily report (일일 리포트) with the numbers ops teams actually track. */
export function Results() {
  const score = useGame((s) => s.lastScore);
  const run = useGame((s) => s.run);
  const prevBest = useGame((s) => s.lastPrevBest);
  const points = useCountUp(score?.points ?? 0);

  const isFinal = run?.stage === LAST_DAY;

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
      ...def.objectives.filter((o) => o.concept && o.id in run.objectivesDone).map((o) => o.concept),
    ]),
  ]
    .filter((c): c is string => !!c && c in CONCEPTS)
    .map((id) => CONCEPTS[id]);

  const finish = gameStore.getState().finishResults;
  const hintPoints = score.hintPenalty * 5;
  const revealPoints = score.revealed * 15;
  // D-Day: the same number as the postmortem (every second from the 10:00 open, incidents included).
  // Weekdays: the score's own average, sampled only between incidents with students online (time during an
  // incident is priced by MTTR instead), so the card says so; some days never have such a stretch.
  const dday = isFinal ? ddayAvailability(run.world) : null;
  const availability = dday ?? (run.ticks > 0 ? score.availability : null);
  const availLabel = dday !== null ? '가용성 (10:00 오픈부터)' : '장애 없을 때 가용성';
  const availGloss =
    dday !== null
      ? '10시 오픈부터 마감까지, 학생 요청이 성공한 비율 (장애 보고서와 같은 숫자)'
      : availability === null
        ? '장애가 없던 시간에 서비스가 정상이었던 비율 (오늘은 잴 구간이 없었어요)'
        : '장애가 없던 시간에 서비스가 정상이었던 비율 (장애 중 손실은 MTTR에 반영돼요)';
  const newRecord = prevBest === null || score.points > prevBest;
  const missionsDone = def.objectives.filter((o) => o.id in run.objectivesDone).length;
  const incidents = run.scenarios.filter((r) => r.activatedAt !== null).length;
  const tomorrow = isFinal ? null : getStage((run.stage + 1) as StageId);

  return (
    <div className="res-backdrop" role="dialog" aria-modal="true" aria-label={`${def.label} 일일 리포트`}>
      <div className="res-card panel">
        <p className="res-kicker">
          {def.label} · {koDate(def.date)} · {def.title}
        </p>
        <h1 className="res-title">{isFinal ? '수강신청 사수 성공!' : '오늘 일 끝! 퇴근'}</h1>
        <p className="res-sub">📋 {def.label} 일일 리포트</p>

        <div className="res-stars" aria-label={`별 ${score.stars}개`}>
          {[1, 2, 3].map((n) => (
            <span key={n} className={`res-star ${n <= score.stars ? 'on' : ''}`} style={{ animationDelay: `${0.1 + n * 0.15}s` }}>
              ★
            </span>
          ))}
        </div>

        <div className="res-points">
          <span className="res-points-value">{points}</span>
          <span className="res-points-unit">/ 100점</span>
          {newRecord ? <span className="res-best new">🏆 신기록!</span> : <span className="res-best">최고 기록 {prevBest}점</span>}
        </div>

        <dl className="res-stats">
          <Stat
            label={availLabel}
            value={availability === null ? '—' : `${(availability * 100).toFixed(1)}%`}
            cls={availability === null ? '' : availLevel(availability)}
            gloss={availGloss}
          />
          <Stat label="평균 탐지 시간 (MTTD)" value={secs(score.mttd, '장애 없음')} gloss="장애가 시작되고 경보를 확인(ACK)하기까지 걸린 시간" />
          <Stat label="평균 복구 시간 (MTTR)" value={secs(score.mttr, '장애 없음')} gloss="장애가 시작되고 다 고치기까지 걸린 시간" />
          <Stat
            label="미션"
            value={`${missionsDone}/${def.objectives.length}`}
            cls={missionsDone === def.objectives.length ? 'ok' : 'warn'}
            gloss="오늘 맡은 일을 끝낸 개수"
          />
          <Stat label="장애" value={`${incidents}건`} gloss="오늘 일어난 장애의 수" />
          <Stat label="담당팀 이관" value={`${score.escalated}건`} gloss="다른 팀에 넘겨서 처리한 장애의 수" />
          <Stat label="힌트 감점" value={hintPoints ? `−${hintPoints}점` : '없음'} cls={hintPoints ? 'warn' : 'ok'} gloss="쿠사수에게 받은 힌트만큼 빠진 점수" />
          <Stat
            label="정답 보기"
            value={`${score.revealed}회${revealPoints ? ` (−${revealPoints}점)` : ''}`}
            cls={score.revealed ? 'bad' : 'ok'}
            gloss="정답을 바로 본 횟수"
          />
        </dl>

        <p className="res-advice">💬 {advice(score.stars, score.hintPenalty, score.revealed, score.mttd, score.mttr, availability, isFinal)}</p>

        {tomorrow && (
          <p className="res-tomorrow">
            📅 내일 미리보기 · <b>{tomorrow.label}</b> {koDate(tomorrow.date)} 「{tomorrow.title}」 <span className="muted">{tomorrow.subtitle}</span>
          </p>
        )}

        <section className="res-cards">
          <h2>오늘 얻은 개념 카드</h2>
          {earned.length === 0 ? (
            <p className="muted res-none">이번엔 얻은 카드가 없어요. 장애를 고치고 미션을 끝내면 카드를 얻어요!</p>
          ) : (
            <ul>
              {earned.map((c, i) => (
                <li key={c.id} className="res-mini" style={{ animationDelay: `${0.4 + i * 0.08}s` }} title={c.definition}>
                  <strong>{c.name}</strong>
                  <span>{c.analogy}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Sticks to the bottom of the screen while the report scrolls, so the buttons are on screen at 1280×720 too. */}
        <div className="res-footer">
          <p className="res-next-hint">{isFinal ? 'Enter를 누르면 엔딩을 볼 수 있어요.' : 'Enter를 누르면 다음 날로 가요.'}</p>

          <div className="res-actions">
            <button className="btn" onClick={() => finish('select')}>
              📅 달력
            </button>
            <button className="btn" onClick={() => finish('retry')}>
              다시 하기
            </button>
            <button className="btn primary res-primary" onClick={() => finish('next')}>
              {isFinal ? '엔딩 보기 🏆' : '다음 날 출근 ▶'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
