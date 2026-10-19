import { useEffect, type ReactNode } from 'react';
import { gameStore } from '../store/game';

interface Props {
  title: ReactNode;
  icon?: string;
  size?: 'normal' | 'wide' | 'narrow';
  children: ReactNode;
  footer?: ReactNode;
  /** Defaults to closing the current modal (which brings back the window underneath, if any) */
  onClose?: () => void;
  /** Extra class on the backdrop (e.g. to sit above the window layer) */
  className?: string;
}

/** Window chrome shared by every overlay (terminal, mini-games, boards…). Esc closes it. */
export function ModalFrame({ title, icon, size = 'normal', children, footer, onClose, className = '' }: Props) {
  const close = onClose ?? (() => gameStore.getState().closeModal());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  return (
    <div className={`modal-backdrop ${className}`.trim()} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`modal panel ${size === 'normal' ? '' : size}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          {icon && <span style={{ fontSize: 20 }}>{icon}</span>}
          <h2>{title}</h2>
          <button className="btn ghost" onClick={close} aria-label="닫기">
            ✕ <span className="muted" style={{ fontSize: 12 }}>Esc</span>
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
