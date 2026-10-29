// 케이블 미니게임 (Among Us 전선 느낌): 서버 포트를 끌어서 오늘의 스위치(TOR) 포트에 꽂고, 고장 난 선은 테스트·교체한다.
// 점검(repair) 모드에서는 그 스위치에 꽂힌 다른 케이블(코어로 가는 업링크 등)도 같이 보여준다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { cableBoard, portLed, stpBlocked, type LedState as PortLed } from '../../game/worldView';
import { connectCable, replaceCable } from '../../sim/actions';
import { cableAt, linkUp, operState, powered } from '../../sim/network';
import type { Cable, Device, World } from '../../sim/types';
import { getStage } from '../../content/stages';
import { visibleObjectives, type StageRun } from '../../sim/engine';
import { gameStore, useGame } from '../../store/game';
import { guideOf, type GuideRow } from '../objectiveStatus';
import { useStageState } from '../useStageState';
import { GameFooter, Led, MiniGameFrame, NoteLine, TaskBar, rackName, useDay, useDragDrop, useNote, useTimers, useWorld, type LedState } from './common';
import './CableGame.css';

/** A node comes back to Ready once its rack is cooler than this (see sim/k8s.ts updateNodes). */
const NODE_SAFE_TEMP = 35;

type Pt = { x: number; y: number };
/**
 * degraded = link up but frames arrive with errors (bad crimp, damaged jacket);
 * shut = a spare port switched off in the configuration (nothing wrong with the cable).
 */
type WireState = 'up' | 'degraded' | 'down' | 'nopower' | 'shut';

interface TestResult {
  kind: 'ok' | 'bad' | 'warn';
  text: string;
  /** World state the result was measured on; a stale result is hidden */
  sig: string;
}

const live = (): World | undefined => gameStore.getState().run?.world;
const devOf = (endpoint: string) => endpoint.split(':')[0];
const portOf = (endpoint: string) => endpoint.split(':')[1] ?? '';
const endpointOf = (d: Device) => `${d.id}:${d.ports[0] ?? 'eth0'}`;
const otherEnd = (c: Cable, endpoint: string) => (c.a === endpoint ? c.b : c.a);
const labelOf = (w: World, id: string) => w.devices[id]?.label ?? id;
/** What sits at the far end of a switch port: a server by its name, network gear by name and port ('CORE-01 Te1/0/3'). */
const farName = (w: World, ep: string) => (w.devices[devOf(ep)]?.nd ? `${labelOf(w, devOf(ep))} ${portOf(ep)}` : labelOf(w, devOf(ep)));

/** Either end of the cable sits in a port the configuration keeps switched off (a spare link). */
const shutEnd = (w: World, c: Cable) => [c.a, c.b].some((ep) => operState(w, devOf(ep), portOf(ep)) === 'admin-down');
/** Either end was blocked by the switch itself (err-disabled, e.g. bpduguard saw a loop or a stray switch). */
const guardEnd = (w: World, c: Cable) => [c.a, c.b].some((ep) => operState(w, devOf(ep), portOf(ep)) === 'err-disabled');
/** A cable between two switches (a loop someone plugged in): the switch blocking it is the protection working. */
const switchToSwitch = (w: World, c: Cable) => !!w.devices[devOf(c.a)]?.nd && !!w.devices[devOf(c.b)]?.nd;

function sigOf(w: World, c: Cable): string {
  return `${c.broken}|${!!c.degraded}|${powered(w, devOf(c.a))}|${powered(w, devOf(c.b))}|${shutEnd(w, c)}|${guardEnd(w, c)}`;
}

function wireState(w: World, c: Cable): WireState {
  if (linkUp(w, devOf(c.a), portOf(c.a))) return c.degraded ? 'degraded' : 'up';
  if (!powered(w, devOf(c.a)) || !powered(w, devOf(c.b))) return 'nopower';
  if (c.broken) return 'down';
  // Kept off on purpose: a spare switched off in the config, or a switch-to-switch loop cable the switch blocked.
  return shutEnd(w, c) || (guardEnd(w, c) && switchToSwitch(w, c)) ? 'shut' : 'down';
}

