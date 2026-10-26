// Shared pieces for the hands-on mini-games: live world, window frame, instruction bar, "완료!" footer, LEDs, drag & drop.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { getStage } from '../../content/stages';
import type { StageDef } from '../../content/types';
import type { World } from '../../sim/types';
import { gameStore, useGame } from '../../store/game';
import { ModalFrame } from '../ModalFrame';
import './minigames.css';

/** The live world of the current run (re-renders every tick). */
export function useWorld(): World | undefined {
  return useGame((s) => s.run?.world);
}

/** Today's day definition (mapSwitch / mapDevices for the mini-games). */
export function useDay(): StageDef | undefined {
  const stage = useGame((s) => s.run?.stage);
  return stage === undefined ? undefined : getStage(stage);
}

/** "rack1" → "랙 1", "net1" → "네트워크실 1번 랙" */
export function rackName(rack: string | undefined): string {
  if (!rack) return '랙 밖';
  const m = /^rack(\d+)$/.exec(rack);
  if (m) return `랙 ${m[1]}`;
  const net = /^net(\d+)$/.exec(rack);
  return net ? `네트워크실 ${net[1]}번 랙` : rack;
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ---------- window frame ----------

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type FrameProps = ComponentProps<typeof ModalFrame> & {
  /** Esc calls this first. Return true when it handled the key (e.g. put a held item back) so the window stays open. */
  onEscape?: () => boolean;
};

/**
 * ModalFrame plus keyboard care for the mini-games:
 * - focus moves into the window when it opens (to [data-autofocus] or the first button), so Enter/Space work right away;
 * - Tab cycles through this window's buttons (the global Tab hotkey would otherwise swallow it);
 * - Esc can first cancel a "picked up" item instead of closing the window.
 * Both keys are left alone while the dialogue box or a concept card is on top.
 */
export function MiniGameFrame({ onEscape, ...props }: FrameProps) {
  const root = useRef<HTMLDivElement>(null);
  const escRef = useRef(onEscape);
  useEffect(() => {
    escRef.current = onEscape;
  });

  useEffect(() => {
    // A game can pick its starting control with data-autofocus (so focus never "points at" an incident's answer).
    const body = root.current?.querySelector('.modal-body');
    const first = body?.querySelector<HTMLElement>('[data-autofocus]') ?? body?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = gameStore.getState();
      // Something is on top of this window (dialogue, concept card, the HUD's exit question): its keys, not ours.
      if (s.dialogue || s.concepts.length > 0 || s.paused) return;
      if (e.key === 'Escape') {
        if (escRef.current?.()) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (e.key !== 'Tab') return;
      const modal = root.current?.querySelector<HTMLElement>('.modal');
      if (!modal) return;
      // Keep the global Tab hotkey from eating the key; we move focus ourselves (wrapping at both ends).
      e.stopPropagation();
      const items = [...modal.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (items.length === 0) return e.preventDefault();
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && modal.contains(active);
      const first = items[0];
      const last = items[items.length - 1];
      if (!inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    // Capture phase so it runs before the window-level hotkeys and ModalFrame's Esc handler.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div ref={root} className="mg-root">
      <ModalFrame {...props} />
    </div>
  );
}

/** Footer: the "완료!" stamp (always visible, even when the window scrolls) + the close button. */
export function GameFooter({ done, children }: { done: boolean; children?: ReactNode }) {
  const close = () => gameStore.getState().closeModal();
  // Done: the close button takes focus, so Enter (or Esc) closes the window right away.
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (done) btn.current?.focus({ preventScroll: true });
  }, [done]);
  return (
    <>
      {done ? (
        <div className="mg-done" role="status">
          <span className="mg-done-stamp">완료!</span>
          {children && <span className="mg-done-text">{children}</span>}
        </div>
      ) : (
        children && <div className="mg-foot-info">{children}</div>
      )}
      <button ref={btn} type="button" className={`btn${done ? ' primary' : ''}`} onClick={close}>
        {done ? '좋아요, 닫기' : '닫기'}
      </button>
    </>
  );
}

/** One short sentence that always says what to do next. */
export function TaskBar({ done, children }: { done?: boolean; children: ReactNode }) {
  return (
    <div className={`mg-task${done ? ' done' : ''}`} role="status" aria-live="polite">
      <span className="mg-task-icon" aria-hidden>
        {done ? '✅' : '👉'}
      </span>
      <span className="mg-task-text">{children}</span>
    </div>
  );
}

export type NoteKind = 'ok' | 'bad' | 'info';
export interface Note {
  kind: NoteKind;
  text: string;
  /** Changes every time so the same text re-animates */
  n: number;
}

/** Small feedback line under the play area ("철컥! 장착 완료", "이 서버는 랙 1 자리예요"). */
export function useNote(): [Note | null, (kind: NoteKind, text: string) => void] {
  const [note, setNote] = useState<Note | null>(null);
  const seq = useRef(0);
  const show = useCallback((kind: NoteKind, text: string) => setNote({ kind, text, n: ++seq.current }), []);
  return [note, show];
}

export function NoteLine({ note, idle }: { note: Note | null; idle?: ReactNode }) {
  if (!note) return <div className="mg-note idle">{idle ?? ' '}</div>;
  return (
    <div key={note.n} className={`mg-note ${note.kind}`} role="status">
      {note.text}
    </div>
  );
}

/** crc = green and amber in turns (a link that is up but drops damaged frames) */
export type LedState = 'off' | 'on' | 'blink' | 'bad' | 'warn' | 'crc';

export function Led({ state, title, size = 10 }: { state: LedState; title?: string; size?: number }) {
  return <span className={`mg-led ${state}`} style={{ width: size, height: size }} title={title} aria-hidden />;
}

/** Timers that are cleared automatically when the mini-game closes. */
export function useTimers(): (fn: () => void, ms: number) => void {
  const ids = useRef<number[]>([]);
  useEffect(() => {
    const list = ids;
    return () => list.current.forEach((id) => window.clearTimeout(id));
  }, []);
  return useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      ids.current = ids.current.filter((x) => x !== id);
      fn();
    }, ms);
    ids.current.push(id);
  }, []);
}

