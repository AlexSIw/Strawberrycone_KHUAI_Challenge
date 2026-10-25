// The six days, assembled: each day file's spec + the incident registry it may draw from + its
// starting world (the D-Day topology with what this and later days build taken back out).
import { baseTopology } from '../topology';
import { instance, instanceIds, template, TEMPLATES, validOn } from '../incidents';
import { allInstances } from '../incidents';
import type { PlannedIncident, Scenario } from '../../sim/scenario';
import { planDay } from '../../sim/scheduler';
import { LAST_DAY, type StageId, type World } from '../../sim/types';
import type { DaySpec, StageDef } from '../types';
import { day0 } from './day0';
import { day1 } from './day1';
import { day2 } from './day2';
import { day3 } from './day3';
import { day4 } from './day4';
import { day5 } from './day5';

const SPECS: DaySpec[] = [day0, day1, day2, day3, day4, day5];

/** The world a day starts from. */
export function dayWorld(d: StageId): World {
  const w = baseTopology();
  for (let k = LAST_DAY; k >= d; k--) SPECS[k].unbuild?.(w);
  SPECS[d].setup?.(w);
  return w;
}

/** Templates that may be drawn as extras on `spec`'s day. */
function poolTemplates(spec: DaySpec) {
  return TEMPLATES.filter((t) => validOn(t, spec.id) && (t.weight ?? 1) > 0 && !spec.fixed.some((f) => f.template === t.id));
}

/** Every scenario instance that may happen on this day (its fixed incidents' variants + the extras pool). */
function registry(spec: DaySpec): Scenario[] {
  const ids = [...spec.fixed.map((f) => template(f.template)), ...poolTemplates(spec)].flatMap(instanceIds);
  return [...new Set(ids)].map(instance);
}

export const STAGES: StageDef[] = SPECS.map((spec) => ({ ...spec, scenarios: registry(spec), initialWorld: () => dayWorld(spec.id) }));
export const DAYS = STAGES;

export const getStage = (id: StageId): StageDef => STAGES[id];

export const ALL_SCENARIOS: Scenario[] = allInstances();

/** Which incidents happen on this run of the day. */
export function planIncidents(def: StageDef, seed: number): PlannedIncident[] {
  const spec = SPECS[def.id];
  return planDay(
    {
      day: def.id,
      fixed: spec.fixed.map((f) => ({ template: f.template, variants: template(f.template).variants.length, trigger: f.trigger, optional: f.trigger.type === 'condition' })),
      extras: spec.extras,
      objectiveIds: spec.objectives.map((o) => o.id),
      pool: poolTemplates(spec).map((t) => ({ template: t.id, variants: t.variants.length, weight: t.weight ?? 1, sameDay: t.day === spec.id })),
    },
    seed,
  );
}
