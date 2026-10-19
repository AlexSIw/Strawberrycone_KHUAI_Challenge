import { useEffect, useState, type MouseEvent } from 'react';
import { getStage } from '../content/stages';
import { activeScenarios } from '../sim/engine';
import { gameStore, useGame } from '../store/game';
import { ModalFrame } from './ModalFrame';
import './Hud.css';

/** Seconds → "mm:ss". */
function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

type Tone = 'good' | 'warn' | 'bad';

const availTone = (pct: number): Tone => (pct >= 99 ? 'good' : pct >= 80 ? 'warn' : 'bad');
const latencyTone = (ms: number): Tone => (ms < 300 ? 'good' : ms < 1000 ? 'warn' : 'bad');

function Kpi({ label, value, unit, tone, title }: { label: string; value: string; unit: string; tone: Tone | 'plain'; title: string }) {
  return (
    <div className={`hud-kpi hud-${tone}`} title={title}>
      <span className="hud-kpi-label">{label}</span>
      <span className="hud-kpi-value">
        {value}
        <small>{unit}</small>
      </span>
    </div>
  );
}

/** Top bar while playing: stage, clock, health KPIs and the main buttons. */
export function Hud() {
  const run = useGame((s) => s.run);
  const screen = useGame((s) => s.screen);
  const modal = useGame((s) => s.modal?.type);
  const busy = useGame((s) => s.screen !== 'playing' || !!s.dialogue);
  const [confirmExit, setConfirmExit] = useState(false);

  // The stage ended (outro / results / next stage) while the exit question was open: drop it.
  useEffect(() => {
    if (busy) setConfirmExit(false);
  }, [busy]);

  // While the exit question is open, keys must not reach the hotkeys (Tab/H/C) or move the lion.
  // keyup still passes so a held arrow key is released in the game.
  useEffect(() => {
    if (!confirmExit) return;
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        setConfirmExit(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [confirmExit]);

  if (!run || (screen !== 'playing' && screen !== 'results')) return null;

  const def = getStage(run.stage);
  const t = run.ctx.stageTime;
  const h = run.health;
  const avail = h.availability * 100;
  const idle = h.rps <= 0;
  const remaining = def.survive ? Math.max(0, def.survive - t) : null;
  const store = gameStore.getState();
  const incidentsLeft = remaining === 0 ? activeScenarios(run).length : 0;

  /** Run a HUD action and drop focus, so a later Enter/Space doesn't press this button again. */
  const press = (fn: () => void) => (e: MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    fn();
  };
  const toggleDashboard = () => (modal === 'dashboard' ? store.closeModal() : store.openModal({ type: 'dashboard' }));

  return (
    <>
      <header className="hud" aria-label="게임 상태">
        <div className="hud-stage">
          <span className="hud-stage-no">
            <span className="hud-stage-word">Stage </span>
            {run.stage}
          </span>
          <span className="hud-stage-title">{def.title}</span>
        </div>

        <div className="hud-time" title="이번 스테이지에서 흐른 시간">
          <span aria-hidden>⏱</span> {clock(t)}
        </div>

        {remaining !== null && def.survive && (
          <div
            className={`hud-survive ${remaining === 0 ? (incidentsLeft ? 'fixleft' : 'done') : remaining <= 30 ? 'soon' : ''}`}
            title="이 시간 동안 수강신청 서비스를 지켜내세요. 시간이 끝나도 남은 장애는 모두 고쳐야 해요."
          >
            <span className="hud-survive-label">
              {remaining > 0 ? '버티기 남은 시간' : incidentsLeft ? `시간 통과! 남은 장애 ${incidentsLeft}개` : '버티기 성공!'}
            </span>
            <span className="hud-survive-time">{clock(remaining)}</span>
            <span className="hud-survive-bar" aria-hidden>
              <i style={{ width: `${(1 - remaining / def.survive) * 100}%` }} />
            </span>
          </div>
        )}

        <div className="hud-kpis">
          <Kpi
            label="가용성"
            value={idle ? '대기' : avail >= 99.95 ? '100' : avail.toFixed(1)}
            unit={idle ? '' : '%'}
            tone={idle ? 'plain' : availTone(avail)}
            title={idle ? '아직 학생 접속이 없어요. 서비스를 준비하는 중이에요.' : '가용성(Availability): 학생 요청 중 성공한 비율이에요. 99% 이상이면 정상!'}
          />
          <Kpi
            label="접속"
            value={Math.round(h.rps).toLocaleString('ko-KR')}
            unit="rps"
            tone="plain"
            title="초당 요청 수(requests per second): 지금 몰려온 학생 수예요."
          />
          <Kpi
            label="응답"
            value={Math.round(h.latencyMs).toLocaleString('ko-KR')}
            unit="ms"
            tone={latencyTone(h.latencyMs)}
            title="응답 시간(Latency): 버튼을 누르고 결과가 오기까지 걸린 시간이에요. 짧을수록 좋아요."
          />
        </div>

        <nav className="hud-buttons" aria-label="메뉴">
          <button className={`btn hud-btn ${modal === 'dashboard' ? 'on' : ''}`} onClick={press(toggleDashboard)} title="관제 대시보드 열기 (Tab)">
            <span aria-hidden>📊</span>
            <span className="hud-btn-label">대시보드</span>
            <kbd>Tab</kbd>
          </button>
          <button className="btn hud-btn" onClick={press(() => store.openModal({ type: 'hint' }))} title="쿠사수에게 힌트 받기 (H)">
            <span aria-hidden>📻</span>
            <span className="hud-btn-label">쿠사수</span>
            <kbd>H</kbd>
          </button>
          <button className="btn hud-btn" onClick={press(() => store.openModal({ type: 'concepts' }))} title="모은 개념 카드 보기 (C)">
            <span aria-hidden>📖</span>
            <span className="hud-btn-label">도감</span>
            <kbd>C</kbd>
          </button>
          <button className="btn hud-btn hud-exit" onClick={press(() => setConfirmExit(true))} title="스테이지 선택 화면으로 나가기">
            <span aria-hidden>🚪</span>
            <span className="hud-btn-label">나가기</span>
          </button>
        </nav>
      </header>

      {confirmExit && (
        <ModalFrame
          title="스테이지에서 나갈까요?"
          icon="🚪"
          size="narrow"
          onClose={() => setConfirmExit(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmExit(false)} autoFocus>
                계속하기
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  setConfirmExit(false);
                  store.goSelect();
                }}
              >
                나가기
              </button>
            </>
          }
        >
          <p className="hud-confirm-text">이번 스테이지 진행은 저장되지 않아요. 이미 받은 별과 개념 카드는 그대로 남아요.</p>
        </ModalFrame>
      )}
    </>
  );
}
