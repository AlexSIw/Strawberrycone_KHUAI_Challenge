import { describe, expect, it } from 'vitest';
import { TILE } from '../src/game/map';
import { facingFor, facingToward, LION_FRAME, LION_SCALE, lionAnim, lionFrame } from '../src/game/sprites/lion';

describe('lion sheet', () => {
  it('one frame covers exactly one tile', () => {
    expect(LION_SCALE * LION_FRAME).toBe(TILE);
  });

  it('frame index: rows grouped idle, run, interact; facings down, left, right, up; 6 columns', () => {
    expect(lionFrame('idle', 'down', 0)).toBe(0);
    expect(lionFrame('idle', 'up', 3)).toBe(3 * 6 + 3);
    expect(lionFrame('run', 'down', 0)).toBe(24);
    expect(lionFrame('run', 'left', 5)).toBe(35);
    expect(lionFrame('run', 'up', 5)).toBe(47);
    expect(lionFrame('interact', 'down', 0)).toBe(48);
    expect(lionFrame('interact', 'up', 3)).toBe(69);
  });

  it('pose: interacting wins over running, running over standing', () => {
    expect(lionAnim({ moving: false, facing: 'left', fixing: false })).toBe('lion-idle-left');
    expect(lionAnim({ moving: true, facing: 'up', fixing: false })).toBe('lion-run-up');
    expect(lionAnim({ moving: true, facing: 'right', fixing: true })).toBe('lion-interact-right');
  });
});

describe('facingFor', () => {
  it('follows the movement, and keeps the facing on a diagonal that still matches it', () => {
    expect(facingFor(0, 0, 'left')).toBe('left');
    expect(facingFor(1, 0, 'down')).toBe('right');
    expect(facingFor(-1, 0, 'down')).toBe('left');
    expect(facingFor(0, -1, 'left')).toBe('up');
    expect(facingFor(0, 1, 'left')).toBe('down');
    expect(facingFor(1, -1, 'up')).toBe('up');
    expect(facingFor(1, -1, 'right')).toBe('right');
    expect(facingFor(1, -1, 'down')).toBe('right');
  });
});

describe('facingToward', () => {
  // a 2 x 1 tile device at tiles (4..6, 3..4)
  const rect = { x: 4 * TILE, y: 3 * TILE, w: 2 * TILE, h: TILE };

  it('faces the side of the device the lion stands at', () => {
    expect(facingToward(5 * TILE, 5 * TILE, rect)).toBe('up');
    expect(facingToward(5 * TILE, 2 * TILE, rect)).toBe('down');
    expect(facingToward(3 * TILE, 3.5 * TILE, rect)).toBe('right');
    expect(facingToward(7 * TILE, 3.5 * TILE, rect)).toBe('left');
  });

  it('at a corner, turns the way that is further across', () => {
    // below-left of the device: a little left of it, well below it
    expect(facingToward(3.8 * TILE, 5 * TILE, rect)).toBe('up');
    // well left of it, a little below it
    expect(facingToward(2.5 * TILE, 4.2 * TILE, rect)).toBe('right');
  });

  it('from inside the footprint, turns toward its centre', () => {
    expect(facingToward(4.1 * TILE, 3.5 * TILE, rect)).toBe('right');
    expect(facingToward(5 * TILE, 3.9 * TILE, rect)).toBe('up');
  });
});
