import { useState } from 'react';
import { getStage } from '../content/stages';
import { openAlarms } from '../sim/alarms';
import { gameStore, useGame } from '../store/game';
import { lockedText, objectiveStatus, waitingText } from './objectiveStatus';
import './ObjectivePanel.css';

const startsCollapsed = () => {
  try {
    return window.matchMedia('(max-width: 760px)').matches;
  } catch {
    return false;
  }
};

/**
 * Left column: today's missions, and one alarm chip that opens the NOC. What is broken (and where) is
 * only ever seen in the NOC: the chip counts alarms, it never names a cause or a room.
 */
export function ObjectivePanel() {
  const run = useGame((s) => s.run);
  const screen = useGame((s) => s.screen);
  const [collapsed, setCollapsed] = useState(startsCollapsed);
  const [showDone, setShowDone] = useState(false);

  if (!run || screen !== 'playing') return null;

  const def = getStage(run.stage);
  const st = objectiveStatus(def, run);
  const alarms = openAlarms(run.alarms);
  const critical = alarms.filter((a) => a.sev === 'critical').length;
  const unacked = alarms.some((a) => a.ackAt === null);
  const isDone = (id: string) => id in run.objectivesDone;
  const nextObjective = st.next;
  const doneList = st.done;
  const openList = st.open;
  const locked = lockedText(st);
  // Finished tasks fold into one row so the panel doesn't grow over the map.
  const foldDone = doneList.length > 1 && !showDone;
  // The highlighted objective already says what to do; the box is only for the waiting states (which say
  // what unlocks next, never "목표 완료!" while objectives are still locked). Incidents speak through alarms.
  const nextStep = alarms.length ? null : waitingText({ ...st, incident: false });

  const item = (o: (typeof st.visible)[number]) => {
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
    <aside className={`obj-panel panel ${collapsed ? 'collapsed' : ''} ${alarms.length ? 'has-incident' : ''}`} aria-label="오늘의 미션">
      <button
        className="obj-head"
        onClick={(e) => {
          e.currentTarget.blur(); // so a later Space/Enter in the game doesn't toggle the panel
          setCollapsed((c) => !c);
        }}
        aria-expanded={!collapsed}
        title={collapsed ? '목표 펼치기' : '목표 접기'}
      >
        <span className="obj-head-title">🎯 오늘의 미션</span>
        <span className="obj-head-count">
          {st.doneCount}/{st.total}
        </span>
        {alarms.length > 0 && <span className="obj-head-alert">🔔 {alarms.length}</span>}
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
            {locked && (
              <li className="obj-item locked">
                <span className="obj-check" aria-hidden>
                  🔒
                </span>
                <span className="obj-text">{locked}</span>
              </li>
            )}
          </ul>

          <button
            type="button"
            className={`obj-alarm ${critical ? 'critical' : alarms.length ? 'warn' : 'calm'}${unacked ? ' unacked' : ''}`}
            onClick={(e) => {
              e.currentTarget.blur();
              gameStore.getState().openModal({ type: 'noc', tab: 'nms' });
            }}
            title="관제 화면(NOC)에서 경보를 확인해요"
          >
            <span className="obj-alarm-count">
              {alarms.length ? (
                <>
                  🔔 경보 {alarms.length}
                  {critical > 0 && <b> · Critical {critical}</b>}
                </>
              ) : (
                '🔕 경보 없음'
              )}
            </span>
            <span className="obj-alarm-go">
              {' '}— <kbd>N</kbd>키로 관제 화면
            </span>
          </button>

          <footer className="obj-controls">
            <span>
              <kbd>WASD</kbd>/<kbd>방향키</kbd> 이동
            </span>
            <span>
              <kbd>E</kbd> 상호작용
            </span>
            <span>
              <kbd>N</kbd> 관제 화면
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