// ---------- drag & drop (pointer events) with a click fallback ----------

export interface DragInfo<T> {
  item: T;
  /** Pointer position in viewport coordinates */
  x: number;
  y: number;
  /** data-drop value of the zone under the pointer */
  over: string | null;
}

function zoneAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y);
  const zone = el?.closest<HTMLElement>('[data-drop]');
  return zone?.dataset.drop ?? null;
}

/**
 * Drag anything onto elements marked with `data-drop="<zone>"`.
 * A press without movement is treated as a click (`onTap`), so every drag also works as
 * "click to pick, then click the target" — which keeps it usable with a keyboard too.
 * `enabled` only gates dragging; taps always reach `onTap`.
 * Only one pointer drags at a time (a second finger is ignored).
 */
export function useDragDrop<T>(onDrop: (item: T, zone: string) => void) {
  const [drag, setDrag] = useState<DragInfo<T> | null>(null);
  const press = useRef<{ item: T; pointer: number; sx: number; sy: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const dropRef = useRef(onDrop);
  useEffect(() => {
    dropRef.current = onDrop;
  });

  // Safety net: if the dragged element disappears mid-drag its pointerup never arrives,
  // so end the drag on the next release anywhere (runs after the element's own handler).
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const end = (e: PointerEvent) => {
      if (press.current && press.current.pointer !== e.pointerId) return;
      press.current = null;
      setDrag(null);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [dragging]);

  const bind = (item: T, onTap: () => void, enabled = true) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || e.button !== 0 || press.current) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      press.current = { item, pointer: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false };
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const p = press.current;
      if (!p || p.pointer !== e.pointerId) return;
      if (!p.moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 6) return;
      p.moved = true;
      setDrag({ item: p.item, x: e.clientX, y: e.clientY, over: zoneAt(e.clientX, e.clientY) });
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      const p = press.current;
      if (!p || p.pointer !== e.pointerId) return;
      press.current = null;
      if (!p.moved) return;
      setDrag(null);
      // The browser still fires a click after a drag; swallow it.
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 0);
      const zone = zoneAt(e.clientX, e.clientY);
      if (zone) dropRef.current(p.item, zone);
    },
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => {
      if (press.current && press.current.pointer !== e.pointerId) return;
      press.current = null;
      setDrag(null);
    },
    onClick: () => {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      onTap();
    },
  });

  return { drag, bind };
}

/** The thing under your finger while dragging. */
export function DragGhost({ at, children }: { at: { x: number; y: number } | null; children: ReactNode }) {
  if (!at) return null;
  return createPortal(
    <div className="mg-ghost" style={{ left: at.x, top: at.y }}>
      {children}
    </div>,
    document.body,
  );
}
