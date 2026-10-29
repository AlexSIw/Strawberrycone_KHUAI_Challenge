import { describe, expect, it } from 'vitest';
import { canDash, DASH_COOLDOWN_MS, DASH_MS, DASH_SPEED, dashDir } from '../src/game/dash';
import { TILE } from '../src/game/map';

describe('dash', () => {
  it('goes two tiles in its time', () => {
    expect((DASH_SPEED * DASH_MS) / 1000).toBeCloseTo(2 * TILE, 6);
  });

  it('goes the way the keys point, diagonals no longer than straight', () => {
    expect(dashDir(1, 0, 'down')).toEqual({ dx: 1, dy: 0 });
    expect(dashDir(0, -1, 'down')).toEqual({ dx: 0, dy: -1 });
    const d = dashDir(-1, 1, 'up');
    expect(Math.hypot(d.dx, d.dy)).toBeCloseTo(1, 9);
    expect(d.dx).toBeLessThan(0);
    expect(d.dy).toBeGreaterThan(0);
  });

  it('with no keys held, goes the way the lion faces', () => {
    expect(dashDir(0, 0, 'right')).toEqual({ dx: 1, dy: 0 });
    expect(dashDir(0, 0, 'left')).toEqual({ dx: -1, dy: 0 });
    expect(dashDir(0, 0, 'up')).toEqual({ dx: 0, dy: -1 });
    expect(dashDir(0, 0, 'down')).toEqual({ dx: 0, dy: 1 });
  });

  it('waits out the cooldown', () => {
    const ended = 1000;
    const readyAt = ended + DASH_COOLDOWN_MS;
    expect(canDash(ended + DASH_COOLDOWN_MS - 1, readyAt)).toBe(false);
    expect(canDash(readyAt, readyAt)).toBe(true);
  });
});
