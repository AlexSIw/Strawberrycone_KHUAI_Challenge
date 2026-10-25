// 랙 장착 미니게임: 카트의 서버 상자를 끌어서 자기 랙의 빈 칸(U)에 꽂는다.
import { useRef, useState } from 'react';
import type { StageDef } from '../../content/types';
import { mapDevicesOf } from '../../game/worldView';
import { mount } from '../../sim/actions';
import { linkUp, powered } from '../../sim/network';
import type { Device, World } from '../../sim/types';
import { gameStore } from '../../store/game';
import { useStageState } from '../useStageState';
import {
  DragGhost,
  GameFooter,
  Led,
  MiniGameFrame,
  NoteLine,
  TaskBar,
  prefersReducedMotion,
  rackName,
  useDay,
  useDragDrop,
  useNote,
  useTimers,
  useWorld,
} from './common';
import './RackGame.css';

const SLOTS = 8;
const BASE_RACKS = ['rack1', 'rack2'];
/** Slot (index from the top) a server lands in when we don't remember where the player put it. */
const DEFAULT_ORDER = [2, 3, 4, 5, 1, 6, 0, 7];

/** Which U each server went into ("rack1:3"), by server. The world only knows "mounted", so the slot is remembered here. */
type Slots = Record<string, string>;

type Layout = Record<string, (string | null)[]>;

/** Today's rack-mounted devices (def.mapDevices; without a list, every rack server). */
function rackServers(w: World, day: StageDef): Device[] {
  return mapDevicesOf(day, w).filter((d) => !!d.rack);
}

