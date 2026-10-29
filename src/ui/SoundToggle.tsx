import { useSyncExternalStore, type ReactNode } from 'react';
import { audio } from '../audio/engine';
import { PixelIcon } from './PixelIcon';

/** Is sound muted (the sound on/off setting, also toggled with M)? */
export function useMuted(): boolean {
  return useSyncExternalStore(audio.subscribe, audio.isMuted, audio.isMuted);
}

/** Sound on/off button. Drops focus after a click so a later Enter/Space doesn't press it again. */
export function SoundToggle({ className = '', children }: { className?: string; children?: ReactNode }) {
  const muted = useMuted();
  return (
    <button
      type="button"
      className={`btn ${className}`}
      onClick={(e) => {
        e.currentTarget.blur();
        audio.toggleMuted();
      }}
      title="소리 켜기/끄기 (M)"
      aria-label="소리"
      aria-pressed={!muted}
    >
      <PixelIcon name={muted ? 'soundOff' : 'soundOn'} />
      {children}
    </button>
  );
}
