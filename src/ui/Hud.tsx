import { useEffect, useState, type MouseEvent } from 'react';
import { getStage } from '../content/stages';
import { fmtClock, gameSec, koDate, parseHms } from '../sim/clock';
import { activeScenarios, visibleObjectives } from '../sim/engine';
import { LAST_DAY } from '../sim/types';
import { cardsWaitForIncident, gameStore, missionPreview, useGame } from '../store/game';
import { availLevel, latencyLevel, type Level } from './levels';
import { ModalFrame } from './ModalFrame';
import { SoundToggle } from './SoundToggle';
import './Hud.css';

/** Weekday game time past this means overtime (야근). */
const OVERTIME = parseHms('18:00:00');

type Tone = 'good' | 'warn' | 'bad';

const TONE: Record<Level, Tone> = { ok: 'good', warn: 'warn', bad: 'bad' };

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
  const speed = useGame((s) => s.moveSpeed);
  const busy = useGame((s) => s.screen !== 'playing' || !!s.dialogue);
  // Today's work is done: the exit button becomes 퇴근하기 (the outro also starts once every window is closed).
  const dayDone = useGame((s) => s.dayDone && s.screen === 'playing' && !s.dialogue);
  const [confirmExit, setConfirmExit] = useState(false);
  const held = useGame((s) => s.heldConcepts.length);
  const previewed = useGame((s) => s.previewed);

  // The stage ended (outro / results / next stage) while the exit question was open: drop it.
  useEffect(() => {
    if (busy) setConfirmExit(false);
  }, [busy]);

  // The game clock stops while the exit question is open.
  useEffect(() => {
    gameStore.getState().setPaused(confirmExit);
    return () => gameStore.getState().setPaused(false);
  }, [confirmExit]);

  // While the exit question is open, keys must not reach the hotkeys (N/Tab/H/C) or move the lion.
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
  const incidentNow = activeScenarios(run).length > 0;
  // Still setting up: nothing has gone wrong yet and the service isn't fully up (stage 1 racks, stage 2 DHCP, …).
  const preparing = run.scenarios.every((s) => s.activatedAt === null) && h.availability < 0.99;
  // No availability number while there is nothing to measure — unless an incident is on (e.g. stage 1's blackout).
  const idle = (h.rps <= 0 || preparing) && !incidentNow;
  // No traffic, or nothing answers: a response time would only look like a (good) number.
  const noResponse = h.rps <= 0 || h.availability < 0.05 || !Number.isFinite(h.latencyMs) || h.latencyMs <= 0;
  const availTone = TONE[availLevel(h.availability)];
  // Green only while students are actually being served; a fast error is not a healthy response.
  const latencyTone: Tone | 'plain' = availTone === 'bad' && latencyLevel(h.latencyMs) === 'ok' ? 'plain' : TONE[latencyLevel(h.latencyMs)];
  const store = gameStore.getState();
  const dday = run.stage === LAST_DAY;
  const now = gameSec(def.clock, t);
  const overtime = !dday && now >= OVERTIME;
  // What waits for the open window to close (cards, new missions' briefings) or for the incident to end.
  // The terminal says it in its own side box.
  const briefs = modal
    ? visibleObjectives(def, run).filter((o) => !previewed.includes(o.id) && !(o.id in run.objectivesDone) && !!missionPreview(run, o)).length
    : 0;
  const waiting = [held ? `카드 ${held}장` : '', briefs ? `새 미션 브리핑 ${briefs}개` : ''].filter(Boolean).join(' · ');
  const incidentHold = cardsWaitForIncident(run);
  const heldNote =
    screen !== 'playing' || busy || modal === 'terminal' || !waiting
      ? null
      : modal
        ? `📬 ${waiting} 대기 중 · ${incidentHold && held ? '장애를 해결하고 ' : ''}이 창을 닫으면 펼쳐져요`
        : incidentHold
          ? `🃏 ${waiting} 대기 중 · 장애를 해결하면 펼쳐져요`
          : null;

  /** Run a HUD action and drop focus, so a later Enter/Space doesn't press this button again. */
  const press = (fn: () => void) => (e: MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    fn();
  };
  /** Opens the window (on top of an open one: closing it goes back there), or closes it when it is the open one. */
  const toggle = (type: 'noc' | 'hint' | 'concepts') => () => (modal === type ? store.closeModal() : store.openModal({ type }));

  return (
    <>
      <header className="hud" aria-label="게임 상태">
        <div className="hud-stage">
          <span className={`hud-stage-no${dday ? ' dday' : ''}`}>{def.label}</span>
          <span className="hud-stage-title">{def.title}</span>
        </div>

        <div className="hud-time" title={dday ? '수강신청 당일의 시각이에요. 10:00에 신청이 열려요.' : '게임 속 날짜와 시각이에요.'}>
          {!dday && <span className="hud-date">{koDate(def.date)} · </span>}
          {fmtClock(now, dday)}
          {overtime && <span className="hud-overtime">야근 중</span>}
        </div>

        <div className="hud-kpis">
          <Kpi
            label="가용성"
            value={idle ? (preparing ? '준비 중' : '대기') : avail >= 99.95 ? '100' : avail.toFixed(1)}
            unit={idle ? '' : '%'}
            tone={idle ? 'plain' : availTone}
            title={
              idle
                ? preparing
                  ? '서비스를 준비하는 중이에요. 목표를 끝내면 학생들이 접속할 수 있어요.'
                  : '아직 학생 접속이 없어요. 서비스를 준비하는 중이에요.'
                : '가용성(Availability): 학생 요청 중 성공한 비율이에요. 99% 이상이면 정상!'
            }
          />
          <Kpi
            label="접속"
            value={Math.round(h.rps).toLocaleString('ko-KR')}
            unit="rps"
            tone="plain"
            title="초당 요청 수(requests per second): 1초에 들어오는 학생 요청 수예요. 매크로·봇 요청은 세지 않아요."
          />
          <Kpi
            label="응답"
            value={noResponse ? '—' : Math.round(h.latencyMs).toLocaleString('ko-KR')}
            unit={noResponse ? '' : 'ms'}
            tone={noResponse ? (idle || h.rps <= 0 ? 'plain' : 'bad') : latencyTone}
            title={
              noResponse
                ? h.rps <= 0
                  ? '아직 학생 요청이 없어서 잴 응답이 없어요.'
                  : '응답이 오지 않아요. 학생 요청이 성공하지 못하고 있어요.'
                : '응답 시간(Latency): 버튼을 누르고 결과가 오기까지 걸린 시간이에요. 짧을수록 좋아요.'
            }
          />
        </div>

        <nav className="hud-buttons" aria-label="메뉴">
          <button
            className={`btn hud-btn ${modal === 'noc' ? 'on' : ''}`}
            onClick={press(toggle('noc'))}
            title="관제 화면(NOC) 열기 (N 또는 Tab)"
            aria-pressed={modal === 'noc'}
          >
            <span aria-hidden>🖥️</span>
            <span className="hud-btn-label">관제</span>
            <kbd>N</kbd>
          </button>
          <button
            className={`btn hud-btn ${modal === 'hint' ? 'on' : ''}`}
            onClick={press(toggle('hint'))}
            title="쿠사수에게 힌트 받기 (H)"
            aria-pressed={modal === 'hint'}
          >
            <span aria-hidden>📻</span>
            <span className="hud-btn-label">쿠사수</span>
            <kbd>H</kbd>
          </button>
          <button
            className={`btn hud-btn ${modal === 'concepts' ? 'on' : ''}`}
            onClick={press(toggle('concepts'))}
            title="모은 개념 카드 보기 (C)"
            aria-pressed={modal === 'concepts'}
          >
            <span aria-hidden>📖</span>
            <span className="hud-btn-label">도감</span>
            <kbd>C</kbd>
          </button>
          <SoundToggle className="hud-btn hud-sound">
            <kbd>M</kbd>
          </SoundToggle>
          <button className="btn hud-btn hud-speed" onClick={press(() => store.cycleMoveSpeed())} title="이동 속도" aria-label={`이동 속도 ${speed}x`}>
            <span aria-hidden>🏃</span>
            <span className="hud-speed-value">{speed}x</span>
          </button>
          {dayDone ? (
            <button className="btn primary hud-btn hud-leave" onClick={press(() => store.leaveWork())} title="오늘 일을 마치고 일일 리포트 보기">
              <span aria-hidden>🏠</span>
              <span className="hud-btn-label">퇴근하기 ▶</span>
            </button>
          ) : (
            <button className="btn hud-btn hud-exit" onClick={press(() => setConfirmExit(true))} title="처음 화면으로 나가기">
              <span aria-hidden>🚪</span>
              <span className="hud-btn-label">나가기</span>
            </button>
          )}
        </nav>
      </header>

      {heldNote && (
        <p className="hud-held" role="status">
          {heldNote}
        </p>
      )}

      {confirmExit && (
        <ModalFrame
          title="오늘 일을 그만두고 나갈까요?"
          size="narrow"
          className="modal-over"
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
                  store.goTitle();
                }}
              >
                나가기
              </button>
            </>
          }
        >
          <p className="hud-confirm-text">오늘 진행은 저장되지 않아요. 이미 받은 별과 개념 카드는 그대로 남아요.</p>
        </ModalFrame>
      )}
    </>
  );
}
