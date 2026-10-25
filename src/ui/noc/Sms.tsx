// SMS: servers and services. Today's dashboard panels, plus the infra services (DHCP, DNS, L4) and the
// campus services other teams run.
import type { StageRun } from '../../sim/engine';
import { dhcpView, lbView, onWire, powered } from '../../sim/network';
import type { World } from '../../sim/types';
import { DashboardPanels, Section, fmtNum } from '../Dashboard';
import { latencyLevel } from '../levels';

function Meter({ pct, tone }: { pct: number; tone: 'ok' | 'warn' | 'bad' }) {
  return (
    <span className={`sms-meter ${tone}`} aria-hidden>
      <i style={{ width: `${Math.min(100, Math.max(0, pct * 100))}%` }} />
    </span>
  );
}

function CampusPanel({ w }: { w: World }) {
  return (
    <Section title="학내 서비스" hint="다른 팀이 운영하는 학교 서비스예요. 느리거나 멈추면 경보에서 담당팀에 넘길(이관) 수 있어요." half>
      <div className="sms-cards">
        {Object.entries(w.campus ?? {}).map(([id, c]) => {
          const lv = !c.up ? 'bad' : latencyLevel(c.latencyMs);
          return (
            <div key={id} className={`sms-card ${lv}${!c.up || c.latencyMs > 1000 ? ' alert' : ''}`}>
              <b>{c.label}</b>
              <span className={lv}>{!c.up ? '✕ 중단' : lv === 'ok' ? '● 정상' : '▲ 느림'}</span>
              <small className="muted">{c.up ? `응답 ${fmtNum(c.latencyMs)} ms` : '응답 없음'}</small>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function LbPanel({ w }: { w: World }) {
  const lb = w.net?.lb;
  if (!lb) return null;
  const v = lbView(w);
  const healthy = v.members.filter((m) => m.healthy).length;
  const load = lb.maxConn ? v.sessions / lb.maxConn : 0;
  return (
    <Section title="L4 로드밸런서" hint="학생 요청을 여러 서버에 골고루 나눠 보내요. 건강 검사에 실패한 서버에는 보내지 않아요." half>
      <dl className="sms-facts">
        <dt>지금 일하는 장비</dt>
        <dd className={v.active ? 'ok' : 'bad'}>{v.active ? `● ${v.active}` : '✕ 둘 다 응답 없음'}</dd>
        <dt>대표 주소 (VIP)</dt>
        <dd>
          <code>{lb.vip}</code>
        </dd>
        <dt>건강한 서버</dt>
        <dd className={healthy === 0 ? 'bad' : healthy < v.members.length ? 'warn' : 'ok'}>
          {healthy} / {v.members.length}
        </dd>
      </dl>
      <div className="sms-members">
        {v.members.map((m) => (
          <span key={m.name} className={`sms-chip ${!m.enabled ? 'off' : m.healthy ? 'ok' : 'bad'}`} title={`${m.host}:${m.port}`}>
            {m.name} {!m.enabled ? '꺼둠' : m.healthy ? '●' : '✕'}
          </span>
        ))}
      </div>
      <div className="sms-row">
        <span>
          동시 접속 {fmtNum(v.sessions)} / {fmtNum(lb.maxConn)}
        </span>
        <Meter pct={load} tone={load > 0.9 ? 'bad' : load > 0.7 ? 'warn' : 'ok'} />
      </div>
    </Section>
  );
}

function DhcpPanel({ w }: { w: World }) {
  const net = w.net;
  if (!net) return null;
  const pools = Object.values(net.dhcp.pools);
  const up = net.dhcp.running && powered(w, net.dhcp.server);
  return (
    <Section title="DHCP 주소 풀" hint="기기가 네트워크에 들어오면 주소를 하나씩 빌려줘요. 막대가 꽉 차면 새 기기는 주소를 못 받아요." half>
      <p className={`sms-server ${up ? 'ok' : 'bad'}`}>
        {w.devices[net.dhcp.server]?.label ?? net.dhcp.server} {up ? '● 동작 중' : '✕ 멈춤'}
      </p>
      {pools.length === 0 && <p className="muted dash-empty">아직 만든 주소 풀이 없어요.</p>}
      {pools.map((p) => {
        const v = dhcpView(w, p.name);
        const pct = v.size ? v.used / v.size : 0;
        const tone = v.starving > 0 ? 'bad' : pct > 0.85 ? 'warn' : 'ok';
        return (
          <div key={p.name} className="sms-pool">
            <div className="sms-row">
              <b>{p.label}</b>
              <code>
                {p.network}/{p.mask}
              </code>
            </div>
            <Meter pct={pct} tone={tone} />
            <div className="sms-pool-nums">
              사용 {v.used}/{v.size} · 남음 {v.free}
              {v.starving > 0 && <b className="bad"> · 주소를 못 받은 기기 {v.starving}대</b>}
            </div>
          </div>
        );
      })}
    </Section>
  );
}

function DnsPanel({ w }: { w: World }) {
  const ids = w.net?.dnsServers ?? [];
  return (
    <Section title="DNS 서버" hint="'sugang' 같은 이름을 숫자 주소로 바꿔주는 전화번호부예요. 둘 중 하나만 살아 있어도 돼요." half>
      <div className="sms-cards">
        {ids.map((id) => {
          const d = w.devices[id];
          const up = !!d && onWire(w, d);
          return (
            <div key={id} className={`sms-card ${up ? 'ok' : 'bad alert'}`}>
              <b>{d?.label ?? id}</b>
              <span className={up ? 'ok' : 'bad'}>{up ? '● 응답' : '✕ 응답 없음'}</span>
              <small className="muted">
                <code>{d?.l3?.ip ?? '—'}</code>
              </small>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

export function SmsTab({ run }: { run: StageRun }) {
  const w = run.world;
  const infra = w.net && (
    <div className="dash-grid sms-grid">
      {w.campus && <CampusPanel w={w} />}
      {w.net.lb && <LbPanel w={w} />}
      <DhcpPanel w={w} />
      <DnsPanel w={w} />
    </div>
  );
  return <DashboardPanels run={run} extra={infra} />;
}
