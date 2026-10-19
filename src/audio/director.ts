// Decides what to play from game state changes: the music loop, the incident alarm and the win jingle.
// Also owns the M (mute) hotkey. Started once from App.
import { gameStore } from '../store/game';
import { audio } from './engine';
import { activeIncidents, createAlarm, jingleAllowed, jingleCue, musicFor, newlyActive, sameRun } from './logic';

const seconds = () => performance.now() / 1000;

/** Start following the game; returns a function that stops it. */
export function startAudioDirector(): () => void {
  audio.init();

  const alarm = createAlarm({
    now: seconds,
    beep: () => audio.playSfx('alarm'),
    cut: () => audio.stopAlarm(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => window.clearTimeout(id),
  });

  let prev = gameStore.getState();
  let prevActive = activeIncidents(prev);
  let lastJingle: number | null = null;
  audio.setMusic(musicFor(prev));

  const unsubscribe = gameStore.subscribe((s) => {
    audio.setMusic(musicFor(s));

    // Alarm: 4 beeps when an incident fires (restarted by the next one); silent once none is left,
    // the stage ends or the screen changes.
    const run = sameRun(prev, s);
    const active = activeIncidents(s);
    if (!run || s.screen !== prev.screen || active.length === 0) alarm.stop();
    if (newlyActive(run ? prevActive : [], active).length > 0) alarm.start();

    // Win jingle: an incident's concept card pops up, or the results screen appears (once per ~1 s).
    if (jingleCue(prev, s)) {
      const now = seconds();
      if (jingleAllowed(lastJingle, now)) {
        lastJingle = now;
        audio.playSfx('win');
      }
    }

    prev = s;
    prevActive = active;
  });

  // M toggles sound anywhere, except while typing (hint chat, terminal…).
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code !== 'KeyM' && e.key !== 'm' && e.key !== 'M') return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('input, textarea, select, [contenteditable="true"], .xterm')) return;
    audio.toggleMuted();
  };
  window.addEventListener('keydown', onKey);

  return () => {
    unsubscribe();
    window.removeEventListener('keydown', onKey);
    alarm.stop();
  };
}
