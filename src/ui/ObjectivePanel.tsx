import { useState } from 'react';
import { getStage } from '../content/stages';
import { activeScenarios, visibleObjectives } from '../sim/engine';
import type { RoomId } from '../sim/types';
import { gameStore, useGame } from '../store/game';
import './ObjectivePanel.css';

const ROOM_LABEL: Record<RoomId, string> = {
  server: '서버실',
  network: '네트워크실',
  power: '전원실',
  cooling: '냉각실',
  noc: '관제실',
};

function elapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 5) return '방금';
  return s < 60 ? `${s}초 전` : `${Math.floor(s / 60)}분 ${s % 60}초 전`;
}

const startsCollapsed = () => {
  try {
    return window.matchMedia('(max-width: 760px)').matches;
  } catch {
    return false;
  }
};

/** Left column: what to do now (objectives) and what is broken now (incidents). */
export function ObjectivePanel() {
  const run = useGame((s) => s.run);
  const screen = useGame((s) => s.screen);
  const [collapsed, setCollapsed] = useState(startsCollapsed);
  const [showDone, setShowDone] = useState(false);

  if (!run || screen !== 'playing') return null;

  const def = getStage(run.stage);
  const objectives = visibleObjectives(def, run);
  const incidents = activeScenarios(run);
  const now = run.ctx.stageTime;
  const isDone = (id: string) => id in run.objectivesDone;
  const nextObjective = objectives.find((o) => !isDone(o.id));
  // Count against every objective of the stage, so the total doesn't grow as later ones unlock.
  const doneCount = def.objectives.filter((o) => isDone(o.id)).length;
  const lockedCount = def.objectives.length - objectives.length;
  const doneList = objectives.filter((o) => isDone(o.id));
  const openList = objectives.filter((o) => !isDone(o.id));
  // Finished tasks fold into one row so the panel doesn't grow over the map.
  const foldDone = doneList.length > 1 && !showDone;
  // Nothing has gone wrong yet and the service isn't fully up: the player is still building it.
  const preparing = run.scenarios.every((s) => s.activatedAt === null) && run.health.availability < 0.99;

  // The highlighted objective already says what to do; the box is only for incidents and the all-done state.
  const nextStep = incidents.length
    ? '🚨 장애부터 해결하세요! 막히면 쿠사수에게 물어봐요.'
    : nextObjective
      ? null
      : '목표 완료! 다음 상황을 기다리는 중이에요…';

  const item = (o: (typeof objectives)[number]) => {
    const done = isDone(o.id);
    const progress = !done && o.progress ? o.progress(run.world, run.ctx) : '';
    return (
      <li key={o.id} className={`obj-item ${done ? 'done' : ''} ${o === nextObjective ? 'current' : ''}`}>
        <span className="obj-check" aria-hidden>
          {done ? '✔' : ''}
        </span>
        <span className="obj-text">
          {o.text}
          {progress && <span className="obj-progress"> ({progress})</span>}
        </span>
        {done && <span className="obj-sr">(완료)</span>}
      </li>
    );
  };

  return (
    <aside className={`obj-panel panel ${collapsed ? 'collapsed' : ''} ${incidents.length ? 'has-incident' : ''}`} aria-label="목표와 장애">
      <button
        className="obj-head"
        onClick={(e) => {
          e.currentTarget.blur(); // so a later Space/Enter in the game doesn't toggle the panel
          setCollapsed((c) => !c);
        }}
        aria-expanded={!collapsed}
        title={collapsed ? '목표 펼치기' : '목표 접기'}
      >
        <span className="obj-head-title">🎯 목표</span>
        <span className="obj-head-count">
          {doneCount}/{def.objectives.length}
        </span>
        {incidents.length > 0 && <span className="obj-head-alert">🚨 {incidents.length}</span>}
        <span className="obj-head-caret" aria-hidden>
          {collapsed ? '▸' : '▾'}
        </span>
      </button>

      {!collapsed && (
        <div className="obj-body">
          {nextStep && <p className="obj-next">{nextStep}</p>}

          <ul className="obj-list">
            {foldDone ? (
              <li className="obj-item done obj-fold">
                <span className="obj-check" aria-hidden>
                  ✔
                </span>
                <button
                  type="button"
                  className="obj-fold-btn"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setShowDone(true);
                  }}
                >
                  완료한 목표 {doneList.length}개 <span aria-hidden>▸</span>
                </button>
              </li>
            ) : (
              doneList.map(item)
            )}
            {doneList.length > 1 && showDone && (
              <li className="obj-item obj-fold">
                <button
                  type="button"
                  className="obj-fold-btn"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setShowDone(false);
                  }}
                >
                  완료한 목표 접기 <span aria-hidden>▴</span>
                </button>
              </li>
            )}
            {openList.map(item)}
            {lockedCount > 0 && (
              <li className="obj-item locked">
                <span className="obj-check" aria-hidden>
                  🔒
                </span>
                <span className="obj-text">이어지는 목표 {lockedCount}개 (앞 목표를 끝내면 열려요)</span>
              </li>
            )}
          </ul>

          <section className={`obj-incidents ${incidents.length > 1 ? 'compact' : ''}`} aria-label="지금 장애">
            {incidents.length === 0 ? (
              <>
                <h3 className="calm">✅ 장애 없음</h3>
                <p className="obj-calm">{preparing ? '아직 서비스 준비 중이에요. 위 목표부터 끝내봐요.' : '지금은 조용해요. 대시보드를 가끔 확인하세요.'}</p>
              </>
            ) : (
              <h3>🚨 지금 장애</h3>
            )}
            {incidents.map(({ rt, def: sc }) => {
              const hint = run.hintLevel[sc.id] ?? 0;
              return (
                <article key={sc.id} className={`obj-incident ${sc.severity}`}>
                  <div className="obj-incident-top">
                    <strong>{sc.title}</strong>
                    <span className="obj-room tag">{ROOM_LABEL[sc.room]}</span>
                  </div>
                  <p className="obj-alert" title={sc.alert}>
                    {sc.alert}
                  </p>
                  <div className="obj-incident-foot">
                    <span className="obj-elapsed">⏱ {elapsed(now - (rt.activatedAt ?? now))}</span>
                    {hint > 0 && <span className="obj-hintlv">힌트 {hint}/3</span>}
                    <button
                      className="btn obj-ask"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        gameStore.getState().openModal({ type: 'hint', scenarioId: sc.id });
                      }}
                    >
                      📻 쿠사수에게 묻기
                    </button>
                  </div>
                </article>
              );
            })}
          </section>

          {incidents.length === 0 && (
            <footer className="obj-controls">
              <span>
                <kbd>WASD</kbd>/<kbd>방향키</kbd> 이동
              </span>
              <span>
                <kbd>E</kbd> 상호작용
              </span>
              <span>
                <kbd>Tab</kbd> 대시보드
              </span>
              <span>
                <kbd>H</kbd> 쿠사수
              </span>
            </footer>
          )}
        </div>
      )}
    </aside>
  );
}
