// The NOC alarm list: every alarm the monitoring has raised today, worst first. ACK starts the clock
// that MTTD stops; shallow alarms can be handed to the team that owns the service.
import { getStage } from '../../content/stages';
import { openAlarms, POLL_EVERY, type Alarm } from '../../sim/alarms';
import { fmtClock, gameSec } from '../../sim/clock';
import type { StageRun } from '../../sim/engine';
import type { AlarmSev } from '../../sim/scenario';
import { LAST_DAY } from '../../sim/types';
import { own } from '../../sim/util';
import { gameStore } from '../../store/game';
import { useStageState } from '../useStageState';
import { placeName } from './facility';

export const SEV_LABEL: Record<AlarmSev, string> = { critical: 'Critical', major: 'Major', minor: 'Minor', warning: 'Warning' };
const SOURCE_LABEL: Record<Alarm['source'], string> = { trap: '트랩', syslog: 'syslog', poll: '폴링' };

export function AlarmList({ run, onSelect }: { run: StageRun; onSelect: (device: string) => void }) {
  const [showCleared, setShowCleared] = useStageState('noc:cleared', false);
  const def = getStage(run.stage);
  const store = gameStore.getState();
  const open = openAlarms(run.alarms);
  const cleared = run.alarms.filter((a) => a.clearedAt !== null).sort((a, b) => (b.clearedAt ?? 0) - (a.clearedAt ?? 0));
  const at = (t: number) => fmtClock(gameSec(def.clock, t), run.stage === LAST_DAY);
  // A campus service (KHU LMS …) is no NMS device: its alarm points at the service's SMS card.
  const devName = (id: string) => own(run.world.devices, id)?.label ?? own(run.world.campus, id)?.label ?? placeName(id);
  const isService = (id: string) => !own(run.world.devices, id) && !!own(run.world.campus, id);
  const every = def.pollEvery ?? POLL_EVERY;

  const row = (a: Alarm) => {
    const sc = a.scenarioId ? def.scenarios.find((s) => s.id === a.scenarioId) : undefined;
    const rt = a.scenarioId ? run.scenarios.find((r) => r.id === a.scenarioId) : undefined;
    const isOpen = a.clearedAt === null;
    return (
      <li key={a.id} className={`nms-alarm ${a.sev}${a.ackAt !== null ? ' acked' : ''}${isOpen ? '' : ' cleared'}`}>
        <span className={`nms-sev ${a.sev}`}>{SEV_LABEL[a.sev]}</span>
        <span className="nms-alarm-time" title={`${SOURCE_LABEL[a.source]}로 알게 됨`}>
          {at(a.raisedAt)}
        </span>
        <button
          type="button"
          className="nms-alarm-dev"
          onClick={() => onSelect(a.device)}
          title={isService(a.device) ? '서비스 관제(SMS)에서 이 서비스 보기' : '구성도에서 이 장비 보기'}
        >
          {devName(a.device)}
        </button>
        <span className="nms-alarm-text">{a.text}</span>
        <span className="nms-alarm-acts">
          {!isOpen ? (
            <span className="ok">✔ 해결 {at(a.clearedAt ?? 0)}</span>
          ) : a.ackAt === null ? (
            <button className="btn nms-act primary" onClick={() => store.ackAlarm(a.id)} title="경보를 봤다고 표시해요. 여기까지가 탐지 시간(MTTD)이에요.">
              확인(ACK)
            </button>
          ) : (
            <span className="muted">✔ 확인 {at(a.ackAt)}</span>
          )}
          {isOpen && a.scenarioId && (
            <button className="btn nms-act" onClick={() => store.openModal({ type: 'hint', scenarioId: a.scenarioId ?? undefined })}>
              📻 쿠사수에게 묻기
            </button>
          )}
          {isOpen && sc?.escalate && rt && (rt.escalatedAt === null ? (
            <button className="btn nms-act" onClick={() => store.escalate(sc.id)} title={`${sc.escalate.team}에 넘겨요. 처리될 때까지 시간이 걸려요.`}>
              📨 담당팀 이관
            </button>
          ) : (
            <span className="muted">📨 {sc.escalate.team} 처리 중</span>
          ))}
        </span>
      </li>
    );
  };

  return (
    <section className="nms-alarms" aria-label="경보 목록">
      <header className="nms-sec-head">
        <h3>🔔 경보 (Alarm)</h3>
        <p className="muted">장비와 감시 시스템이 이상하다고 알린 것들이에요. 위에 있을수록 급해요. 봤으면 확인(ACK)을 눌러요.</p>
      </header>
      {open.length === 0 ? (
        <p className="nms-calm">✅ 지금 울리는 경보가 없어요.</p>
      ) : (
        <ol className="nms-alarm-list">{open.map(row)}</ol>
      )}
      {cleared.length > 0 && (
        <>
          <button type="button" className="nms-fold" onClick={() => setShowCleared((v) => !v)} aria-expanded={showCleared}>
            {showCleared ? '▾' : '▸'} 해결됨 {cleared.length}건
          </button>
          {showCleared && <ol className="nms-alarm-list">{cleared.map(row)}</ol>}
        </>
      )}
      <p className="nms-poll muted">📡 SNMP로 {every}초마다 장비 상태를 물어봐요. 그래서 어떤 경보는 늦게 떠요.</p>
    </section>
  );
}
