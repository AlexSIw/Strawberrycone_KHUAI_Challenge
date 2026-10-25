// 전원실 미니게임: 한전 전기 · UPS · PDU A/B 상태를 보고, 장비마다 A/B 플러그를 꽂는다.
// A = UPS 뒤의 줄(정전 대비), B = 따로 들어오는 두 번째 줄(PDU·회로 고장 대비).
import { setFeeds, setUps } from '../../sim/actions';
import { feedLive, powered } from '../../sim/network';
import type { Device } from '../../sim/types';
import { gameStore } from '../../store/game';
import { GameFooter, Led, MiniGameFrame, TaskBar, rackName, useWorld } from './common';
import './PowerGame.css';

type Feed = 'A' | 'B';

const KIND_ORDER: Record<Device['kind'], number> = { server: 0, switch: 1, router: 2, internet: 5, firewall: 3, lb: 4 };
const KIND_ICON: Record<Device['kind'], string> = { server: '🖥️', switch: '🔀', router: '🌐', internet: '☁️', firewall: '🧱', lb: '⚖️' };

function feedText(feeds: Feed[]): string {
  if (feeds.length === 0) return '없음';
  if (feeds.length === 2) return 'A+B';
  return `${feeds[0]}만`;
}

function Battery({ mode }: { mode: 'idle' | 'full' | 'draining' }) {
  return (
    <span className={`pw-battery ${mode}`} aria-hidden>
      <span className="pw-battery-cap" />
      <span className="pw-battery-cells">
        <i />
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

/** Flip one plug, reading the device's current plugs from the live world (never from a stale render). */
function toggleFeed(id: string, f: Feed) {
  gameStore.getState().act((w) => {
    const cur = w.devices[id]?.feeds ?? [];
    setFeeds(w, id, cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]);
  }, 'power:feed');
}

function toggleUps() {
  gameStore.getState().act((w) => setUps(w, !w.power?.ups), 'power:ups');
}

export function PowerGame() {
  const world = useWorld();
  if (!world) return null;

  if (!world.power) {
    return (
      <MiniGameFrame title="전원실 · PDU" icon="⚡" size="narrow" footer={<GameFooter done={false} />}>
        <TaskBar done>전원 정상 — 지금은 여기서 할 일이 없어요.</TaskBar>
        <p className="muted" style={{ margin: 0, lineHeight: 1.7 }}>
          모든 장비가 안정적으로 전기를 받고 있어요.
        </p>
      </MiniGameFrame>
    );
  }

  const { mains, ups, pduDown } = world.power;
  const all = Object.values(world.devices).filter((d) => d.kind !== 'internet' && d.id !== 'ops');
  const rows = all.filter((d) => d.installed).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  const notMounted = all.filter((d) => !d.installed);
  const pduA = feedLive(world, 'A');
  const pduB = feedLive(world, 'B');
  const plugged = (f: Feed) => rows.filter((d) => d.feeds.includes(f)).length;
  const offRows = rows.filter((d) => !powered(world, d.id));
  const unplugged = rows.filter((d) => d.feeds.length === 0);
  const done = mains && rows.length > 0 && offRows.length === 0 && notMounted.length === 0;

  let task: string;
  if (rows.length === 0) task = '아직 랙에 장착된 장비가 없어요. 먼저 서버실에서 서버를 장착하세요.';
  else if (!mains && offRows.length) task = `⚡ 정전! 장비 ${offRows.length}대가 꺼졌어요. 정전에도 버티게 만들 방법을 찾아보세요.`;
  else if (!mains) task = '정전이지만 모든 장비가 UPS 배터리로 버티고 있어요!';
  else if (pduDown && offRows.length) task = `PDU ${pduDown} 차단기가 내려갔어요! 장비 ${offRows.length}대가 꺼졌어요. 줄 하나가 끊겨도 버티게 만들 방법을 찾아보세요.`;
  else if (pduDown) task = `PDU ${pduDown} 차단기가 내려갔지만 모든 장비가 다른 줄로 버티고 있어요!`;
  else if (notMounted.length) task = `서버 ${notMounted.length}대가 아직 랙에 없어요. 서버실에서 먼저 장착한 뒤 전원을 꽂으세요.`;
  else if (unplugged.length) task = '장비마다 플러그 A 또는 B를 눌러 꽂아서 전원을 넣으세요.';
  else if (offRows.length) task = '꺼진 장비가 있어요. 플러그를 확인하세요.';
  else task = '완료! 모든 장비에 전원이 들어왔어요.';

  const batteryMode = !ups ? 'idle' : mains ? 'full' : 'draining';
  const upsState = !ups ? '연결 안 됨 · A는 한전 전기만 받아요' : mains ? '충전 완료' : '배터리로 버티는 중';

  return (
    <MiniGameFrame
      title="전원실 · UPS와 PDU"
      icon="⚡"
      size="wide"
      footer={<GameFooter done={done}>{done ? '모든 장비가 ON! 상태 LED와 PDU 불빛으로 전기가 어디서 오는지 늘 확인할 수 있어요.' : null}</GameFooter>}
    >
      <TaskBar done={done}>{task}</TaskBar>

      {/* power path: mains → (UPS) → PDU A, mains → PDU B */}
      <div className="pw-diagram">
        <div className={`pw-node pw-mains${mains ? ' live' : ' dead'}`}>
          <div className="pw-node-title">🏭 한전 전기</div>
          <div className="pw-node-sub">건물 바깥에서 오는 전기</div>
          <div className={`pw-big ${mains ? 'ok' : 'bad'}`} role="status">
            {mains ? '정상' : '⚡정전!'}
          </div>
        </div>

        <div className={`pw-line pw-l1${mains ? ' live' : ''}`} aria-hidden />

        <div className={`pw-node pw-ups${ups ? ' on' : ''}`}>
          <div className="pw-ups-head">
            <span className="pw-node-title">🔋 UPS</span>
            <Battery mode={batteryMode} />
            <span className="pw-ups-state">{upsState}</span>
          </div>
          <button type="button" className={`pw-switch${ups ? ' on' : ''}`} role="switch" aria-checked={ups} onClick={toggleUps}>
            <span className="pw-switch-knob" aria-hidden />
            <span className="pw-switch-text">UPS → PDU A 연결: {ups ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        <div className={`pw-line pw-l2${pduA ? ' live' : ''}`} aria-hidden />

        <div className={`pw-node pw-pdu pw-pdu-a${pduA ? ' live' : ' dead'}`}>
          <div className="pw-node-title">PDU A</div>
          <div className="pw-pdu-row">
            <Led state={pduA ? 'on' : 'off'} /> {pduDown === 'A' ? '차단기 내려감 (점검 중)' : pduA ? '전기 있음' : '전기 없음'} · <span className="pw-pdu-count">{plugged('A')}대</span>
          </div>
        </div>

        <div className={`pw-line pw-l3${pduB ? ' live' : ''}`} aria-hidden />

        <div className={`pw-node pw-pdu pw-pdu-b${pduB ? ' live' : ' dead'}`}>
          <div className="pw-node-title">PDU B</div>
          <div className="pw-pdu-row">
            <Led state={pduB ? 'on' : 'off'} /> {pduDown === 'B' ? '차단기 내려감 (점검 중)' : pduB ? '전기 있음' : '전기 없음'} · <span className="pw-pdu-count">{plugged('B')}대</span>
          </div>
        </div>
      </div>

      <div className="pw-legend">
        {/* Wiring only: what each line is good for is what the incidents teach (see the stage 1 lessons). */}
        <b>A</b> = UPS를 거쳐 오는 줄 · <b>B</b> = 바깥 전기에서 바로 오는 줄
      </div>

      <table className="pw-table">
        <thead>
          <tr>
            <th>장비</th>
            <th>위치</th>
            <th>플러그 A</th>
            <th>플러그 B</th>
            <th>받는 줄</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d, i) => {
            const on = powered(world, d.id);
            return (
              <tr key={d.id} className={on ? 'on' : 'off'}>
                <td>
                  <span className="pw-dev">
                    <span aria-hidden>{KIND_ICON[d.kind]}</span> {d.label} <span className="pw-id">{d.id}</span>
                  </span>
                </td>
                <td className="muted">{d.rack ? rackName(d.rack) : '네트워크실'}</td>
                {(['A', 'B'] as const).map((f) => {
                  const inn = d.feeds.includes(f);
                  return (
                    <td key={f}>
                      <button
                        type="button"
                        className={`pw-plug${inn ? ' in' : ''}`}
                        aria-pressed={inn}
                        aria-label={`${d.label} 플러그 ${f} ${inn ? '뽑기' : '꽂기'}`}
                        data-autofocus={i === 0 && f === 'A' ? true : undefined}
                        onClick={() => toggleFeed(d.id, f)}
                      >
                        <span className="pw-socket" aria-hidden>
                          <i />
                          <i />
                        </span>
                        {inn ? `🔌 ${f} 꽂힘` : `${f} 비어 있음`}
                      </button>
                    </td>
                  );
                })}
                <td className="pw-feeds">{feedText(d.feeds)}</td>
                <td>
                  <span className={`pw-onoff ${on ? 'on' : 'off'}`}>
                    <Led state={on ? 'on' : 'off'} size={12} /> {on ? 'ON' : 'OFF'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {notMounted.length > 0 && (
        <p className="pw-note muted">
          📦 아직 랙에 없는 장비 {notMounted.length}대 ({notMounted.map((d) => d.label).join(', ')}) — 서버실에서 먼저 장착하면 여기에 나타나요.
        </p>
      )}
    </MiniGameFrame>
  );
}
