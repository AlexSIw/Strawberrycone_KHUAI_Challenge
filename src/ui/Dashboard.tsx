import { useMemo, type ReactNode } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getStage } from '../content/stages';
import type { StageDef } from '../content/types';
import type { MetricPoint, StageRun } from '../sim/engine';
import { readyPods } from '../sim/k8s';
import { cableAt, linkUp, powered } from '../sim/network';
import type { Device, Health, World } from '../sim/types';
import { useGame } from '../store/game';
import { availLevel, latencyLevel, type Level } from './levels';
import { ModalFrame } from './ModalFrame';
import './Dashboard.css';

type Panel = StageDef['panels'][number];

/**
 * Panels always show in this order, whatever order the stage lists them in. Pods come before the
 * full-width traffic charts: in the Kubernetes stages they are the main diagnostic.
 */
const PANEL_ORDER: Panel[] = ['services', 'temp', 'pods', 'traffic', 'links', 'power'];

// Chart chrome (validated single-series blue on the dark panel surface).
const SERIES = '#3987e5';
const GRID = '#3a3040';
const AXIS = '#b3a5ae';
const WARN_LINE = '#ffb547';
const CRIT_LINE = '#ff5a5f';
const TEMP_WARN = 35;
const TEMP_CRIT = 45;

const LEVEL_TEXT: Record<Level, string> = { ok: '● 좋음', warn: '▲ 주의', bad: '✕ 위험' };

function levelOf(kind: 'availability' | 'latency' | 'error' | 'temp', v: number): Level {
  switch (kind) {
    case 'availability':
      return availLevel(v);
    case 'latency':
      return latencyLevel(v);
    case 'error':
      return v < 0.01 ? 'ok' : v < 0.1 ? 'warn' : 'bad';
    case 'temp':
      return v < TEMP_WARN ? 'ok' : v < TEMP_CRIT ? 'warn' : 'bad';
  }
}

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
const fmtNum = (v: number) => Math.round(v).toLocaleString('ko-KR');

// ---------- KPI header ----------

function Kpi({ label, value, explain, level }: { label: string; value: string; explain: string; level?: Level }) {
  return (
    <div className={`dash-kpi ${level ?? ''}`}>
      <div className="dash-kpi-label">
        {label}
        {level && <span className={`dash-kpi-state ${level}`}>{LEVEL_TEXT[level]}</span>}
      </div>
      <div className="dash-kpi-value">{value}</div>
      <div className="dash-kpi-explain">{explain}</div>
    </div>
  );
}

function KpiRow({ h }: { h: Health }) {
  // No students yet (stage 1): there are no requests to fail, so only the readiness number means something.
  const idle = h.rps <= 0;
  return (
    <div className="dash-kpis">
      <Kpi
        label="가용성"
        value={pct(h.availability)}
        explain={idle ? '학생 접속 전이라, 서버가 준비된 정도로 보여줘요' : '학생 요청 중 성공한 비율'}
        level={levelOf('availability', h.availability)}
      />
      <Kpi
        label="응답시간"
        value={idle ? '—' : `${fmtNum(h.latencyMs)} ms`}
        explain="요청 하나에 답하는 데 걸린 시간"
        level={idle ? undefined : levelOf('latency', h.latencyMs)}
      />
      <Kpi
        label="에러율"
        value={idle ? '—' : pct(h.errorRate)}
        explain={idle ? '아직 요청이 없어서 계산 전이에요' : '실패한 요청의 비율'}
        level={idle ? undefined : levelOf('error', h.errorRate)}
      />
      <Kpi label="접속" value={`${fmtNum(h.rps)} rps`} explain="1초에 들어오는 요청 수 (requests per second)" />
    </div>
  );
}

// ---------- shared bits ----------

function Section({ title, hint, half, children }: { title: string; hint: string; half?: boolean; children: ReactNode }) {
  return (
    <section className={`dash-section ${half ? 'half' : ''}`}>
      <header>
        <h3>{title}</h3>
        <p className="muted">{hint}</p>
      </header>
      {children}
    </section>
  );
}

