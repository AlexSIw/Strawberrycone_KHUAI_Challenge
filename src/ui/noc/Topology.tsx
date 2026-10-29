// NMS topology: the school network drawn at fixed positions, links coloured by state and load.
import type { KeyboardEvent } from 'react';
import { CAMPUS, SERVERS } from '../../content/topology';
import { stpBlocked } from '../../game/worldView';
import { SEV_ORDER, type Alarm } from '../../sim/alarms';
import { cableAt, cablePeer, carries, logicalLinks, operState, powered, utilization, type LLink } from '../../sim/network';
import type { World } from '../../sim/types';
import { BOX, POS, SERVER_ROW, VIEW } from './layout';

export type LinkTone = 'spare' | 'down' | 'red' | 'yellow' | 'green';

/**
 * dotted grey = a spare link switched off in the config (`shutdown`: nothing is broken), grey = down,
 * red = over 90% or a broadcast storm, yellow = over 70%, green otherwise.
 */
export function linkTone(w: World, l: LLink): LinkTone {
  if (!l.up) {
    // A bundle member someone shut is a fault (the bundle lost a lane), not a spare.
    const member = [l.a, l.b].some((p) => w.devices[p.dev]?.nd?.ifs[p.ifn]?.group !== undefined);
    return !member && [l.a, l.b].some((p) => operState(w, p.dev, p.ifn) === 'admin-down') ? 'spare' : 'down';
  }
  const storm = w.net?.storm ?? [];
  if (storm.some((v) => carries(w, l.a, v) || carries(w, l.b, v))) return 'red';
  const u = utilization(w, l.key);
  return u > 0.9 ? 'red' : u > 0.7 ? 'yellow' : 'green';
}

export const TONE_TEXT: Record<LinkTone, string> = { spare: '꺼 둔 예비 길', down: '끊김', red: '포화', yellow: '혼잡', green: '정상' };

/** Worst open alarm on a device: 'bad' (critical/major) or 'warn' (minor/warning). */
function badgeOf(alarms: Alarm[]): { n: number; tone: 'bad' | 'warn'; unacked: boolean } | null {
  if (!alarms.length) return null;
  const worst = Math.min(...alarms.map((a) => SEV_ORDER[a.sev]));
  return { n: alarms.length, tone: worst <= SEV_ORDER.major ? 'bad' : 'warn', unacked: alarms.some((a) => a.ackAt === null) };
}

/** Which TOR a server hangs off: the switch its cable goes to, or the planned one while it has no cable. */
function torOfServer(w: World, id: string): string | undefined {
  const peer = cablePeer(w, id, w.devices[id]?.ports[0] ?? 'eth0');
  return peer?.[0] ?? SERVERS[id]?.[4];
}

interface Props {
  w: World;
  alarms: Alarm[];
  selected: string | null;
  onSelect: (id: string) => void;
}

