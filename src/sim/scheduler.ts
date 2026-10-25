// Which incidents happen today. Pure and seeded, so a save replays the same day and tests can sweep seeds.
// Each day has fixed incidents (the ones it teaches; the D-Day timeline) plus 0–2 extras drawn from
// earlier days' incidents. Extras are chained by gates on the previous incident, so they can never
// deadlock the day.
import type { PlannedIncident, Trigger } from './scenario';

/** Small fast PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-day seed derived from the save's seed, so days don't share a random stream. */
export function daySeed(seed: number, day: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (day + 1), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** A fresh save seed. */
export const newSeed = (): number => (Math.random() * 0xffffffff) >>> 0 || 1;

export interface PlanInput {
  day: number;
  /** Always-on incidents: template id, how many variants it has, its trigger, and whether it may never fire */
  fixed: { template: string; variants: number; trigger: Trigger; optional?: boolean }[];
  extras: [number, number];
  /** Today's mission ids (an extra drawn from today's own pool waits for all of them) */
  objectiveIds: string[];
  /** Templates that may be drawn as extras today */
  pool: { template: string; variants: number; weight: number; sameDay: boolean }[];
}

/** Seconds of calm before an extra fires, after whatever it waits for: 20–59 s. */
const EXTRA_DELAY = (r: number) => 20 + Math.floor(r * 40);

export function planDay(input: PlanInput, seed: number): PlannedIncident[] {
  const rng = mulberry32(daySeed(seed, input.day));
  const pick = (n: number) => Math.min(n - 1, Math.floor(rng() * n));

  const plan: PlannedIncident[] = input.fixed.map((f) => ({ id: `${f.template}:${pick(f.variants)}`, trigger: f.trigger }));
  const gateable = plan.filter((_, i) => !input.fixed[i].optional);

  const [min, max] = input.extras;
  let n = min + pick(max - min + 1);
  const pool = input.pool.filter((p) => p.weight > 0 && !input.fixed.some((f) => f.template === p.template));
  let prev: string | null = gateable.length ? gateable[gateable.length - 1].id : null;
  while (n-- > 0 && pool.length) {
    const total = pool.reduce((a, p) => a + p.weight, 0);
    let r = rng() * total;
    let i = 0;
    while (i < pool.length - 1 && r >= pool[i].weight) r -= pool[i++].weight;
    const p = pool.splice(i, 1)[0];
    const id = `${p.template}:${pick(p.variants)}`;
    const trigger: Trigger = {
      type: 'gate',
      scenarios: prev ? [prev] : [],
      objectives: p.sameDay || !prev ? input.objectiveIds : [],
      delay: EXTRA_DELAY(rng()),
    };
    plan.push({ id, trigger });
    prev = id;
  }
  return plan;
}
