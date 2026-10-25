// NMS device detail: what the monitoring system knows about one box (ports, LEDs, counters, syslog).
import { getStage } from '../../content/stages';
import { physicalPorts, portLed, stpBlocked, type LedState } from '../../game/worldView';
import { syslogStamp } from '../../sim/clock';
import type { StageRun } from '../../sim/engine';
import { cableAt, cablePeer, logicalLinks, operState, powered, utilization } from '../../sim/network';
import type { Iface, IfOper } from '../../sim/types';
import { rackName } from '../minigames/common';
import { canSsh, sshTo } from './ssh';

const OPER_TEXT: Record<IfOper, string> = { up: 'up', down: 'down', 'admin-down': 'shutdown', 'err-disabled': 'err-disabled' };
const OPER_CLS: Record<IfOper, string> = { up: 'ok', down: 'muted', 'admin-down': 'warn', 'err-disabled': 'bad' };

const LED_TEXT: Record<LedState, string> = {
  off: '꺼짐 (연결 없음)',
  green: '초록 (연결됨, 깜빡임 = 데이터가 지나가는 중)',
  amber: '주황 (막힘 · 꺼둠 · 에러로 차단)',
  crc: '초록/주황 번갈아 (CRC 에러가 늘고 있음)',
  red: '빨강',
};

const KIND_TEXT = { server: '서버', switch: '스위치', router: '라우터', firewall: '방화벽', lb: 'L4 로드밸런서', internet: '인터넷' } as const;

/** `vlans`: the VLANs made on the switch (VLAN 1 always exists); an access port in a VLAN not made yet is inactive, as in IOS. */
function modeText(f: Iface, vlans: Record<number, string>): string {
  const base =
    f.mode === 'access'
      ? f.accessVlan === 1 || f.accessVlan in vlans
        ? `VLAN ${f.accessVlan}`
        : `VLAN ${f.accessVlan} (아직 없는 VLAN · inactive)`
      : f.mode === 'trunk'
        ? `trunk ${f.allowed === 'all' ? 'all' : f.allowed.join(',')}`
        : f.ip
          ? `${f.ip.addr}/${f.ip.mask}`
          : 'routed';
  return f.group !== undefined ? `${base} · Po${f.group}` : base;
}

/** Syslog severity digit (LINK-3-UPDOWN → 3) as a colour class. */
function sevClass(tag: string): string {
  const n = Number(/-(\d)-/.exec(tag)?.[1] ?? 6);
  return n <= 3 ? 'bad' : n === 4 ? 'warn' : '';
}

