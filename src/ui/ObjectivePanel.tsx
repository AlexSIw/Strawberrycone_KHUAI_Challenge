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

  if (!run || screen !== 'playing') return null;

  const def = getStage(run.stage);
  const objectives = visibleObjectives(def, run);
  const incidents = activeScenarios(run);
  const now = run.ctx.stageTime;
  const nextObjective = objectives.find((o) => !(o.id in run.objectivesDone));
  const doneCount = objectives.filter((o) => o.id in run.objectivesDone).length;

  const nextStep = incidents.length
    ? '🚨 장애부터 해결하세요! 막히면 쿠사수에게 물어봐요.'
    : nextObjective
      ? `다음 할 일: ${nextObjective.text}`
      : '목표 완료! 다음 상황을 기다리는 중이에요…';

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
          {doneCount}/{objectives.length}
        </span>
        {incidents.length > 0 && <span className="obj-head-alert">🚨 {incidents.length}</span>}
        <span className="obj-head-caret" aria-hidden>
          {collapsed ? '▸' : '▾'}
        </span>
      </button>

      {!collapsed && (
        <div className="obj-body">
          <p className="obj-next">{nextStep}</p>

          <ul className="obj-list">
            {objectives.map((o) => {
              const done = o.id in run.objectivesDone;
              const current = o === nextObjective;
              return (
                <li key={o.id} className={`obj-item ${done ? 'done' : ''} ${current ? 'current' : ''}`}>
                  <span className="obj-check" aria-hidden>
                    {done ? '✔' : ''}
                  </span>
                  <span className="obj-text">{o.text}</span>
                  {done && <span className="obj-sr">(완료)</span>}
                </li>
              );
            })}
          </ul>

          <section className="obj-incidents" aria-label="지금 장애">
            <h3>🚨 지금 장애</h3>
            {incidents.length === 0 ? (
              <p className="obj-calm">지금은 조용해요. 대시보드를 가끔 확인하세요.</p>
            ) : (
              incidents.map(({ rt, def: sc }) => {
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
              })
            )}
          </section>

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
        </div>
      )}
    </aside>
  );
}
