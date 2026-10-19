// Asks the Worker (/api/hint → ChatKHU) for a mentor hint. Falls back to the scenario's
// built-in hint ladder when the Worker isn't running, has no key, or fails.
import { getStage } from '../content/stages';
import { activeScenarios, visibleObjectives, type StageRun } from '../sim/engine';
import type { Scenario } from '../sim/scenario';

export interface HintSnapshot {
  stage: number;
  stageTitle: string;
  objectives: string[];
  incidents: { id: string; title: string; alert: string; secondsActive: number }[];
  availability: number;
  notes: string[];
  recentCommands: string[];
  host: string;
}

export function buildSnapshot(run: StageRun, host: string): HintSnapshot {
  const def = getStage(run.stage);
  return {
    stage: run.stage,
    stageTitle: def.title,
    objectives: visibleObjectives(def, run).filter((o) => !(o.id in run.objectivesDone)).map((o) => o.text),
    incidents: activeScenarios(run).map(({ rt, def: sc }) => ({
      id: sc.id,
      title: sc.title,
      alert: sc.alert,
      secondsActive: Math.max(0, run.ctx.stageTime - (rt.activatedAt ?? run.ctx.stageTime)),
    })),
    availability: Math.round(run.health.availability * 100),
    notes: run.health.notes,
    recentCommands: run.ctx.commands.slice(-6),
    host,
  };
}

export interface HintRequest {
  run: StageRun;
  scenario: Scenario;
  level: number;
  question?: string;
  history: { from: string; text: string }[];
  host: string;
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
        snapshot: buildSnapshot(req.run, req.host),
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