/** `title` spells the state out for screen readers / hover, since the LED itself is only a color. */
function Led({ on, tone, label, title }: { on: boolean; tone?: 'ok' | 'bad' | 'warn'; label: string; title?: string }) {
  return (
    <span className={`dash-led ${on ? tone ?? 'ok' : 'off'}`} title={title ?? label} aria-label={title}>
      <i aria-hidden />
      {label}
    </span>
  );
}

interface ChartRow {
  t: number;
  availability: number;
  errorRate: number;
  latency: number;
  rps: number;
  temp: number;
}

const toRows = (history: MetricPoint[]): ChartRow[] =>
  history.map((p) => ({
    t: p.t,
    availability: p.availability * 100,
    errorRate: p.errorRate * 100,
    latency: p.latencyMs,
    rps: p.rps,
    temp: p.maxTemp,
  }));

const tooltipStyle = {
  contentStyle: { background: '#2c2433', border: '1px solid #4a3c52', borderRadius: 8, fontSize: 12, color: '#f4ece4' },
  labelStyle: { color: '#b3a5ae' },
  itemStyle: { color: '#f4ece4' },
};

interface MiniChartProps {
  title: string;
  rows: ChartRow[];
  dataKey: keyof Omit<ChartRow, 't'>;
  unit: string;
  format: (v: number) => string;
  domain?: [number | 'auto', number | 'auto'];
  height?: number;
  refs?: { y: number; color: string; label: string }[];
}

