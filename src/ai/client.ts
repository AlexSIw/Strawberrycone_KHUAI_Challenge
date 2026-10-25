// Asks the Worker (/api/hint → ChatKHU) for a mentor hint. Falls back to the scenario's
// built-in hint ladder when the Worker isn't running, has no key, or fails.
import { getStage } from '../content/stages';
import { openAlarms, SEV_LABEL } from '../sim/alarms';
import { activeScenarios, clockText, visibleObjectives, type StageRun } from '../sim/engine';
import { operState } from '../sim/net/topo';
import { compareIf } from '../sim/net/ifname';
import { cableAt } from '../sim/net/basics';
import type { Scenario } from '../sim/scenario';
import { dayLabel, type World } from '../sim/types';

/**
 * What the 사수 sees of the game right now. Only what the player could see on screen: the NOC's alarms
 * (severity, device, text — never which incident they belong to), port and gateway state, link load.
 */
export interface HintSnapshot {
  /** 'D-4' */
  day: string;
  /** '14:32' (D-Day: '10:03:17') */
  clock: string;
  dayTitle: string;
  objectives: string[];
  incidents: { title: string; alert: string; secondsActive: number }[];
  /** Open NOC alarms, worst first */
  alarms: { sev: string; device: string; text: string; acked: boolean }[];
  /** Ports on network gear that are cabled (or err-disabled) and not up: 'TOR-01 Gi1/0/5 err-disabled' */
  portsDown: string[];
  /** VLAN → core that answers the gateway address (HSRP active), or null when none does */
  hsrpActive: Record<string, string | null>;
  /** Busiest links: 'CORE-01:Te1/0/3~TOR-01:Te1/1/1' → percent of capacity */
  busiestLinks: { link: string; util: number }[];
  availability: number;
  notes: string[];
  recentCommands: string[];
  host: string;
  /** IOS mode the terminal is in on network gear ('exec', 'config-if' …) */
  iosMode?: string;
}

const MAX_PORTS = 12;
const MAX_LINKS = 5;

function portsDown(w: World): string[] {
  const out: string[] = [];
  for (const d of Object.values(w.devices)) {
    if (d.nd?.os !== 'ios') continue;
    for (const ifn of Object.keys(d.nd.ifs).sort(compareIf)) {
      const f = d.nd.ifs[ifn];
      // An empty port being down is normal; a cabled one (or one the switch shut itself) is news.
      if (!f.errDisabled && !cableAt(w, `${d.id}:${ifn}`)) continue;
      const st = operState(w, d.id, ifn);
      if (st !== 'up') out.push(`${d.label} ${ifn} ${st}`);
    }
  }
  return out.slice(0, MAX_PORTS);
}

function busiestLinks(w: World): HintSnapshot['busiestLinks'] {
  return Object.entries(w.net?.load ?? {})
    .filter(([, l]) => l.cap > 0 && l.mbps > 0)
    .map(([link, l]) => ({ link, util: Math.round((l.mbps / l.cap) * 100) }))
    .sort((a, b) => b.util - a.util)
    .slice(0, MAX_LINKS);
}

export function buildSnapshot(run: StageRun, host: string, iosMode?: string | null): HintSnapshot {
  const def = getStage(run.stage);
  const w = run.world;
  const label = (id: string) => w.devices[id]?.label ?? id;
  return {
    day: dayLabel(run.stage),
    clock: clockText(run),
    dayTitle: def.title,
    objectives: visibleObjectives(def, run).filter((o) => !(o.id in run.objectivesDone)).map((o) => o.text),
    incidents: activeScenarios(run).map(({ rt, def: sc }) => ({
      title: sc.title,
      alert: sc.alert,
      secondsActive: Math.max(0, run.ctx.stageTime - (rt.activatedAt ?? run.ctx.stageTime)),
    })),
    alarms: openAlarms(run.alarms).map((a) => ({ sev: SEV_LABEL[a.sev], device: label(a.device), text: a.text, acked: a.ackAt !== null })),
    portsDown: portsDown(w),
    hsrpActive: Object.fromEntries(Object.entries(w.net?.hsrpActive ?? {}).map(([vlan, dev]) => [vlan, dev ? label(dev) : null])),
    busiestLinks: busiestLinks(w),
    availability: Math.round(run.health.availability * 100),
    notes: run.health.notes,
    recentCommands: run.ctx.commands.slice(-6),
    host,
    ...(iosMode ? { iosMode } : {}),
  };
}

export interface HintRequest {
  run: StageRun;
  scenario: Scenario;
  level: number;
  question?: string;
  history: { from: string; text: string }[];
  host: string;
  /** IOS mode level when the terminal is on network gear */
  iosMode?: string | null;
}

export async function requestHintText(req: HintRequest): Promise<{ text: string; source: 'ai' | 'canned' }> {
  const canned = req.scenario.hints[Math.max(0, Math.min(2, req.level - 1))];
  try {
    const res = await fetch('/api/hint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scenarioId: req.scenario.id,
        level: req.level,
        question: req.question ?? '',
        history: req.history.slice(-8),
        snapshot: buildSnapshot(req.run, req.host, req.iosMode),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`hint ${res.status}`);
    const data = (await res.json()) as { reply?: string; fallback?: boolean };
    if (!data.reply || data.fallback) throw new Error('fallback');
    return { text: data.reply, source: 'ai' };
  } catch {
    return { text: canned, source: 'canned' };
  }
}
