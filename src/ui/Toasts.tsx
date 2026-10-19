import { useEffect, useState } from 'react';
import { gameStore, useGame, type Toast } from '../store/game';
import './Toasts.css';

// The objective panel keeps every active incident and objective listed, so toasts only need to catch the eye.
const LIFETIME: Record<Toast['kind'], number> = { alert: 7000, resolved: 5000, objective: 4000, info: 6000 };
const LEAVE_MS = 260;

const LABEL: Record<Toast['kind'], string> = { alert: '장애 발생', resolved: '해결 완료', objective: '목표 달성', info: '알림' };

function ToastItem({ toast }: { toast: Toast }) {
  const [leaving, setLeaving] = useState(false);

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
    <li className="toast-li" role={toast.kind === 'alert' ? 'alert' : 'status'}>
      <button
        type="button"
        className={`toast-item toast-${toast.kind} ${leaving ? 'leaving' : ''}`}
        onClick={(e) => {
          e.currentTarget.blur();
          setLeaving(true);
        }}
        title="클릭하면 닫혀요"
      >
        <span className="toast-kind">{LABEL[toast.kind]}</span>
        <span className="toast-text">{toast.text}</span>
        <span className="toast-timer" style={{ animationDuration: `${LIFETIME[toast.kind]}ms` }} aria-hidden />
      </button>
    </li>
  );
}

/** Top-right notifications: alerts, fixes, objectives. They disappear on their own. */
export function Toasts() {
  const toasts = useGame((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <ol className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </ol>
  );
}
