import { gameStore, useGame, type Modal } from '../store/game';
import { ConceptsBook } from './ConceptsBook';
import { HintChat } from './HintChat';
import { ModalFrame } from './ModalFrame';
import { Recap } from './Recap';
import { Terminal } from './Terminal';
import { DecomposeBoard } from './boards/DecomposeBoard';
import { DesiredBoard } from './boards/DesiredBoard';
import { DockerfileBoard } from './boards/DockerfileBoard';
import { PostmortemBoard } from './boards/PostmortemBoard';
import { Quiz } from './boards/Quiz';
import { CableGame } from './minigames/CableGame';
import { PowerGame } from './minigames/PowerGame';
import { RackGame } from './minigames/RackGame';
import { GaugeModal } from './noc/GaugeModal';
import { NocConsole } from './noc/NocConsole';

/**
 * Renders the open window (the top of the store's window stack). Each window closes itself via
 * gameStore.closeModal(), which brings back the window underneath, if any.
 * The layer starts below the HUD, so its buttons (관제, radio, 도감…) still work with a window open.
 * A day started cold opens with its "지금까지" screen (store.recap), over everything, before the briefing.
 */
export function ModalHost() {
  const modal = useGame((s) => s.modal);
  return (
    <>
      {modal && <div className="modal-layer">{renderWindow(modal)}</div>}
      <Recap />
    </>
  );
}

function renderWindow(modal: Modal) {
  switch (modal.type) {
    case 'terminal':
      // Each place has its own session: a new place means a new window, not the old one's screen.
      return <Terminal key={modal.host} host={modal.host} />;
    case 'consolePick':
      return (
        <ModalFrame title="콘솔 연결할 서버 고르기" icon="🔌" size="narrow">
          <p className="muted">이 랙에는 서버가 여러 대 있어요. 콘솔 케이블을 어디에 꽂을까요?</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {modal.hosts.map((h) => (
              <button key={h} className="btn primary" onClick={() => gameStore.getState().openModal({ type: 'terminal', host: h })}>
                {h}
              </button>
            ))}
          </div>
        </ModalFrame>
      );
    case 'noc':
      return <NocConsole tab={modal.tab} />;
    case 'dashboard':
      // v1 name of the monitor-wall screen: the NOC's SMS tab is today's dashboard.
      return <NocConsole tab="sms" />;
    case 'gauge':
      return <GaugeModal target={modal.target} />;
    case 'hint':
      return <HintChat initialScenario={modal.scenarioId} />;
    case 'rack':
      return <RackGame />;
    case 'cable':
      return <CableGame mode={modal.mode} />;
    case 'power':
      return <PowerGame />;
    case 'repair':
      // Facilities are monitor-only in v2: the repair spot shows the unit's gauges instead.
      return <GaugeModal target={modal.target} />;
    case 'board':
      if (modal.board === 'decompose') return <DecomposeBoard />;
      if (modal.board === 'dockerfile') return <DockerfileBoard />;
      if (modal.board === 'desired') return <DesiredBoard />;
      return <PostmortemBoard />;
    case 'quiz':
      return <Quiz />;
    case 'concepts':
      return <ConceptsBook />;
    case 'inspect':
      return (
        <ModalFrame title="살펴보기" icon="🔎" size="narrow">
          <p style={{ lineHeight: 1.7, margin: 0 }}>{modal.text}</p>
        </ModalFrame>
      );
  }
}
