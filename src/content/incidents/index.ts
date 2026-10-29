// Every incident template, and the scenario instances made from them ('<template>:<variant>').
import type { IncidentTemplate, Scenario } from '../../sim/scenario';
import type { StageId } from '../../sim/types';
import { LAST_DAY } from '../../sim/types';
import { templates as d1 } from './d1';
import { templates as d2 } from './d2';
import { templates as d3 } from './d3';
import { templates as d4 } from './d4';
import { templates as d5 } from './d5';
import { templates as dday } from './dday';

export const TEMPLATES: IncidentTemplate[] = [...d5, ...d4, ...d3, ...d2, ...d1, ...dday];

const byId = new Map(TEMPLATES.map((t) => [t.id, t]));

export function template(id: string): IncidentTemplate {
  const t = byId.get(id);
  if (!t) throw new Error(`unknown incident template ${id}`);
  return t;
}

const cache = new Map<string, Scenario>();

/** The scenario for '<template>:<variant>'. Its `trigger` is a placeholder: each run's plan sets the real one. */
export function instance(id: string): Scenario {
  let sc = cache.get(id);
  if (!sc) {
    const i = id.lastIndexOf(':');
    const t = template(id.slice(0, i));
    const v = t.variants[parseInt(id.slice(i + 1), 10)];
    if (!v) throw new Error(`unknown variant ${id}`);
    sc = { ...t.make(v), id, stage: t.day, trigger: { type: 'stageStart' } };
    cache.set(id, sc);
  }
  return sc;
}

export const instanceIds = (t: IncidentTemplate): string[] => t.variants.map((_, i) => `${t.id}:${i}`);

/** Every instance of every template (the AI worker's scenario table). */
export function allInstances(): Scenario[] {
  return TEMPLATES.flatMap((t) => instanceIds(t).map(instance));
}

/** Can this template happen on `day`? */
export const validOn = (t: IncidentTemplate, day: StageId): boolean => t.day <= day && day <= (t.until ?? LAST_DAY);