/** The NMS / map port-LED rules, drawn with the mini-game LEDs. */
const LED_OF: Record<PortLed, LedState> = { green: 'blink', crc: 'crc', amber: 'warn', red: 'bad', off: 'off' };
const LED_TEXT: Record<PortLed, string> = {
  green: 'LED 깜빡임(정상)',
  crc: 'LED 초록·주황 번갈아 깜빡임 (에러 섞임)',
  amber: 'LED 주황 (꺼 두었거나 막아 둔 예비 포트)',
  red: 'LED 빨강',
  off: 'LED 꺼짐',
};

/** What the handheld cable tester says. It checks the cable itself, then the devices at both ends. */
function testOf(w: World, c: Cable): TestResult {
  const sig = sigOf(w, c);
  if (c.broken) return { kind: 'bad', text: '신호 없음 · 케이블 내부 단선 의심', sig };
  if (c.degraded) return { kind: 'warn', text: '신호는 가는데 에러가 섞여요 · 케이블 손상 의심', sig };
  const off = [devOf(c.a), devOf(c.b)].filter((id) => !powered(w, id));
  if (off.length) {
    return { kind: 'warn', text: `한쪽 장비 전원 꺼짐 (${off.map((id) => labelOf(w, id)).join(', ')}) · 케이블은 정상`, sig };
  }
  if (shutEnd(w, c)) return { kind: 'ok', text: '케이블 정상 · 포트를 설정으로 꺼 둔 예비 연결이에요', sig };
  if (guardEnd(w, c)) {
    return switchToSwitch(w, c)
      ? { kind: 'ok', text: '케이블 정상 · 스위치끼리 고리(루프)를 만드는 선이라 스위치가 포트를 막아 뒀어요 (err-disabled)', sig }
      : { kind: 'warn', text: '케이블 정상 · 그런데 스위치가 이 포트를 스스로 막았어요 (err-disabled). 케이블 말고 스위치 쪽을 확인하세요', sig };
  }
  return { kind: 'ok', text: '신호 정상', sig };
}