export function DevicePane({ run, id }: { run: StageRun; id: string }) {
  const w = run.world;
  const def = getStage(run.stage);
  const d = w.devices[id];
  if (!d) return <p className="muted">장비 정보가 없어요.</p>;
  const nd = d.nd;
  const on = powered(w, id);
  const ssh = canSsh(run.stage) && on && id !== 'ops';

  const head = (
    <header className="nms-dev-head">
      <div>
        <h3>{d.label}</h3>
        <p className="muted">
          {nd?.model ?? KIND_TEXT[d.kind]} · {d.rack ? rackName(d.rack) : d.kind === 'server' ? '관제실' : '캠퍼스 건물'}
        </p>
      </div>
      <span className={`nms-power ${on ? 'ok' : 'bad'}`}>{on ? '● 전원 ON' : '✕ 전원 OFF'}</span>
    </header>
  );
  const sshButton = ssh && (
    <button className="btn nms-ssh" onClick={() => sshTo(id)} title={`관리 PC 터미널에서 ssh ${id}`}>
      🔑 SSH 접속
    </button>
  );

  if (!nd) {
    const port = d.ports[0] ?? 'eth0';
    const peer = cablePeer(w, id, port);
    const oper = operState(w, id, port);
    const node = w.k8s?.nodes[id];
    return (
      <div className="nms-dev">
        {head}
        <dl className="nms-facts">
          <dt>주소</dt>
          <dd>
            <code>{d.l3?.ip ?? '—'}</code>
          </dd>
          <dt>전원 줄</dt>
          <dd>{d.feeds.length ? `PDU ${d.feeds.join('+')}` : '없음'}</dd>
          <dt>{port}</dt>
          <dd className={OPER_CLS[oper]}>
            {OPER_TEXT[oper]}
            {peer ? ` → ${w.devices[peer[0]]?.label ?? peer[0]} ${peer[1]}` : ' (케이블 없음)'}
          </dd>
          {node && (
            <>
              <dt>k8s 노드</dt>
              <dd className={node.ready ? 'ok' : 'bad'}>{node.ready ? 'Ready' : 'NotReady'}</dd>
            </>
          )}
        </dl>
        {sshButton}
      </div>
    );
  }

  const blocked = stpBlocked(w);
  const links = logicalLinks(w);
  const linkOf = (ifn: string) => {
    const g = nd.ifs[ifn]?.group;
    const names = g === undefined ? [ifn] : [ifn, `Po${g}`];
    return links.find((l) => (l.a.dev === id && names.includes(l.a.ifn)) || (l.b.dev === id && names.includes(l.b.ifn)));
  };
  const ports = physicalPorts(d);
  const logs = nd.log.slice(-15);

  return (
    <div className="nms-dev">
      {head}
      <p className="nms-mgmt">
        관리 주소 <code>{nd.mgmtIp}</code>
        {nd.dirty && <span className="tag nms-dirty">저장 안 한 설정 있음</span>}
      </p>

      <div className="nms-panel-face" aria-label="앞면 포트 LED">
        {ports.map((p, i) => {
          const led = portLed(w, id, p, blocked);
          const l = linkOf(p);
          const util = l ? utilization(w, l.key) : 0;
          return (
            <span key={p} className="nms-port" title={`${p}: ${LED_TEXT[led]}`}>
              <i className={`nms-led ${led}`} style={led === 'green' ? { animationDuration: `${Math.max(0.15, 1.1 - util).toFixed(2)}s` } : undefined} />
              <small>{i + 1}</small>
            </span>
          );
        })}
      </div>

      <div className="nms-table-wrap">
        <table className="dash-table nms-ports">
          <thead>
            <tr>
              <th>포트</th>
              <th>상태</th>
              <th>VLAN / 모드</th>
              <th>연결된 곳</th>
              <th>사용률</th>
              <th>CRC</th>
            </tr>
          </thead>
          <tbody>
            {ports.map((p) => {
              const f = nd.ifs[p];
              const oper = operState(w, id, p);
              const peer = cablePeer(w, id, p);
              const l = linkOf(p);
              const util = l && l.up ? Math.round(utilization(w, l.key) * 100) : null;
              const rising = cableAt(w, `${id}:${p}`)?.degraded && oper === 'up';
              return (
                <tr key={p}>
                  <td>
                    <code>{p}</code>
                  </td>
                  <td className={OPER_CLS[oper]}>{OPER_TEXT[oper]}</td>
                  <td>{f ? modeText(f, nd.vlans) : '—'}</td>
                  <td className="muted">{peer ? `${w.devices[peer[0]]?.label ?? peer[0]} ${peer[1]}` : '—'}</td>
                  <td className={util === null ? 'muted' : util > 90 ? 'bad' : util > 70 ? 'warn' : ''}>{util === null ? '—' : `${util}%`}</td>
                  <td className={f?.crc ? 'bad' : 'muted'}>
                    {f?.crc ?? 0}
                    {rising && ' ▲'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h4 className="nms-sub">장비 로그 (syslog)</h4>
      {logs.length === 0 ? (
        <p className="muted nms-empty">아직 기록된 로그가 없어요.</p>
      ) : (
        <pre className="nms-syslog">
          {logs.map((e, i) => (
            <span key={i} className={sevClass(e.tag)}>
              {`${syslogStamp(def.clock, def.date, e.t)}: %${e.tag}: ${e.msg}`}
              {'\n'}
            </span>
          ))}
        </pre>
      )}
      {sshButton}
    </div>
  );
}
