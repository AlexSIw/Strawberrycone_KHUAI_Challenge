// Decides what to play from game state changes: the music (lobby / in-stage / incident), the incident
// alarm, the coin and the win jingle. Also owns the M (mute) hotkey. Started once from App.
import { gameStore } from '../store/game';
import { audio } from './engine';
import { activeIncidents, createAlarm, createCueTracker, musicFor, newlyActive, sameRun } from './logic';

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

  // Coin: an objective done or a card new to the collection. Win jingle: an incident's card pops up, the
  // stage clear popup or the certificate appears. Each action's cues play together once it's done.
  const cues = createCueTracker({
    now: seconds,
    defer: (fn) => queueMicrotask(fn),
    play: (p) => audio.playSfx(p.sfx, p.delay),
  });

  let prev = gameStore.getState();
  let prevActive = activeIncidents(prev);
  audio.setMusic(musicFor(prev));

  const unsubscribe = gameStore.subscribe((s) => {
    audio.setMusic(musicFor(s));

    // Alarm: 4 beeps when an incident fires (restarted by the next one); silent once none is left,
    // the stage ends or the screen changes.
    const run = sameRun(prev, s);
    const active = activeIncidents(s);
    if (!run || s.screen !== prev.screen || active.length === 0) alarm.stop();
    if (newlyActive(run ? prevActive : [], active).length > 0) alarm.start();

    cues.observe(prev, s);

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
    cues.stop();
    window.removeEventListener('keydown', onKey);
    alarm.stop();
  };
}

// Dev: a hot update can't swap a running director (its subscription and alarm live on); reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
