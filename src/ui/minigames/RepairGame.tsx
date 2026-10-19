// 냉각실 수리 미니게임: 전원 차단 → 막힌 필터 교체 → 재가동. 랙 온도는 실시간으로 보여준다.
import { useState } from 'react';
import { repairCrac } from '../../sim/actions';
import type { CoolingState, World } from '../../sim/types';
import { gameStore } from '../../store/game';
import { DragGhost, GameFooter, MiniGameFrame, NoteLine, TaskBar, rackName, useDragDrop, useNote, useWorld } from './common';
import './RepairGame.css';

const TARGET_NAME: Record<'crac', string> = { crac: '항온항습기(CRAC)' };

/** Node goes NotReady at this temperature… */
const HOT = 45;
/** …and comes back below this one. */
const SAFE = 35;
/** °C per second the CRAC cools a rack (see sim/step.ts) */
const COOL_RATE = 2;

type FilterItem = 'old' | 'new';

function tempLevel(t: number): 'cool' | 'warm' | 'hot' | 'danger' {
  if (t < 30) return 'cool';
  if (t < SAFE) return 'warm';
  if (t < HOT) return 'hot';
  return 'danger';
}

function Filter({ kind }: { kind: FilterItem }) {
  return (
    <span className={`rp-filter ${kind}`}>
      <span className="rp-filter-mesh" aria-hidden />
      <span className="rp-filter-label">{kind === 'old' ? '먼지 꽉!' : '새 필터'}</span>
    </span>
  );
}