function racksOf(servers: Device[]): string[] {
  const all = new Set(servers.length ? servers.map((d) => d.rack!) : BASE_RACKS);
  return [...all].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function layoutOf(servers: Device[], slots: Slots): Layout {
  const out: Layout = Object.fromEntries(racksOf(servers).map((r) => [r, Array<string | null>(SLOTS).fill(null)]));
  const rest: Device[] = [];
  for (const d of servers.filter((x) => x.installed)) {
    const [r, s] = (slots[d.id] ?? '').split(':');
    const idx = Number(s);
    if (r === d.rack && out[r]?.[idx] === null) out[r][idx] = d.id;
    else rest.push(d);
  }
  for (const d of rest) {
    const col = out[d.rack!];
    const free = DEFAULT_ORDER.find((i) => col[i] === null);
    if (free !== undefined) col[free] = d.id;
  }
  return out;
}

function ServerBox({ d, lifted }: { d: Device; lifted?: boolean }) {
  return (
    <span className={`rk-box${lifted ? ' lifted' : ''}`}>
      <span className="rk-box-tape" aria-hidden />
      <span className="rk-box-label">{d.label}</span>
      <span className="rk-box-sticker">→ {rackName(d.rack)}</span>
    </span>
  );
}

export function RackGame() {
  const world = useWorld();
  const day = useDay();
  // Kept for the stage: reopening the rack shows every server in the U the player chose.
  const [slots, setSlots] = useStageState<Slots>('rack:slots', {});
  const [selected, setSelected] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [snapped, setSnapped] = useState<string | null>(null);
  const [note, showNote] = useNote();
  const later = useTimers();
  const boxRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const wrongRack = (d: Device, rack: string) => {
    if (!prefersReducedMotion()) {
      boxRefs.current[d.id]?.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(7px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }],
        { duration: 420, easing: 'ease-in-out' },
      );
    }
    setFlash(rack);
    later(() => setFlash((cur) => (cur === rack ? null : cur)), 600);
    showNote('bad', `이 서버는 ${rackName(d.rack)} 자리예요`);
  };

  /** zone: "slot:<rack>:<index>" or "rack:<rack>" (dropped on the cabinet frame) */
  const place = (id: string, zone: string) => {
    const w = gameStore.getState().run?.world;
    const d = w?.devices[id];
    if (!w || !d || d.installed) return;
    const [kind, rack, slotStr] = zone.split(':');
    if (kind !== 'slot' && kind !== 'rack') return;
    if (rack !== d.rack) return wrongRack(d, rack);
    if (!day) return;
    const col = layoutOf(rackServers(w, day), slots)[rack];
    let slot = Number(slotStr);
    if (kind === 'rack') slot = DEFAULT_ORDER.find((i) => col[i] === null) ?? -1;
    if (slot < 0 || col[slot]) {
      showNote('bad', '이 칸은 이미 차 있어요. 빈 칸에 넣어 주세요.');
      return;
    }
    setSlots((m) => ({ ...m, [id]: `${rack}:${slot}` }));
    gameStore.getState().act((ww) => mount(ww, id), 'rack:mount');
    setSelected(null);
    setSnapped(id);
    later(() => setSnapped((cur) => (cur === id ? null : cur)), 700);
    showNote('ok', `철컥! ${d.label} 장착 완료 🔩`);
  };

  const { drag, bind } = useDragDrop<string>(place);

  if (!world || !day) return null;
  const servers = rackServers(world, day);
  const layout = layoutOf(servers, slots);
  const onCart = servers.filter((d) => !d.installed);
  const done = onCart.length === 0;
  const holding = drag?.item ?? selected;
  const held = holding && !world.devices[holding]?.installed ? world.devices[holding] : undefined;

  const tapSlot = (rack: string, i: number) => {
    if (selected) return place(selected, `slot:${rack}:${i}`);
    const id = layout[rack][i];
    const d = id ? world.devices[id] : undefined;
    if (d) {
      showNote('info', powered(world, d.id) ? `${d.label}: 장착 완료, 전원 ON ⚡` : `${d.label}: 장착 완료. LED가 꺼져 있는 건 아직 전기가 없어서예요.`);
    } else {
      showNote('info', done ? '빈 칸이에요. 지금은 넣을 서버가 없어요.' : '먼저 카트에서 서버 상자를 하나 고르세요.');
    }
  };

  const allPowered = servers.every((d) => powered(world, d.id));
  const allLinked = servers.every((d) => linkUp(world, d.id, d.ports[0] ?? 'eth0'));
  const nextStep = !allPowered
    ? 'LED가 꺼져 있죠? 아직 전기가 없어서예요. 다음은 전기실 PDU에서 전원을 꽂아 주세요.'
    : !allLinked
      ? '전원 OK! 이제 네트워크실 스위치에 케이블을 연결하면 오른쪽 LED도 켜져요.'
      : '전원도 케이블도 연결 끝! 서버들이 초록불로 반짝여요.';

  return (
    <MiniGameFrame
      title="서버실 · 랙에 서버 장착"
      icon="🗄️"
      size="wide"
      onEscape={() => {
        if (!selected) return false;
        setSelected(null);
        showNote('info', '상자를 카트에 다시 내려놨어요.');
        return true;
      }}
      footer={<GameFooter done={done && servers.length > 0}>{done && servers.length > 0 ? nextStep : null}</GameFooter>}
    >
      <TaskBar done={done}>
        {servers.length === 0
          ? '이번에는 새로 설치할 서버가 없어요.'
          : done
            ? `완료! 서버 ${servers.length}대를 모두 랙에 장착했어요.`
            : held
              ? `「${held.label}」 → ${rackName(held.rack)}의 빈 칸을 클릭하거나, 끌어다 놓으세요.`
              : '카트의 서버 상자를 끌어서 상자에 적힌 랙의 빈 칸에 넣으세요. (클릭으로 골라도 돼요)'}
      </TaskBar>

      <div className="rk-floor">
        <div className="rk-cart" data-drop="cart">
          <div className="rk-cart-title">📦 배송 카트</div>
          <div className="rk-cart-shelf">
            {onCart.length === 0 && <div className="rk-cart-empty">카트가 비었어요 🎉</div>}
            {onCart.map((d) => (
              <button
                key={d.id}
                ref={(el) => {
                  boxRefs.current[d.id] = el;
                }}
                type="button"
                className={`rk-box-btn${selected === d.id ? ' selected' : ''}`}
                aria-pressed={selected === d.id}
                aria-label={`${d.label} (${rackName(d.rack)} 자리) 고르기`}
                {...bind(d.id, () => setSelected((cur) => (cur === d.id ? null : d.id)))}
              >
                <ServerBox d={d} lifted={drag?.item === d.id} />
              </button>
            ))}
          </div>
          <div className="rk-cart-base" aria-hidden>
            <span className="rk-wheel" />
            <span className="rk-wheel" />
          </div>
        </div>

        <div className="rk-racks">
          {Object.entries(layout).map(([rack, col]) => {
            const mine = servers.filter((d) => d.rack === rack);
            const mounted = mine.filter((d) => d.installed).length;
            return (
              <div key={rack} className={`rk-rack${flash === rack ? ' flash' : ''}`} data-drop={`rack:${rack}`}>
                <div className="rk-plate">
                  <span>{rackName(rack)}</span>
                  <span className="rk-plate-count">
                    {mounted}/{mine.length}
                  </span>
                </div>
                <div className="rk-cabinet">
                  {col.map((id, i) => {
                    const zone = `slot:${rack}:${i}`;
                    const d = id ? world.devices[id] : undefined;
                    const over = drag?.over === zone;
                    const cls = [
                      'rk-slot',
                      d ? 'filled' : 'empty',
                      !d && held?.rack === rack ? 'target' : '',
                      !d && over ? (held?.rack === rack ? 'over-ok' : 'over-bad') : '',
                    ].join(' ');
                    return (
                      <button
                        key={i}
                        type="button"
                        className={cls}
                        data-drop={zone}
                        onClick={() => tapSlot(rack, i)}
                        aria-label={d ? `${rackName(rack)} U${SLOTS - i}: ${d.label}` : `${rackName(rack)} U${SLOTS - i}: 빈 칸`}
                      >
                        <span className="rk-u">U{SLOTS - i}</span>
                        {d ? (
                          <span className={`rk-server${snapped === d.id ? ' snap' : ''}`}>
                            <span className="rk-grill" aria-hidden />
                            <span className="rk-srv-label">{d.label}</span>
                            {!powered(world, d.id) && <span className="rk-srv-off">전원 대기</span>}
                            <span className="rk-leds">
                              <Led state={powered(world, d.id) ? 'on' : 'off'} title="전원 LED" />
                              <Led state={linkUp(world, d.id, d.ports[0] ?? 'eth0') ? 'blink' : 'off'} title="네트워크 LED" />
                            </span>
                          </span>
                        ) : (
                          <span className="rk-rail" aria-hidden />
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="rk-feet" aria-hidden />
              </div>
            );
          })}
        </div>
      </div>

      <NoteLine note={note} idle="LED 두 개: 왼쪽 = 전원, 오른쪽 = 네트워크. 장착만 하면 아직 꺼져 있어요." />

      <DragGhost at={drag}>{drag && world.devices[drag.item] && <ServerBox d={world.devices[drag.item]} />}</DragGhost>
    </MiniGameFrame>
  );
}
