import { useEffect } from 'react';
import { startAudioDirector } from './audio/director';
import { PhaserGame } from './game/PhaserGame';
import { gameStore, useGame } from './store/game';
import { ConceptCardPopup } from './ui/ConceptCardPopup';
import { DialogueBox } from './ui/DialogueBox';
import { Ending } from './ui/Ending';
import { Hud } from './ui/Hud';
import { ModalHost } from './ui/ModalHost';
import { ObjectivePanel } from './ui/ObjectivePanel';
import { Results } from './ui/Results';
import { StageSelect } from './ui/StageSelect';
import { TitleScreen } from './ui/TitleScreen';
import { Toasts } from './ui/Toasts';

/** One game second per real second while playing. */
function useTicker() {
  useEffect(() => {
    const id = window.setInterval(() => gameStore.getState().tick(), 1000);
    return () => window.clearInterval(id);
  }, []);
}

/**
 * Global hotkeys: Tab = dashboard, H = AI 사수 무전기 (radio), C = 개념 도감.
 * Each toggles its window: it opens on top of whatever window is open (closing it goes back there), and
 * pressing the key again while it is the open window closes it. Keys typed into a text box or the terminal,
 * and Tab inside other windows (moving focus), are left alone. Esc (closing) belongs to ModalFrame.
 */
function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = gameStore.getState();
      if (s.screen !== 'playing' || s.dialogue) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], .xterm')) return;
      const toggle = (type: 'dashboard' | 'hint' | 'concepts') => {
        if (e.repeat) return;
        if (s.modal?.type === type) s.closeModal();
        else s.openModal({ type });
      };
      if (e.key === 'Tab') {
        // Only steal Tab to toggle the dashboard; inside other windows it moves focus as usual.
        if (s.modal && s.modal.type !== 'dashboard') return;
        e.preventDefault();
        toggle('dashboard');
      } else if (e.code === 'KeyH' || e.key === 'h' || e.key === 'H') {
        toggle('hint');
      } else if (e.code === 'KeyC' || e.key === 'c' || e.key === 'C') {
        toggle('concepts');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Music, alarm and jingles follow the game state; M mutes. */
function useAudio() {
  useEffect(() => startAudioDirector(), []);
}

export function App() {
  const screen = useGame((s) => s.screen);
  const stage = useGame((s) => s.run?.stage);
  useTicker();
  useHotkeys();
  useAudio();

  if (screen === 'title') return <TitleScreen />;
  if (screen === 'select') return <StageSelect />;
  if (screen === 'ending') return <Ending />;

  return (
    <div className="game-root" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {stage !== undefined && <PhaserGame key={stage} />}
      <Hud />
      <ObjectivePanel />
      <Toasts />
      <ModalHost />
      <ConceptCardPopup />
      <DialogueBox />
      {screen === 'results' && <Results />}
    </div>
  );
}
