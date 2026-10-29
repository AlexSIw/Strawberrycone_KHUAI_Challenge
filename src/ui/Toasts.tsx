import { useEffect, useState } from 'react';
import { gameStore, useGame, type Toast } from '../store/game';
import { PixelIcon } from './PixelIcon';
import { toastHead } from './toastHead';
import './Toasts.css';

// The objective panel keeps every active incident and objective listed, so toasts only need to catch the eye.
const LIFETIME: Record<Toast['kind'], number> = { alert: 7000, resolved: 5000, objective: 4000, info: 6000 };
const LEAVE_MS = 260;

function ToastItem({ toast, under }: { toast: Toast; under: boolean }) {
  const [leaving, setLeaving] = useState(false);
  const head = toastHead(toast);

  useEffect(() => {
    const life = LIFETIME[toast.kind];
    const fade = window.setTimeout(() => setLeaving(true), life - LEAVE_MS);
    const gone = window.setTimeout(() => gameStore.getState().dismissToast(toast.id), life);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(gone);
    };
  }, [toast.id, toast.kind]);

  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(() => gameStore.getState().dismissToast(toast.id), LEAVE_MS);
    return () => window.clearTimeout(id);
  }, [leaving, toast.id]);

  return (
    <li className={`toast-li${under ? ' toast-under' : ''}`} role={toast.kind === 'alert' ? 'alert' : 'status'}>
      <button
        type="button"
        className={`toast-item toast-${toast.kind}${toast.source ? ` toast-src-${toast.source}` : ''} ${leaving ? 'leaving' : ''}`}
        onClick={(e) => {
          e.currentTarget.blur();
          setLeaving(true);
        }}
        title="클릭하면 닫혀요"
      >
        <span className="toast-kind">
          {head.icon && <PixelIcon name={head.icon} />}
          {head.label}
        </span>
        <span className="toast-text">{toast.text}</span>
        <span className="toast-timer" style={{ animationDuration: `${LIFETIME[toast.kind]}ms` }} aria-hidden />
      </button>
    </li>
  );
}

/** Kinds that still show over an open window: a call or alarm about a new incident, and notices (day done…). */
const OVER_WINDOW: Toast['kind'][] = ['alert', 'info'];

/**
 * Top-right notifications: alerts, fixes, objectives. They disappear on their own. With a window open,
 * alerts and notices go on top of it (top left, over its title), so a user's call is never hidden behind
 * the terminal; the others stay out of the way (hidden, their timers still running).
 */
export function Toasts() {
  const toasts = useGame((s) => s.toasts);
  const windowOpen = useGame((s) => !!s.modal);
  if (!toasts.length) return null;
  // Over a window, at most the two newest: the stack must not reach down to a fresh terminal's prompt.
  const over = toasts.filter((t) => OVER_WINDOW.includes(t.kind)).slice(-2);
  return (
    <ol className={`toast-stack${windowOpen ? ' over-window' : ''}`} aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} under={!over.includes(t)} />
      ))}
    </ol>
  );
}