export function TopologyMap({ w, alarms, selected, onSelect }: Props) {
  const blocked = stpBlocked(w);
  const open = alarms.filter((a) => a.clearedAt === null);
  const badge = (id: string) => badgeOf(open.filter((a) => a.device === id));
  const key = (id: string) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(id);
    }
  };

  // Links between devices on the map; parallel links between the same pair are drawn side by side.
  const links = logicalLinks(w).filter((l) => POS[l.a.dev] && POS[l.b.dev]);
  const pairOf = (l: LLink) => [l.a.dev, l.b.dev].sort().join('|');
  const pairTotal = new Map<string, number>();
  for (const l of links) pairTotal.set(pairOf(l), (pairTotal.get(pairOf(l)) ?? 0) + 1);
  const pairSeen = new Map<string, number>();

  const servers = Object.values(w.devices).filter((d) => d.kind === 'server');
  const rows = (['TOR-01', 'TOR-02'] as const).map((tor) => ({ tor, list: servers.filter((d) => torOfServer(w, d.id) === tor) }));

  return (
    <svg className="nms-map" viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} role="group" aria-label="네트워크 구성도">
      {/* links */}
      {links.map((l) => {
        const pair = pairOf(l);
        const i = pairSeen.get(pair) ?? 0;
        pairSeen.set(pair, i + 1);
        const n = pairTotal.get(pair) ?? 1;
        const a = POS[l.a.dev];
        const b = POS[l.b.dev];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const off = (i - (n - 1) / 2) * 7;
        const ox = (-(b.y - a.y) / len) * off;
        const oy = ((b.x - a.x) / len) * off;
        const tone = linkTone(w, l);
        const isBlocked = blocked.has(`${l.a.dev}:${l.a.ifn}`) || blocked.has(`${l.b.dev}:${l.b.ifn}`);
        const util = Math.round(utilization(w, l.key) * 100);
        return (
          <line
            key={l.key}
            className={`nms-link ${tone}${isBlocked ? ' blocked' : ''}${l.kind === 'po' ? ' po' : ''}`}
            x1={a.x + ox}
            y1={a.y + oy}
            x2={b.x + ox}
            y2={b.y + oy}
          >
            <title>
              {`${l.a.dev} ${l.a.ifn} ↔ ${l.b.dev} ${l.b.ifn} · ${TONE_TEXT[tone]}${l.up ? ` · 사용률 ${util}%` : ''}${isBlocked ? ' · STP 차단(예비 길)' : ''}`}
            </title>
          </line>
        );
      })}
      <text className="nms-note" x={(POS.internet.x + POS['BR-01'].x) / 2 - 34} y={58}>
        ISP-A
      </text>
      <text className="nms-note" x={(POS.internet.x + POS['BR-02'].x) / 2 + 10} y={58}>
        ISP-B
      </text>

      {/* servers under each TOR */}
      {rows.map(({ tor, list }) => {
        const t = POS[tor];
        if (!list.length) return null;
        const span = list.length * (SERVER_ROW.w + SERVER_ROW.gap) - SERVER_ROW.gap;
        const x0 = t.x - span / 2;
        const busY = SERVER_ROW.y - SERVER_ROW.h / 2 - 9;
        const racks = [...new Set(list.map((d) => d.rack?.replace('rack', '')).filter(Boolean))].join('·');
        return (
          <g key={tor} className="nms-servers">
            <line className="nms-bus" x1={t.x} y1={t.y + BOX.h / 2} x2={t.x} y2={busY} />
            <line className="nms-bus" x1={x0 + SERVER_ROW.w / 2} y1={busY} x2={x0 + span - SERVER_ROW.w / 2} y2={busY} />
            {list.map((d, i) => {
              const x = x0 + i * (SERVER_ROW.w + SERVER_ROW.gap);
              const port = d.ports[0] ?? 'eth0';
              const cable = cableAt(w, `${d.id}:${port}`);
              const up = operState(w, d.id, port) === 'up';
              const stub = !cable ? 'none' : !up ? 'down' : cable.degraded ? 'yellow' : 'green';
              const on = d.installed && powered(w, d.id);
              const bd = badge(d.id);
              return (
                <g
                  key={d.id}
                  className={`nms-srv${on ? '' : ' off'}${d.installed ? '' : ' absent'}${selected === d.id ? ' sel' : ''}${bd ? ` alarm-${bd.tone}` : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${d.label} 서버`}
                  onClick={() => onSelect(d.id)}
                  onKeyDown={key(d.id)}
                >
                  <line className={`nms-stub ${stub}`} x1={x + SERVER_ROW.w / 2} y1={busY} x2={x + SERVER_ROW.w / 2} y2={SERVER_ROW.y - SERVER_ROW.h / 2} />
                  <rect x={x} y={SERVER_ROW.y - SERVER_ROW.h / 2} width={SERVER_ROW.w} height={SERVER_ROW.h} rx={2} />
                  <title>{`${d.label} (${d.id}) · ${!d.installed ? '설치 전' : !on ? '전원 꺼짐' : up ? '링크 정상' : '링크 없음'}`}</title>
                </g>
              );
            })}
            <text className="nms-caption" x={t.x} y={SERVER_ROW.y + 22}>
              서버{racks ? ` · 랙 ${racks}` : ''}
            </text>
          </g>
        );
      })}

      {/* devices */}
      {Object.entries(POS).map(([id, p]) => {
        const d = w.devices[id];
        if (!d) return null;
        if (d.kind === 'internet') {
          return (
            <g key={id} className="nms-cloud">
              <ellipse cx={p.x} cy={p.y} rx={58} ry={17} />
              <text x={p.x} y={p.y + 4}>
                인터넷
              </text>
            </g>
          );
        }
        const on = powered(w, id);
        const bd = badge(id);
        const building = CAMPUS[id]?.[0];
        return (
          <g
            key={id}
            className={`nms-node kind-${d.kind}${on ? '' : ' off'}${selected === id ? ' sel' : ''}`}
            transform={`translate(${p.x - BOX.w / 2},${p.y - BOX.h / 2})`}
            role="button"
            tabIndex={0}
            aria-label={`${d.label}${bd ? `, 경보 ${bd.n}건` : ''}`}
            onClick={() => onSelect(id)}
            onKeyDown={key(id)}
          >
            <rect width={BOX.w} height={BOX.h} rx={6} />
            <text x={BOX.w / 2} y={BOX.h / 2 + 4}>
              {d.label}
            </text>
            {!on && (
              <text className="nms-offtext" x={BOX.w / 2} y={BOX.h + 12}>
                전원 꺼짐
              </text>
            )}
            {building && on && (
              <text className="nms-caption" x={BOX.w / 2} y={BOX.h + 13}>
                {building}
              </text>
            )}
            {bd && (
              <g className={`nms-badge ${bd.tone}${bd.unacked ? ' pulse' : ''}`} transform={`translate(${BOX.w - 2},0)`}>
                <circle r={9} />
                <text y={4}>{bd.n}</text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