function curve(a: Pt, b: Pt): string {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

function Wire({ a, b, cls }: { a: Pt; b: Pt; cls: string }) {
  const d = curve(a, b);
  return (
    <g className={`cb-wire ${cls}`}>
      <path d={d} className="cb-wire-outline" />
      <path d={d} className="cb-wire-core" />
      <path d={d} className="cb-wire-shine" />
      <rect x={a.x - 9} y={a.y - 7} width={14} height={14} rx={2} className="cb-plug" />
      <rect x={b.x - 5} y={b.y - 7} width={14} height={14} rx={2} className="cb-plug" />
    </g>
  );
}

/** Keeps the centre of every jack hole ([data-jack]), relative to the board, so SVG wires can join them. */
function useJackPositions(board: RefObject<HTMLDivElement | null>): Record<string, Pt> {
  const [pts, setPts] = useState<Record<string, Pt>>({});
  const measure = useCallback(() => {
    const el = board.current;
    if (!el) return;
    const base = el.getBoundingClientRect();
    const next: Record<string, Pt> = {};
    el.querySelectorAll<HTMLElement>('[data-jack]').forEach((j) => {
      const r = j.getBoundingClientRect();
      next[j.dataset.jack!] = { x: Math.round(r.left + r.width / 2 - base.left), y: Math.round(r.top + r.height / 2 - base.top) };
    });
    setPts((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [board]);
  // Rows can grow (tester results), so re-measure after every render; it's only a handful of elements.
  useLayoutEffect(() => measure());
  useEffect(() => {
    const el = board.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [board, measure]);
  return pts;
}

/**
 * The wiring plan of the cable mission being done (its first-time guide without the "open this window" step):
 * the mission panel is under this window, so the plan is shown here too. Null when there is none.
 */
function wiringPlan(run: StageRun | null): GuideRow[] | null {
  if (!run) return null;
  const o = visibleObjectives(getStage(run.stage), run).find((x) => x.spot === 'switch' && !(x.id in run.objectivesDone));
  const rows = guideOf(o, run)?.rows.filter((r) => !/앞에서 E:/.test(r.text));
  return rows?.length ? rows : null;
}

/** "WEB-01 → TOR-01 1번 포트 (Gi1/0/1)" → ['WEB-01', 'Gi1/0/1']: which port the plan gives a server. */
const planPort = (r: GuideRow): [string, string] | null => {
  const m = /^(\S+)\s*→.*\(([A-Za-z]+[\d/]+)\)/.exec(r.text);
  return m ? [m[1], m[2]] : null;
};

/** Network gear past the switch's uplinks: a core is the way up (업링크); another rack switch is a side link. */
const isCore = (id: string) => /^CORE-/i.test(id);

export function CableGame({ mode }: { mode: 'build' | 'repair' }) {
  const world = useWorld();
  const run = useGame((s) => s.run);
  const plan = mode === 'build' ? wiringPlan(run) : null;
  const day = useDay();
  const board = day && world ? cableBoard(day, world, mode) : null;
  const SWITCH = board?.sw ?? 'TOR-01';
  const boardRef = useRef<HTMLDivElement>(null);
  const pts = useJackPositions(boardRef);
  const [selected, setSelected] = useState<string | null>(null);
  // Tester readings and "replaced a cable here" are kept for the stage (a stale reading hides itself).
  const [tests, setTests] = useStageState<Record<string, TestResult>>(`cable:${mode}:tests`, {});
  const [replacedHere, setReplacedHere] = useStageState(`cable:${mode}:replaced`, false);
  /** Tests still measuring; their timers end with the window, so these are not kept */
  const [running, setRunning] = useState<Record<string, true>>({});
  const [replacing, setReplacing] = useState<Record<string, true>>({});
  const [note, showNote] = useNote();
  const later = useTimers();
  /** Cables whose replacement animation is still running; finished right away if the window closes first. */
  const pendingRef = useRef(new Set<string>());

  useEffect(() => {
    const pending = pendingRef.current;
    const epoch = gameStore.getState().stageEpoch;
    return () => {
      const ids = [...pending];
      pending.clear();
      // Not when the stage started over meanwhile: that cable belongs to the old run.
      if (!ids.length || gameStore.getState().stageEpoch !== epoch) return;
      gameStore.getState().act((w) => ids.forEach((id) => replaceCable(w, id)), 'cable:replace');
      // As if the animation had finished: the old reading is gone and the window says it was fixed here.
      setTests((t) => Object.fromEntries(Object.entries(t).filter(([id]) => !ids.includes(id))));
      setReplacedHere(true);
    };
    // The setters keep their identity while the window is open (its mode, and so its keys, never change).
  }, []);

  const tryConnect = (from: string, to: string) => {
    const w = live();
    if (!w || mode !== 'build' || !to.startsWith(`${SWITCH}:`)) return;
    if (cableAt(w, from)) return;
    if (cableAt(w, to)) {
      showNote('bad', `${portOf(to)} 포트는 이미 사용 중이에요. 빈 포트에 꽂아 주세요.`);
      return;
    }
    gameStore.getState().act((ww) => {
      connectCable(ww, from, to);
    }, 'cable:connect');
    setSelected(null);
    const after = live();
    const lit = after ? linkUp(after, devOf(from), portOf(from)) : false;
    showNote(
      'ok',
      `딸깍! ${labelOf(w, devOf(from))} ↔ ${labelOf(w, SWITCH)} ${portOf(to)} 연결` + (lit ? ' · LED 초록불' : ' · LED는 아직 꺼져 있어요 (전원 확인)'),
    );
  };

  const { drag, bind } = useDragDrop<string>(tryConnect);

  if (!world || !day || !board) return null;
  const { ports, servers, others } = board;
  const blocked = stpBlocked(world);
  const installed = servers.filter((d) => d.installed);
  const notMounted = servers.length - installed.length;
  const holding = drag?.item ?? selected;
  // The port the plan gives the server in hand (lit up as the place to plug it).
  const heldLabel = holding ? world.devices[devOf(holding)]?.label : undefined;
  const plannedPort = heldLabel ? plan?.map(planPort).find((x) => x?.[0] === heldLabel)?.[1] : undefined;

  const runTest = (c: Cable) => {
    setRunning((r) => ({ ...r, [c.id]: true }));
    gameStore.getState().event('cable:test');
    later(() => {
      const w = live();
      const cur = w?.cables[c.id];
      setRunning((r) => {
        const next = { ...r };
        delete next[c.id];
        return next;
      });
      if (w && cur) setTests((t) => ({ ...t, [c.id]: testOf(w, cur) }));
    }, 700);
  };

  const runReplace = (c: Cable, label: string) => {
    setReplacing((r) => ({ ...r, [c.id]: true }));
    pendingRef.current.add(c.id);
    later(() => {
      pendingRef.current.delete(c.id);
      gameStore.getState().act((w) => replaceCable(w, c.id), 'cable:replace');
      setReplacing((r) => {
        const next = { ...r };
        delete next[c.id];
        return next;
      });
      setTests((t) => {
        const next = { ...t };
        delete next[c.id];
        return next;
      });
      setReplacedHere(true);
      showNote('ok', `${label} 케이블을 새 것으로 바꿨어요. LED를 확인해 보세요.`);
    }, 900);
  };

  const tapJack = (d: Device) => {
    const ep = endpointOf(d);
    if (cableAt(world, ep)) {
      showNote('info', `${d.label}: 이미 연결된 포트예요. 이상하면 '테스트'해 보세요.`);
      return;
    }
    if (mode !== 'build') {
      showNote('info', '여기서는 새 케이블을 꽂지 않아요. 기존 케이블을 점검하세요.');
      return;
    }
    setSelected((cur) => (cur === ep ? null : ep));
  };

  const tapPort = (p: string) => {
    const ep = `${SWITCH}:${p}`;
    const c = cableAt(world, ep);
    if (selected && mode === 'build') return tryConnect(selected, ep);
    if (c) showNote('info', `${p}: ${farName(world, otherEnd(c, ep))} 연결됨 · ${LED_TEXT[portLed(world, SWITCH, p, blocked)]}`);
    else showNote('info', mode === 'build' ? '빈 포트예요. 먼저 왼쪽 서버의 포트를 고르세요.' : '빈 포트예요.');
  };

  // ----- status -----
  const states = installed.map((d) => {
    const c = cableAt(world, endpointOf(d));
    return { ep: endpointOf(d), c, state: c ? wireState(world, c) : null };
  });
  // Repairing: the switch's other cables (uplinks …) count too; a spare kept switched off is fine.
  const otherStates = others.map((o) => ({ ep: `${o.dev}:${o.port}`, c: o.cable, state: wireState(world, o.cable) }));
  const every = [...states, ...otherStates];
  const allConnected = installed.length > 0 && states.every((s) => s.c);
  const allLinked = allConnected && states.every((s) => s.state === 'up') && otherStates.every((s) => s.state === 'up' || s.state === 'shut');
  const anyDown = every.some((s) => s.state === 'down');
  const anyDegraded = every.some((s) => s.state === 'degraded');
  const anyNoPower = every.some((s) => s.state === 'nopower');
  // Build: every server (also the ones still in boxes) needs a cable with a clean signal. Repair: every link must be green.
  const done = mode === 'build' ? notMounted === 0 && allConnected && !anyDown && !anyDegraded : allLinked;

  let task: string;
  if (installed.length === 0) task = '먼저 서버실 랙에 서버를 장착하세요. 그다음 여기서 케이블을 꽂아요.';
  else if (mode === 'build' && !allConnected)
    task = holding ? '이제 오른쪽 스위치의 빈 포트를 클릭하거나, 끌어다 놓으세요.' : '왼쪽 서버의 포트(eth0)를 끌어서 오른쪽 스위치의 빈 포트에 꽂으세요.';
  // Repairing, an orange (error-ridden) link is the one to look at first: a dark one may be a port the switch keeps off.
  else if (anyDegraded && mode === 'repair') task = "신호가 불안정한(주황) 링크가 있어요. '테스트'로 어느 선인지 찾아보세요.";
  else if (anyDown) task = "LED가 꺼진 링크가 있어요. '테스트'로 원인부터 확인해 보세요.";
  else if (anyDegraded) task = "신호가 불안정한 링크가 있어요. '테스트'로 어느 선인지 찾아보세요.";
  else if (mode === 'build' && notMounted > 0) task = `아직 랙에 없는 서버가 ${notMounted}대 있어요. 서버실에서 장착한 뒤 여기서 연결하세요.`;
  else if (allLinked)
    task = mode === 'build' ? '완료! 모든 서버가 스위치와 초록불로 연결됐어요.' : replacedHere ? '완료! 모든 링크가 다시 초록불이에요.' : '모든 링크가 초록불이에요. 지금은 고칠 게 없어요.';
  else if (anyNoPower) task = mode === 'build' ? '케이블 연결 끝! 전원이 꺼진 장비는 전기실 PDU에서 켜면 LED가 들어와요.' : '전원이 꺼진 장비가 있어요. 전원 문제는 전기실에서 확인하세요.';
  else task = '케이블 상태를 점검하세요.';

  // Today's servers that are k8s nodes: their Ready state is shown too.
  const nodeRows = servers.some((d) => !!world.k8s?.nodes[d.id]);
  let doneText: string | null = null;
  if (done) {
    if (!allLinked) doneText = anyNoPower ? '케이블은 다 꽂았어요. LED는 양쪽 장비에 전원이 들어와야 켜져요.' : '케이블은 다 꽂았어요.';
    else if (!world.k8s || !nodeRows) doneText = '모든 링크 정상! 데이터가 지나갈 도로(케이블과 신호)가 깔렸어요.';
    else {
      const down = Object.entries(world.k8s.nodes).filter(([, n]) => !n.ready);
      const hot = down.filter(([, n]) => (world.cooling?.temps[n.rack] ?? 24) >= NODE_SAFE_TEMP).map(([id]) => id);
      const soon = down.filter(([, n]) => (world.cooling?.temps[n.rack] ?? 24) < NODE_SAFE_TEMP).map(([id]) => id);
      const parts: string[] = [];
      if (soon.length) parts.push(`링크 복구! ${soon.join(', ')} 노드는 1~2초 안에 다시 Ready가 돼요.`);
      if (hot.length) parts.push(`${hot.join(', ')} 노드는 링크 말고 다른 원인으로 NotReady예요.`);
      doneText = parts.length ? parts.join(' ') : '모든 링크 정상! 노드도 모두 Ready예요.';
    }
  }

  // ----- wires -----
  const wires: { id: string; a: Pt; b: Pt; cls: string }[] = [];
  for (const { ep, c, state } of every) {
    if (!c || !state) continue;
    const a = pts[ep];
    const b = pts[otherEnd(c, ep)];
    if (a && b) wires.push({ id: c.id, a, b, cls: `${state}${replacing[c.id] ? ' replacing' : ''}` });
  }
  let liveWire: { a: Pt; b: Pt } | null = null;
  if (drag && pts[drag.item] && boardRef.current) {
    const base = boardRef.current.getBoundingClientRect();
    liveWire = { a: pts[drag.item], b: { x: drag.x - base.left, y: drag.y - base.top } };
  }

  /** The test and replace buttons for one cable, with the tester's last (still valid) reading. */
  const tools = (c: Cable, label: string) => {
    const measuring = !!running[c.id];
    const res = tests[c.id];
    const fresh = res && !measuring && res.sig === sigOf(world, c) ? res : null;
    return (
      <div className="cb-tools">
        <button type="button" className="btn cb-tool" disabled={!!replacing[c.id] || measuring} onClick={() => runTest(c)}>
          테스트
        </button>
        <button type="button" className="btn cb-tool" disabled={!!replacing[c.id]} onClick={() => runReplace(c, label)}>
          {replacing[c.id] ? '교체 중…' : '새 케이블로 교체'}
        </button>
        {measuring && <span className="cb-result running">측정 중…</span>}
        {fresh && (
          <span className={`cb-result ${fresh.kind}`} role="status">
            {fresh.text}
          </span>
        )}
      </div>
    );
  };

  return (
    <MiniGameFrame
      title={mode === 'build' ? `케이블 연결 · ${labelOf(world, SWITCH)}` : `케이블 점검 · ${labelOf(world, SWITCH)}`}
      size="wide"
      onEscape={() => {
        if (!selected) return false;
        setSelected(null);
        return true;
      }}
      footer={<GameFooter done={done}>{doneText}</GameFooter>}
    >
      <TaskBar done={done}>{task}</TaskBar>
      {plan && (
        <div className="cb-plan" aria-label="배선표">
          <b>배선표</b>
          {plan.map((r) => (
            <span key={r.text} className={`cb-plan-row${r.done ? ' done' : r.next ? ' next' : ''}`}>
              {r.done ? '✓ ' : r.next ? '▶ ' : ''}
              {r.text}
            </span>
          ))}
        </div>
      )}

      <div className="cb-scroll">
        <div className="cb-board" ref={boardRef}>
          <div className="cb-col cb-left">
            <div className="cb-col-title">{nodeRows ? '노드 (서버)' : '서버'}</div>
            {servers.length === 0 && <div className="mg-empty">연결할 서버가 없어요.</div>}
            {servers.map((d) => {
              const ep = endpointOf(d);
              const c = cableAt(world, ep);
              const on = powered(world, d.id);
              const up = linkUp(world, d.id, portOf(ep));
              const node = world.k8s?.nodes[d.id];
              const canDrag = mode === 'build' && d.installed && !c;
              return (
                <div key={d.id} className={`cb-row${d.installed ? '' : ' absent'}`}>
                  <div className="cb-dev">
                    <div className="cb-dev-line">
                      <span className="cb-dev-name">
                        {d.label}
                        {/* "노드 n1" already names the device: no second id chip */}
                        {!d.label.includes(d.id) && <span className="cb-id"> {d.id}</span>}
                      </span>
                      {d.installed ? (
                        <span className={`cb-pwr${on ? ' on' : ''}`}>{on ? '● 전원 ON' : '전원 OFF'}</span>
                      ) : (
                        <span className="cb-pwr">랙 장착 전</span>
                      )}
                      {d.rack && <span className="tag">{rackName(d.rack)}</span>}
                      {node && <span className={`tag cb-node ${node.ready ? 'ready' : 'notready'}`}>{node.ready ? 'Ready' : 'NotReady'}</span>}
                    </div>
                    {c && tools(c, d.label)}
                  </div>
                  <button
                    type="button"
                    className={`cb-jack${c ? ' plugged' : ''}${canDrag ? ' free' : ''}${selected === ep ? ' selected' : ''}`}
                    disabled={!d.installed}
                    aria-label={`${d.label} ${portOf(ep)} 포트${c ? ' (연결됨)' : canDrag ? ' (비어 있음, 골라서 스위치 포트에 꽂기)' : ''}`}
                    aria-pressed={selected === ep}
                    {...bind(ep, () => tapJack(d), canDrag)}
                  >
                    <span className="cb-jack-hole" data-jack={ep} aria-hidden />
                    <span className="cb-jack-name">{portOf(ep)}</span>
                    <Led state={up ? (c?.degraded ? 'crc' : 'blink') : 'off'} title={up ? (c?.degraded ? '에러 섞임' : '링크 정상') : '링크 없음'} />
                  </button>
                </div>
              );
            })}
            {others.length > 0 && <div className="cb-col-sub">이 스위치의 다른 케이블 (코어 스위치로 가는 업링크 등)</div>}
            {others.map((o) => {
              const ep = `${o.dev}:${o.port}`;
              const name = farName(world, ep);
              return (
                <div key={o.cable.id} className="cb-row">
                  <div className="cb-dev">
                    <div className="cb-dev-line">
                      <span className="cb-dev-name">{labelOf(world, o.dev)}</span>
                      {world.devices[o.dev]?.nd && <span className="tag">{isCore(o.dev) ? '업링크' : '스위치 간 연결'}</span>}
                    </div>
                    {tools(o.cable, name)}
                  </div>
                  <button
                    type="button"
                    className="cb-jack plugged"
                    aria-label={`${name} 포트 (연결됨)`}
                    onClick={() => showNote('info', `${name}: 이미 연결된 포트예요. 이상하면 '테스트'해 보세요.`)}
                  >
                    <span className="cb-jack-hole" data-jack={ep} aria-hidden />
                    <span className="cb-jack-name">{o.port}</span>
                    <Led state={LED_OF[portLed(world, o.dev, o.port, blocked)]} />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="cb-gap" aria-hidden />

          <div className="cb-col cb-switch">
            <div className="cb-col-title">
              스위치 {labelOf(world, SWITCH)} <Led state={powered(world, SWITCH) ? 'on' : 'off'} title={powered(world, SWITCH) ? '전원 ON' : '전원 OFF'} />
            </div>
            <div className="cb-faceplate">
              {ports.map((p) => {
                const ep = `${SWITCH}:${p}`;
                const c = cableAt(world, ep);
                const target = !c && !!holding && mode === 'build';
                const planned = target && plannedPort === p;
                const over = drag?.over === ep;
                return (
                  <button
                    key={p}
                    type="button"
                    className={`cb-port${c ? ' used' : ' free'}${target ? ' target' : ''}${planned ? ' planned' : ''}${over ? (c ? ' over-bad' : ' over-ok') : ''}`}
                    data-drop={ep}
                    onClick={() => tapPort(p)}
                    aria-label={`스위치 ${p} 포트: ${c ? `${farName(world, otherEnd(c, ep))} 연결됨` : '비어 있음'}`}
                  >
                    <span className="cb-jack-hole" data-jack={ep} aria-hidden />
                    <span className="cb-port-name">{p}</span>
                    <Led state={LED_OF[portLed(world, SWITCH, p, blocked)]} />
                    <span className="cb-port-use">{c ? labelOf(world, devOf(otherEnd(c, ep))) : '비어 있음'}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <svg className="cb-wires" aria-hidden>
            {wires.map((w) => (
              <Wire key={w.id} a={w.a} b={w.b} cls={w.cls} />
            ))}
            {liveWire && <Wire a={liveWire.a} b={liveWire.b} cls="live" />}
          </svg>
        </div>
      </div>

      <div className="mg-legend">
        <span>
          <i className="cb-swatch up" /> 신호 정상
        </span>
        <span>
          <i className="cb-swatch down" /> 양쪽 전원은 켜졌는데 신호 없음
        </span>
        <span>
          <i className="cb-swatch degraded" /> 신호 불안정 (에러 섞임)
        </span>
        <span>
          <i className="cb-swatch nopower" /> 한쪽 장비 전원 꺼짐
        </span>
        {otherStates.some((s) => s.state === 'shut') && (
          <span>
            <i className="cb-swatch shut" /> 일부러 막아 둔 연결 (꺼 둔 예비 · 스위치가 막은 고리)
          </span>
        )}
        <span>
          <Led state="blink" /> 포트 LED 깜빡임 = 링크 정상
        </span>
        <span>
          <Led state="crc" /> 초록·주황 번갈아 = 에러 섞임
        </span>
      </div>

      <NoteLine note={note} idle="'테스트' = 케이블 테스터로 선 안쪽까지 검사해요." />
    </MiniGameFrame>
  );
}