function MiniChart({ title, rows, dataKey, unit, format, domain = [0, 'auto'], height = 150, refs = [] }: MiniChartProps) {
  const last = rows[rows.length - 1];
  return (
    <div className="dash-chart">
      <div className="dash-chart-head">
        <span>{title}</span>
        <b>{last ? format(last[dataKey]) : '—'}</b>
      </div>
      {rows.length < 2 ? (
        <div className="dash-chart-empty muted" style={{ height }}>
          시간이 흐르면 그래프가 그려져요.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="t"
              tickFormatter={(t: number) => `${t}s`}
              stroke={GRID}
              tick={{ fill: AXIS, fontSize: 11 }}
              minTickGap={32}
              tickLine={false}
            />
            <YAxis domain={domain} stroke={GRID} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} width={48} allowDecimals={false} />
            {refs.map((r) => (
              <ReferenceLine
                key={r.y}
                y={r.y}
                stroke={r.color}
                strokeWidth={1}
                label={{ value: r.label, position: 'insideTopRight', fill: r.color, fontSize: 11 }}
              />
            ))}
            <Tooltip
              {...tooltipStyle}
              cursor={{ stroke: AXIS, strokeWidth: 1 }}
              labelFormatter={(t) => `${t}초`}
              formatter={(v) => [format(Number(v)), title + (unit ? ` (${unit})` : '')]}
            />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={SERIES}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: '#221c28', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ---------- panels ----------

function TrafficPanel({ rows }: { rows: ChartRow[] }) {
  return (
    <Section title="트래픽 (Traffic)" hint="최근 2분 동안의 흐름이에요. 선이 갑자기 꺾이면 그때 문제가 생긴 거예요.">
      <div className="dash-charts">
        <MiniChart title="가용성" unit="%" rows={rows} dataKey="availability" domain={[0, 100]} format={(v) => `${v.toFixed(1)}%`} />
        <MiniChart title="응답시간" unit="ms" rows={rows} dataKey="latency" format={(v) => `${fmtNum(v)} ms`} />
        <MiniChart title="에러율" unit="%" rows={rows} dataKey="errorRate" domain={[0, 'auto']} format={(v) => `${v.toFixed(1)}%`} />
        <MiniChart title="접속 (rps)" unit="" rows={rows} dataKey="rps" format={(v) => `${fmtNum(v)} rps`} />
      </div>
    </Section>
  );
}

const STATUS_TEXT = { up: '● 정상', degraded: '▲ 불안정', down: '✕ 중단' } as const;

const SERVICE_NAMES: Record<string, string> = {
  web: '웹 서버',
  db: 'DB 서버',
  spare: '예비 서버',
  app: '수강신청 웹앱',
  monolith: '수강신청 앱 (모놀리스)',
  login: '로그인',
  course: '과목조회',
  enroll: '수강신청',
  notify: '알림',
};

function serviceLabel(w: World, name: string): string {
  return w.app?.services[name]?.label ?? SERVICE_NAMES[name] ?? w.devices[name]?.label ?? name;
}

type SvcState = Health['services'][string];

/**
 * A Kubernetes app with no ready pod answers nobody, even when the sim calls it "up"
 * (enroll starts stage 6 with 0 replicas). Show it as stopped so the card agrees with the 0% KPI.
 */
function shownState(w: World, name: string, st: SvcState): SvcState {
  const k = w.k8s;
  if (k?.deployments[name] && readyPods(k, name).length === 0) return 'down';
  return st;
}

function ServicesPanel({ h, w, half }: { h: Health; w: World; half: boolean }) {
  const entries = Object.entries(h.services).map(([name, st]) => [name, shownState(w, name, st)] as const);
  return (
    <Section title="서비스 상태 (Services)" hint="초록은 정상, 노랑은 느리거나 불안정, 빨강은 멈춘 서비스예요." half={half}>
      {entries.length === 0 ? (
        <p className="muted dash-empty">아직 지켜볼 서비스가 없어요.</p>
      ) : (
        <div className="dash-services">
          {entries.map(([name, st]) => (
            <div key={name} className={`dash-svc ${st}`}>
              <div className="dash-svc-name">{serviceLabel(w, name)}</div>
              <code className="dash-svc-id">{name}</code>
              <div className={`dash-svc-state ${st}`}>{STATUS_TEXT[st]}</div>
            </div>
          ))}
        </div>
      )}
      <div className="dash-notes">
        <h4>지금 보이는 문제</h4>
        {h.notes.length === 0 ? (
          <p className="ok">✅ 눈에 띄는 문제 없음</p>
        ) : (
          <ul>
            {h.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

const visibleDevices = (w: World): Device[] => Object.values(w.devices).filter((d) => d.kind !== 'internet');

const KIND_ICON: Record<Device['kind'], string> = { server: '🖥️', switch: '🔀', router: '🌐', internet: '☁️' };

function LinksPanel({ w }: { w: World }) {
  return (
    <Section title="장비 · 링크 (L1)" hint="전원 불과 포트 불을 보세요. 포트가 빨가면 케이블은 꽂혔는데 신호가 안 가는 거예요.">
      <div className="dash-legend muted">
        <Led on tone="ok" label="신호 OK" />
        <Led on tone="bad" label="케이블 있음 · 신호 없음" />
        <Led on={false} label="비어 있음" />
      </div>
      <div className="dash-devices">
        {visibleDevices(w).map((d) => {
          const on = powered(w, d.id);
          return (
            <div key={d.id} className="dash-device">
              <div className="dash-device-head">
                <span>
                  {KIND_ICON[d.kind]} {d.label} <code>{d.id}</code>
                </span>
                {!d.installed ? (
                  <span className="tag">📦 아직 랙에 안 꽂음</span>
                ) : (
                  <Led on={on} tone="ok" label={on ? '전원 ON' : '전원 OFF'} />
                )}
              </div>
              <div className="dash-ports">
                {d.ports.map((p) => {
                  const cable = cableAt(w, `${d.id}:${p}`);
                  const up = linkUp(w, d.id, p);
                  const state = !cable ? '비어 있음' : up ? '신호 OK' : '케이블 있음 · 신호 없음';
                  return <Led key={p} on={!!cable} tone={up ? 'ok' : 'bad'} label={p} title={`${p}: ${state}`} />;
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function PowerPanel({ w, h }: { w: World; h: Health }) {
  const p = w.power;
  if (!p) {
    return (
      <Section title="전원 (Power)" hint="이 단계에서는 전원을 따로 보지 않아요.">
        <p className="muted dash-empty">전원 정보 없음</p>
      </Section>
    );
  }
  return (
    <Section title="전원 (Power)" hint="장비마다 전기를 어느 줄(PDU A/B)로 받는지 보여줘요. 꺼진 장비가 있으면 그 줄을 따라가 보세요.">
      <div className="dash-power-top">
        <div className={`dash-tile ${p.mains ? 'ok' : 'bad'}`}>
          <span>한전 전기 (바깥 전기)</span>
          <b>{p.mains ? '⚡ 정상' : '✕ 정전'}</b>
        </div>
        <div className={`dash-tile ${p.ups ? 'ok' : 'warn'}`}>
          <span>UPS (무정전 전원장치)</span>
          <b>{p.ups ? '● PDU A에 연결됨' : '▲ 연결 안 됨'}</b>
        </div>
        {p.pduDown && (
          <div className="dash-tile bad">
            <span>PDU {p.pduDown}</span>
            <b>✕ 차단기 내려감</b>
          </div>
        )}
        <div className="dash-tile">
          <span>사용 전력</span>
          <b>{h.powerKw.toFixed(2)} kW</b>
        </div>
      </div>
      <table className="dash-table">
        <thead>
          <tr>
            <th>장비</th>
            <th>PDU A</th>
            <th>PDU B</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          {visibleDevices(w).map((d) => {
            const on = powered(w, d.id);
            return (
              <tr key={d.id}>
                <td>
                  {d.label} <code>{d.id}</code>
                </td>
                <td>
                  <Led on={d.feeds.includes('A')} tone="ok" label={d.feeds.includes('A') ? '연결' : '—'} />
                </td>
                <td>
                  <Led on={d.feeds.includes('B')} tone="ok" label={d.feeds.includes('B') ? '연결' : '—'} />
                </td>
                <td className={on ? 'ok' : d.installed ? 'bad' : 'muted'}>{on ? '● 켜짐' : d.installed ? '✕ 꺼짐' : '📦 미설치'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}

function TempPanel({ w, rows, half }: { w: World; rows: ChartRow[]; half: boolean }) {
  const c = w.cooling;
  return (
    <Section title="온도 (Temperature)" hint="35°C를 넘으면 주의, 45°C를 넘으면 서버가 스스로 멈춰요." half={half}>
      <MiniChart
        title="가장 뜨거운 랙"
        unit="°C"
        rows={rows}
        dataKey="temp"
        domain={[20, 60]}
        height={170}
        format={(v) => `${v.toFixed(1)}°C`}
        refs={[
          { y: TEMP_WARN, color: WARN_LINE, label: `주의 ${TEMP_WARN}°C` },
          { y: TEMP_CRIT, color: CRIT_LINE, label: `위험 ${TEMP_CRIT}°C` },
        ]}
      />
      {c && (
        <>
          <div className={`dash-crac ${c.cracOk ? 'ok' : 'bad'}`}>
            항온항습기(CRAC): <b>{c.cracOk ? '● 정상 가동' : '✕ 멈춤'}</b>
            <span className="muted"> · 담당 랙: {c.cracRacks.join(', ')}</span>
          </div>
          <div className="dash-racks">
            {Object.entries(c.temps).map(([rack, t]) => {
              const lv = levelOf('temp', t);
              return (
                <div key={rack} className={`dash-rack ${lv}`}>
                  <span>{rack}</span>
                  <b>{t.toFixed(1)}°C</b>
                  <div className="dash-meter" aria-hidden>
                    <i style={{ width: `${Math.min(100, Math.max(0, ((t - 20) / 40) * 100))}%` }} />
                  </div>
                  <small className={lv}>{LEVEL_TEXT[lv]}</small>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Section>
  );
}

const POD_STATUS: Record<string, { cls: Level; icon: string }> = {
  Running: { cls: 'ok', icon: '●' },
  Pending: { cls: 'warn', icon: '▲' },
  CrashLoopBackOff: { cls: 'bad', icon: '✕' },
};

function PodsPanel({ w }: { w: World }) {
  const k = w.k8s;
  if (!k) return null;
  return (
    <Section title="쿠버네티스 (Pods)" hint="노드(서버)마다 pod가 몇 개 돌고 있는지, 원하는 개수만큼 준비됐는지 보세요.">
      <div className="dash-nodes">
        {Object.entries(k.nodes).map(([id, n]) => {
          const pods = k.pods.filter((p) => p.node === id);
          const temp = w.cooling?.temps[n.rack];
          return (
            <div key={id} className={`dash-node ${n.ready ? '' : 'down'}`}>
              <div className="dash-node-head">
                <b>{id}</b>
                <span className="muted">{n.rack}</span>
                {temp !== undefined && <span className={levelOf('temp', temp)}>{temp.toFixed(0)}°C</span>}
                <span className={`dash-ready ${n.ready ? 'ok' : 'bad'}`}>{n.ready ? '● Ready' : '✕ NotReady'}</span>
              </div>
              {pods.length === 0 ? (
                <p className="muted dash-empty">pod 없음</p>
              ) : (
                <ul className="dash-pods">
                  {pods.map((p) => {
                    const st = POD_STATUS[p.status] ?? { cls: 'warn' as Level, icon: '?' };
                    return (
                      <li key={p.name}>
                        <div className="dash-pod-main">
                          <code>{p.name}</code>
                          <span className={st.cls}>
                            {st.icon} {p.status}
                          </span>
                        </div>
                        <div className="dash-pod-sub muted">
                          {p.version} · {p.ip}
                          {p.restarts > 0 && ` · 재시작 ${p.restarts}회`}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {k.pods.some((p) => p.node === '') && (
        <p className="warn dash-unscheduled">
          ▲ 들어갈 노드가 없어 대기 중(Pending): {k.pods.filter((p) => p.node === '').map((p) => p.name).join(', ')}
        </p>
      )}
      <table className="dash-table">
        <thead>
          <tr>
            <th>디플로이먼트</th>
            <th>준비 / 목표</th>
            <th>이미지</th>
            <th>롤링 업데이트</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(k.deployments).map(([app, d]) => {
            const ready = readyPods(k, app).length;
            // 0 wanted = nothing runs at all, which is never "good" for a live service.
            const cls: Level = ready === 0 ? 'bad' : ready >= d.replicas ? 'ok' : 'warn';
            return (
              <tr key={app}>
                <td>
                  <code>{app}</code>
                </td>
                <td className={cls}>
                  {ready} / {d.replicas}
                  {d.replicas === 0 && <span className="muted"> (목표 0개)</span>}
                </td>
                <td>
                  <code>{d.image}</code>
                </td>
                <td>{d.rolling ? <span className="warn">▲ {d.rolling.target}(으)로 교체 중</span> : <span className="muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}

// ---------- window ----------

function DashboardBody({ run }: { run: StageRun }) {
  const def = getStage(run.stage);
  const rows = useMemo(() => toRows(run.history), [run.history]);
  const panels = PANEL_ORDER.filter((p) => def.panels.includes(p));
  // Services and temperature share a row when both are shown; everything else is full width.
  const pair = panels.includes('services') && panels.includes('temp');
  const h = run.health;
  const w = run.world;
  return (
    <>
      <p className="dash-next muted">빨간 숫자부터 살펴보세요. Tab 키를 다시 누르면 닫혀요.</p>
      <KpiRow h={h} />
      <div className="dash-grid">
        {panels.map((p) => {
          switch (p) {
            case 'traffic':
              return <TrafficPanel key={p} rows={rows} />;
            case 'services':
              return <ServicesPanel key={p} h={h} w={w} half={pair} />;
            case 'links':
              return <LinksPanel key={p} w={w} />;
            case 'power':
              return <PowerPanel key={p} w={w} h={h} />;
            case 'temp':
              return <TempPanel key={p} w={w} rows={rows} half={pair} />;
            case 'pods':
              return <PodsPanel key={p} w={w} />;
          }
        })}
      </div>
    </>
  );
}

export function Dashboard() {
  const run = useGame((s) => s.run);
  return (
    <ModalFrame title="관제 대시보드 (NOC)" icon="📊" size="wide">
      {run ? <DashboardBody run={run} /> : <p className="muted">게임을 시작하면 데이터가 보여요.</p>}
    </ModalFrame>
  );
}
