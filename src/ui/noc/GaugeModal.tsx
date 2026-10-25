// A facility unit's read-only gauges (the UPS, the PDU cabinet, the CRAC on the map).
import { gameStore, useGame } from '../../store/game';
import { ModalFrame } from '../ModalFrame';
import { CoolingGauges, PowerGauges } from './Fms';
import './Noc.css';

const TITLE = { ups: 'UPS (무정전 전원장치)', pdu: '분전반 · PDU A/B', crac: '항온항습기 (CRAC)' } as const;
const ICON = { ups: '🔋', pdu: '⚡', crac: '❄️' } as const;

export function GaugeModal({ target }: { target: 'ups' | 'pdu' | 'crac' }) {
  const w = useGame((s) => s.run?.world);
  return (
    <ModalFrame
      title={TITLE[target]}
      icon={ICON[target]}
      size="narrow"
      footer={
        <button className="btn" onClick={() => gameStore.getState().openModal({ type: 'noc', tab: 'fms' })}>
          🖥️ 관제 화면 FMS 보기
        </button>
      }
    >
      <p className="fms-note">🏢 시설은 시설팀 담당이에요. 우리는 지켜보고 알려요.</p>
      {w && (target === 'crac' ? <CoolingGauges w={w} /> : <PowerGauges w={w} only={target} />)}
    </ModalFrame>
  );
}
