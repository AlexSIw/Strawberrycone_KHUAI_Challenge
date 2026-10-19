import { useEffect } from 'react';
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

/** Global hotkeys: Tab = dashboard, H = AI 사수 무전기 (radio), C = 개념 도감. */
function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = gameStore.getState();
      if (s.screen !== 'playing' || s.dialogue) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, .xterm')) return;
      if (e.key === 'Tab') {
        // Only steal Tab to toggle the dashboard; inside other windows it moves focus as usual.
        if (s.modal && s.modal.type !== 'dashboard') return;
        e.preventDefault();
        if (s.modal) s.closeModal();
        else s.openModal({ type: 'dashboard' });
      } else if ((e.key === 'h' || e.key === 'H') && !s.modal) {
        s.openModal({ type: 'hint' });
      } else if ((e.key === 'c' || e.key === 'C') && !s.modal) {
        s.openModal({ type: 'concepts' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  const screen = useGame((s) => s.screen);
  const stage = useGame((s) => s.run?.stage);
  useTicker();
  useHotkeys();

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