function Temps({ world, cooling }: { world: World; cooling: CoolingState }) {
  const racks = Object.keys(cooling.temps).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const nodes = Object.entries(world.k8s?.nodes ?? {});
  return (
    <div className="rp-temps">
      {racks.map((rack) => {
        const t = cooling.temps[rack];
        const cooled = cooling.cracOk || !cooling.cracRacks.includes(rack);
        const trend = !cooled && t < 60 ? 'up' : cooled && t > 24 ? 'down' : 'flat';
        const pct = Math.max(0, Math.min(100, ((t - 20) / 40) * 100));
        return (
          <div key={rack} className={`rp-rack ${tempLevel(t)}`}>
            <div className="rp-thermo" aria-hidden>
              <span className="rp-mark hot" style={{ bottom: `${((HOT - 20) / 40) * 100}%` }} />
              <span className="rp-mark safe" style={{ bottom: `${((SAFE - 20) / 40) * 100}%` }} />
              <span className="rp-fill" style={{ height: `${pct}%` }} />
            </div>
            <div className="rp-rack-info">
              <div className="rp-rack-name">{rackName(rack)}</div>
              <div className="rp-temp">
                {Math.round(t)}°C <span className={`rp-trend ${trend}`}>{trend === 'up' ? '▲' : trend === 'down' ? '▼' : '–'}</span>
              </div>
              {cooling.cracRacks.includes(rack) && <span className="tag rp-crac-tag">❄ CRAC 담당</span>}
              {nodes
                .filter(([, n]) => n.rack === rack)
                .map(([id, n]) => (
                  <span key={id} className={`tag rp-node ${n.ready ? 'ready' : 'notready'}`}>
                    {id} {n.ready ? 'Ready' : 'NotReady'}
                  </span>
                ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** What happens next once the unit runs again: temperatures fall slowly, nodes come back below 35°C. */
function recoveryText(world: World, cooling: CoolingState): string {
  const nodes = Object.entries(world.k8s?.nodes ?? {});
  const tempOf = (rack: string) => cooling.temps[rack] ?? 24;
  const hottest = Math.max(24, ...cooling.cracRacks.map(tempOf));
  const down = nodes.filter(([, n]) => !n.ready);
  const heatDown = down.filter(([, n]) => tempOf(n.rack) >= SAFE).map(([id]) => id);
  const otherDown = down.filter(([, n]) => tempOf(n.rack) < SAFE).map(([id]) => id);
  const parts: string[] = [];
  if (hottest >= SAFE) {
    // A node is back on the first tick its rack is below SAFE.
    const secs = Math.floor((hottest - SAFE) / COOL_RATE) + 1;
    const head = `온도는 천천히 내려가요 (초당 약 ${COOL_RATE}°C). 약 ${secs}초 뒤 ${SAFE}°C 아래가 되면`;
    if (heatDown.length) parts.push(`${head} 꺼졌던 노드(${heatDown.join(', ')})가 다시 Ready로 돌아와요.`);
    else parts.push(`${head} 안전해요.${nodes.length ? ' 노드는 아직 모두 버티고 있어요.' : ''}`);
  } else if (nodes.length && otherDown.length === 0) {
    parts.push('온도 정상! 모든 노드 Ready ✅');
  } else {
    parts.push('온도 정상 ✅');
  }
  if (otherDown.length) parts.push(`${otherDown.join(', ')} 노드는 온도가 괜찮은데도 NotReady예요. 다른 원인을 찾아보세요.`);
  return parts.join(' ');
}

export function RepairGame({ target }: { target: 'crac' }) {
  const world = useWorld();
  const cooling = world?.cooling;
  const cracOk = cooling?.cracOk ?? true;
  const [leverDown, setLeverDown] = useState(false);
  const [oldOut, setOldOut] = useState(false);
  const [newIn, setNewIn] = useState(false);
  const [repairedHere, setRepairedHere] = useState(false);
  const [seenOk, setSeenOk] = useState(cracOk);
  const [note, showNote] = useNote();

  // The unit broke (again) while this window was open: start the task fresh.
  if (seenOk !== cracOk) {
    setSeenOk(cracOk);
    if (!cracOk) {
      setLeverDown(false);
      setOldOut(false);
      setNewIn(false);
      setRepairedHere(false);
    }
  }

  const removeOld = () => {
    if (!leverDown) return showNote('bad', '먼저 전원을 차단하세요! ⚡ 돌아가는 기계에 손 넣으면 위험해요.');
    if (oldOut) return;
    setOldOut(true);
    showNote('ok', '막힌 필터를 뺐어요. 먼지가 한가득! 🤧 이러니 바람이 안 나왔지.');
  };
  const insertNew = () => {
    if (!leverDown) return showNote('bad', '먼저 전원을 차단하세요! ⚡');
    if (!oldOut) return showNote('bad', '먼저 막힌 필터를 빼야 새 필터가 들어가요.');
    if (newIn) return;
    setNewIn(true);
    showNote('ok', '새 필터 장착! 바람길이 뚫렸어요. 이제 다시 켜 볼까요?');
  };

  const onDrop = (item: FilterItem, zone: string) => {
    if (item === 'old') {
      if (zone === 'trash') removeOld();
      else if (leverDown) showNote('info', '막힌 필터는 오른쪽 🗑 폐기함에 넣어 주세요.');
      else removeOld();
    } else {
      if (zone === 'slot') insertNew();
      else showNote('info', '새 필터는 항온항습기의 빈 필터 자리에 끼워 주세요.');
    }
  };
  const { drag, bind } = useDragDrop<FilterItem>(onDrop);

  if (!world) return null;
  const title = `냉각실 · ${TARGET_NAME[target]} 수리`;

  if (!cooling) {
    return (
      <MiniGameFrame title={title} icon="❄️" size="narrow" footer={<GameFooter done={false} />}>
        <TaskBar done>냉각 정상 — 지금은 여기서 할 일이 없어요.</TaskBar>
      </MiniGameFrame>
    );
  }

  const pullLever = () => {
    if (cracOk) return showNote('info', '항온항습기는 정상이에요. 멀쩡한 기계는 끄지 않아요 🙂');
    if (leverDown) return showNote('info', '전원은 이미 차단됐어요. 수리가 끝나면 아래 "재가동" 버튼으로 켜요.');
    setLeverDown(true);
    showNote('ok', '덜컥! 전원 차단. 이제 안전하게 열 수 있어요.');
  };

  const restart = () => {
    if (!newIn) return;
    gameStore.getState().act((w) => repairCrac(w), 'repair:crac');
    setLeverDown(false);
    setRepairedHere(true);
    showNote('ok', '위이잉~ 항온항습기 재가동! 찬 바람이 나오기 시작했어요. ❄️');
  };

  const step = cracOk ? 4 : !leverDown ? 1 : !newIn ? 2 : 3;
  const fanMode = cracOk ? 'run' : leverDown ? 'stop' : 'struggle';
  const hottest = Math.max(...cooling.cracRacks.map((r) => cooling.temps[r] ?? 24), 24);

  let task: string;
  if (cracOk && repairedHere) task = '완료! 항온항습기가 다시 돌아가요. 온도가 내려가는 걸 지켜보세요.';
  else if (cracOk) task = '항온항습기는 정상 작동 중이에요. 지금은 할 일이 없어요.';
  else if (step === 1) task = '① 오른쪽 빨간 레버를 클릭해서 항온항습기 전원을 차단하세요.';
  else if (!oldOut) task = '② 먼지로 막힌 필터를 끌어서 🗑 폐기함에 버리세요. (클릭해도 돼요)';
  else if (!newIn) task = '② 📦 새 필터를 끌어서 빈 필터 자리에 끼우세요. (클릭해도 돼요)';
  else task = '③ "재가동" 버튼을 눌러 항온항습기를 다시 켜세요.';

  const slotZone = drag?.item === 'new' && drag.over === 'slot';
  const trashZone = drag?.item === 'old' && drag.over === 'trash';

  return (
    <MiniGameFrame
      title={title}
      icon="❄️"
      size="wide"
      footer={<GameFooter done={cracOk && repairedHere}>{cracOk ? recoveryText(world, cooling) : null}</GameFooter>}
    >
      <TaskBar done={cracOk}>{task}</TaskBar>

      <div className="rp-layout">
        <section className="rp-panel">
          <h3 className="rp-h">🌡 랙 온도 (실시간)</h3>
          <Temps world={world} cooling={cooling} />
          <div className="mg-legend">
            <span>
              <i className="rp-dot danger" /> {HOT}°C 이상: 노드 꺼짐(NotReady)
            </span>
            <span>
              <i className="rp-dot cool" /> {SAFE}°C 미만: 노드 복귀
            </span>
          </div>
        </section>

        <section className="rp-panel rp-work">
          {!cracOk && (
            <ol className="rp-steps">
              <li className={step > 1 ? 'done' : step === 1 ? 'now' : ''}>전원 차단</li>
              <li className={step > 2 ? 'done' : step === 2 ? 'now' : ''}>막힌 필터 빼고 새 필터 끼우기</li>
              <li className={step === 3 ? 'now' : ''}>재가동</li>
            </ol>
          )}

          <div className="rp-bench">
            <div className={`rp-unit ${fanMode}`}>
              <div className={`rp-screen ${cracOk ? 'ok' : leverDown ? 'off' : 'bad'}`}>
                {cracOk ? '정상 작동 중 ❄' : leverDown ? '전원 차단됨' : '⚠ 필터 막힘 · 냉방 불가'}
              </div>
              <div className="rp-fan" aria-hidden>
                <span className="rp-blades" />
              </div>
              <div className={`rp-slot${slotZone ? ' over' : ''}${!cracOk && oldOut && !newIn ? ' empty' : ''}`} data-drop="slot">
                {!cracOk && !oldOut && (
                  <button type="button" className="rp-filter-btn" aria-label="막힌 필터 빼기" {...bind('old', removeOld, leverDown)}>
                    <Filter kind="old" />
                  </button>
                )}
                {!cracOk && oldOut && !newIn && <span className="rp-slot-hint">빈 필터 자리</span>}
                {(cracOk || newIn) && <Filter kind="new" />}
              </div>
              <div className="rp-unit-name">CRAC-01</div>
            </div>

            <div className="rp-side">
              <button
                type="button"
                className={`rp-lever${leverDown ? ' down' : ''}`}
                data-autofocus
                onClick={pullLever}
                aria-pressed={leverDown}
                aria-label={leverDown ? '전원 레버: 차단됨' : '전원 레버: 켜짐 (클릭해서 차단)'}
              >
                <span className="rp-lever-slot" aria-hidden>
                  <span className="rp-lever-arm" />
                </span>
                <span className="rp-lever-label">{leverDown ? 'OFF' : 'ON'}</span>
                <span className="rp-lever-cap">전원</span>
              </button>

              {!cracOk && (
                <div className="rp-crate">
                  <div className="rp-crate-title">📦 새 필터</div>
                  {!newIn ? (
                    <button type="button" className="rp-filter-btn" aria-label="새 필터 끼우기" {...bind('new', insertNew, leverDown && oldOut)}>
                      <Filter kind="new" />
                    </button>
                  ) : (
                    <span className="muted rp-crate-empty">비었어요</span>
                  )}
                </div>
              )}

              {!cracOk && (
                <div className={`rp-trash${trashZone ? ' over' : ''}`} data-drop="trash">
                  <div className="rp-crate-title">🗑 폐기함</div>
                  {oldOut ? <Filter kind="old" /> : <span className="muted rp-crate-empty">비어 있음</span>}
                </div>
              )}
            </div>
          </div>

          {!cracOk && (
            <button type="button" className="btn primary rp-restart" disabled={!newIn} onClick={restart}>
              ▶ 재가동
            </button>
          )}

          <NoteLine
            note={note}
            idle={
              cracOk
                ? hottest >= SAFE
                  ? '찬 바람이 나오는 중… 온도가 천천히 내려가요.'
                  : '바람 소리 좋다~ 항온항습기는 건강해요.'
                : `항온항습기가 멈춘 동안 ${cooling.cracRacks.map(rackName).join('·')} 온도가 계속 올라가요!`
            }
          />
        </section>
      </div>

      <DragGhost at={drag}>{drag && <Filter kind={drag.item} />}</DragGhost>
    </MiniGameFrame>
  );
}
