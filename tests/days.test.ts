// Every day can be played to the end on every seed, and every incident really breaks something and is
// really fixed by its own solution.
import { describe, expect, it } from 'vitest';
import { getStage, STAGES } from '../src/content/stages';
import { playDay } from './autoplay';

const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);

describe.each(STAGES.map((d) => [d.label, d.id] as const))('%s', (_label, day) => {
  // A whole D-Day is ~600 ticks of the full network model: give a busy machine room.
  it.each(SEEDS)('seed %i: clears, every incident breaks something and is fixed by its solution', (seed) => {
    const r = playDay(day, seed);
    expect(r.errors).toEqual([]);
    expect(r.notBroken).toEqual([]);
    expect(r.unsolved).toEqual([]);
    expect(r.offPoll).toEqual([]);
    expect(r.cleared).toBe(true);
    // A day scored from a fixed time (D-Day) stops scoring when its closing objective is done: the report,
    // the stars and that objective see the same stretch.
    const { scoreAvailabilityFrom: from, scoreAvailabilityUntil: until } = getStage(day);
    if (from !== undefined && until !== undefined) expect(r.run.ticks).toBe(r.run.objectivesDone[until] - from + 1);
  }, 60_000);
});
