import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getStage } from '../content/stages';
import type { Objective } from '../content/types';
import { openAlarms } from '../sim/alarms';
import type { StageRun } from '../sim/engine';
import { gameStore, useGame } from '../store/game';
import { guideOf, lockedText, objectiveStatus, waitingText } from './objectiveStatus';
import './ObjectivePanel.css';

const startsCollapsed = () => {
  try {
    return window.matchMedia('(max-width: 760px)').matches;
  } catch {
    return false;
  }
};

/** A media query, followed as the window is resized. */
function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia(query);
    } catch {
      return;
    }
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** A short screen (1280×720 and the like): the guide folds to the step to do now so the map stays in view. */
export const useTightScreen = () => useMedia('(max-height: 800px)');

/** Objectives whose "why" was ever shown (stage:id): it opens by itself only the first time. */
const WHY_SEEN_KEY = 'khu-dc-why-seen';

function whySeen(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(WHY_SEEN_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function markWhySeen(key: string): void {
  try {
    const seen = whySeen();
    if (seen.has(key)) return;
    seen.add(key);
    localStorage.setItem(WHY_SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    /* storage blocked: it just opens again next time */
  }
}

/**
 * The guide's memory for this run (the why opened or folded, the steps already ticked when an objective showed
 * up), shared by the mission panel and the terminal's side box. Kept apart from the store's windowState (a
 * window's half-done work) and forgotten when the stage starts again.
 */
const guideMem = { epoch: -1, values: new Map<string, unknown>(), version: 0, listeners: new Set<() => void>() };

function guideValue<T>(epoch: number, key: string, init: () => T): T {
  if (guideMem.epoch !== epoch) {
    guideMem.epoch = epoch;
    guideMem.values = new Map();
  }
  if (!guideMem.values.has(key)) guideMem.values.set(key, init());
  return guideMem.values.get(key) as T;
}

const subscribeGuide = (l: () => void) => {
  guideMem.listeners.add(l);
  return () => void guideMem.listeners.delete(l);
};

/** useState over guideMem: `init` runs once per key and run. */
function useGuideState<T>(key: string, init: () => T): [T, (v: T) => void] {
  const epoch = useGame((s) => s.stageEpoch);
  useSyncExternalStore(subscribeGuide, () => guideMem.version);
  const value = guideValue(epoch, key, init);
  const set = useCallback(
    (v: T) => {
      if (guideMem.epoch !== epoch) return; // a click from the run before
      guideMem.values.set(key, v);
      guideMem.version += 1;
      guideMem.listeners.forEach((l) => l());
    },
    [epoch, key],
  );
  return [value, set];
}

/**
 * Is the objective's "why" open: by itself, open the first time the objective is ever shown (on a short screen
 * only until its first step is done: from then on the steps speak); once the player opens or folds it, as they
 * left it (this run).
 */
function useWhyOpen(stage: number, id: string, hasWhy: boolean, autoFold: boolean): [boolean, (open: boolean) => void] {
  const key = `${stage}:${id}`;
  const [first] = useGuideState<boolean>(`why-first:${key}`, () => !whySeen().has(key));
  const [chosen, setChosen] = useGuideState<boolean | null>(`why:${key}`, () => null);
  useEffect(() => {
    if (hasWhy) markWhySeen(key);
  }, [key, hasWhy]);
  return [chosen ?? (first && !autoFold), setChosen];
}

/**
 * The current objective's explain-before-do: its `why` (folds), and its first-time steps, each ticked by
 * what the player really did, the one to do now with its command and one line on why. `compact` shows
 * only the step to do now (with a button for the rest).
 */
export function ObjectiveGuide({ o, run, compact, variant }: { o: Objective; run: StageRun; compact: boolean; variant: 'panel' | 'term' }) {
  const guide = guideOf(o, run);
  // Steps already ticked when the objective showed up (an `enable` from the mission before) don't count as starting it.
  const [ticksAtStart] = useGuideState<number>(`start:${run.stage}:${o.id}`, () => guide?.doneCount ?? 0);
  const [whyOpen, setWhyOpen] = useWhyOpen(run.stage, o.id, !!o.why, compact && !!guide && guide.doneCount > ticksAtStart);
  const [allSteps, setAllSteps] = useState(false);
  if (!o.why && !guide) return null;
  const folded = !!guide && compact && !allSteps && guide.rows.length > 1;
  const rows = guide ? (folded ? guide.rows.filter((r) => r.next) : guide.rows) : [];
  return (
    <div className={`og og-${variant}`}>
      {o.why && (
        <div className={`og-why${whyOpen ? ' open' : ''}`}>
          <button
            type="button"
            className="og-why-btn"
            aria-expanded={whyOpen}
            onClick={(e) => {
              e.currentTarget.blur(); // so a later Space/Enter in the game doesn't toggle it
              setWhyOpen(!whyOpen);
            }}
          >
            <span aria-hidden>💡</span> 이게 뭐고, 왜 해요? <span className="og-caret" aria-hidden>{whyOpen ? '▾' : '▸'}</span>
          </button>
          {whyOpen && <p className="og-why-text">{o.why}</p>}
        </div>
      )}
      {guide && (
        <div className="og-guide">
          <div className="og-head">
            <span>
              처음이니까 차근차근 ({guide.doneCount}/{guide.rows.length})
            </span>
            {compact && guide.rows.length > 1 && (
              <button
                type="button"
                className="og-more"
                aria-expanded={!folded}
                onClick={(e) => {
                  e.currentTarget.blur();
                  setAllSteps(!allSteps);
                }}
              >
                {folded ? '단계 모두 ▸' : '접기 ▴'}
              </button>
            )}
          </div>
          <ol className="og-steps">
            {rows.map((r, i) => (
              <li key={`${i}:${r.text}`} className={`og-step ${r.done ? 'done' : r.next ? 'next' : 'todo'}`}>
                <span className="og-mark" aria-hidden>
                  {r.done ? '✓' : r.next ? '▶' : ''}
                </span>
                <span className="og-body">
                  <span className="og-text">
                    {r.text}
                    {r.done && <span className="obj-sr"> (완료)</span>}
                    {r.next && <span className="obj-sr"> (지금 할 단계)</span>}
                  </span>
                  {r.next && r.cmd && <code className="og-cmd">{r.cmd}</code>}
                  {r.next && r.why && <small className="og-step-why">{r.why}</small>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/**
 * Left column: today's missions, and one alarm chip that opens the NOC. What is broken (and where) is
 * only ever seen in the NOC: the chip counts alarms, it never names a cause or a room.
 */
export function ObjectivePanel() {
  const run = useGame((s) => s.run);
  const screen = useGame((s) => s.screen);
  const [collapsed, setCollapsed] = useState(startsCollapsed);
  const [showDone, setShowDone] = useState(false);
  const tight = useTightScreen();

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
        <div className="obj-main">
          <span className="obj-text">
            {o.text}
            {progress && <span className="obj-progress"> ({progress})</span>}
          </span>
          {/* The one to do now explains itself before the player acts (and walks a first-timer through it). */}
          {o === nextObjective && <ObjectiveGuide o={o} run={run} compact={tight} variant="panel" />}
        </div>
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
