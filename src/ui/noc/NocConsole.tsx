// The NOC console on the monitor wall (N / Tab): NMS (network), SMS (servers and services), FMS (facilities).
import { useEffect } from 'react';
import type { NocTab } from '../../content/types';
import type { StageRun } from '../../sim/engine';
import { own } from '../../sim/util';
import { gameStore, useGame } from '../../store/game';
import { ModalFrame } from '../ModalFrame';
import { useStageState } from '../useStageState';
import { AlarmList } from './AlarmList';
import { DevicePane } from './DevicePane';
import { isFacilityDevice } from './facility';
import { FmsTab } from './Fms';
import { SmsTab } from './Sms';
import { TopologyMap } from './Topology';
import './Noc.css';

type ShownTab = Exclude<NocTab, 'nac'>;

const TABS: { id: ShownTab; name: string; gloss: string }[] = [
  { id: 'nms', name: 'NMS', gloss: '네트워크 장비' },
  { id: 'sms', name: 'SMS', gloss: '서버 · 서비스' },
  { id: 'fms', name: 'FMS', gloss: '시설 (전기 · 냉각)' },
];

const shown = (t: NocTab | undefined): ShownTab | undefined => (t === 'nac' ? undefined : t);

function NmsTab({ run, selected, onSelect }: { run: StageRun; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="nms">
      <AlarmList run={run} onSelect={onSelect} />
      <div className="nms-top">
        <section className="nms-mapbox" aria-label="네트워크 구성도">
          <header className="nms-sec-head">
            <h3>🗺 네트워크 구성도</h3>
            <p className="muted">선 색이 길의 상태예요. 장비를 누르면 포트와 로그를 볼 수 있어요.</p>
          </header>
          <TopologyMap w={run.world} alarms={run.alarms} selected={selected} onSelect={onSelect} />
          <div className="nms-legend muted">
            <span>
              <i className="sw green" /> 정상
            </span>
            <span>
              <i className="sw yellow" /> 혼잡 (70%↑)
            </span>
            <span>
              <i className="sw red" /> 포화 (90%↑)
            </span>
            <span>
              <i className="sw down" /> 끊김
            </span>
            <span>
              <i className="sw dashed" /> 예비 길 (STP 차단)
            </span>
            <span>
              <i className="sw spare" /> 꺼 둔 예비 길
            </span>
          </div>
        </section>
        <section className="nms-detail" aria-label="장비 상세">
          {selected ? (
            <DevicePane run={run} id={selected} />
          ) : (
            <p className="nms-pick muted">👈 구성도에서 장비를 눌러 보세요. 포트 상태, LED, 에러 숫자, 장비 로그가 여기 나와요.</p>
          )}
        </section>
      </div>
    </div>
  );
}

export function NocConsole({ tab: asked }: { tab?: NocTab }) {
  const run = useGame((s) => s.run);
  const [tab, setTab] = useStageState<ShownTab>('noc:tab', shown(asked) ?? 'nms');
  const [selected, setSelected] = useStageState<string | null>('noc:device', null);

  // Opened again for a given tab (the FMS button on a gauge window): show that one.
  useEffect(() => {
    const t = shown(asked);
    if (t) setTab(t);
  }, [asked, setTab]);

  useEffect(() => {
    gameStore.getState().event(`noc:${tab}`);
  }, [tab]);

  const select = (id: string) => {
    // Racks and facility units live on the FMS, campus services (KHU LMS …) on the SMS; everything else
    // opens in the NMS detail pane.
    if (isFacilityDevice(id)) return setTab('fms');
    if (run && !own(run.world.devices, id) && own(run.world.campus, id)) return setTab('sms');
    setSelected(id);
    gameStore.getState().event(`noc:device:${id}`);
    // The detail pane sits under the map: bring it into view.
    requestAnimationFrame(() => document.querySelector('.nms-detail')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };

  const open = run?.alarms.filter((a) => a.clearedAt === null) ?? [];
  const count: Record<ShownTab, number> = {
    nms: open.length,
    sms: open.filter((a) => !!run && !own(run.world.devices, a.device) && !!own(run.world.campus, a.device)).length,
    fms: open.filter((a) => isFacilityDevice(a.device)).length,
  };

  return (
    <ModalFrame title="관제 화면 (NOC)" icon="🖥️" size="wide">
      <div className="noc-tabs" role="tablist" aria-label="관제 화면">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`noc-tab${tab === t.id ? ' on' : ''}`}
            onClick={(e) => {
              e.currentTarget.blur();
              setTab(t.id);
            }}
          >
            <b>{t.name}</b>
            <small>{t.gloss}</small>
            {count[t.id] > 0 && <span className="noc-count">{count[t.id]}</span>}
          </button>
        ))}
        <span className="noc-keys muted">
          <kbd>N</kbd> 또는 <kbd>Tab</kbd>을 다시 누르면 닫혀요
        </span>
      </div>
      {!run ? (
        <p className="muted">게임을 시작하면 데이터가 보여요.</p>
      ) : tab === 'nms' ? (
        <NmsTab run={run} selected={selected} onSelect={select} />
      ) : tab === 'sms' ? (
        <SmsTab run={run} />
      ) : (
        <FmsTab run={run} />
      )}
    </ModalFrame>
  );
}
