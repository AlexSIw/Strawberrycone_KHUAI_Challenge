import { describe, expect, it } from 'vitest';
import { TILE } from '../src/game/map';
import { PX } from '../src/game/pixelArt';
import { dustSpawn, facingFor, facingToward, LION_FRAME, LION_SCALE, lionAnim, lionFrame } from '../src/game/sprites/lion';

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

describe('dustSpawn', () => {
  // the lion's feet at (100, 200): its frame's top-left is (100 - 16 PX, 200 - 32 PX)
  const left = 100 - 16 * PX;
  const top = 200 - 32 * PX;
  /** World px of a lion-frame art pixel, and of the puff's anchor pixel (8, 15) */
  const lionPx = (x: number, y: number) => ({ x: left + x * PX, y: top + y * PX });
  const anchor = (d: { x: number; y: number }) => ({ x: d.x + 8 * PX, y: d.y + 15 * PX });

  it('only where a foot lands: run columns 0 and 3', () => {
    for (const col of [1, 2, 4, 5]) expect(dustSpawn('down', col, 100, 200)).toBeNull();
    expect(dustSpawn('down', 0, 100, 200)).not.toBeNull();
    expect(dustSpawn('down', 3, 100, 200)).not.toBeNull();
  });

  it('puts the puff anchor on the landing foot', () => {
    const right = dustSpawn('right', 0, 100, 200)!;
    expect(right.key).toBe('dust_side_right');
    expect(anchor(right)).toEqual(lionPx(14, 31));
    expect(anchor(dustSpawn('right', 3, 100, 200)!)).toEqual(lionPx(14, 31));

    const l = dustSpawn('left', 3, 100, 200)!;
    expect(l.key).toBe('dust_side_left');
    expect(anchor(l)).toEqual(lionPx(17, 31));

    for (const dir of ['down', 'up'] as const) {
      const a = dustSpawn(dir, 0, 100, 200)!;
      const b = dustSpawn(dir, 3, 100, 200)!;
      expect(a.key).toBe('dust_puff');
      expect(b.key).toBe('dust_puff');
      // the feet alternate
      expect(anchor(a)).toEqual(lionPx(13, 31));
      expect(anchor(b)).toEqual(lionPx(18, 31));
    }
  });

  it('lands on the art grid when the lion is between pixels', () => {
    const d = dustSpawn('left', 0, 101.3, 200.9)!;
    expect(d.x % PX).toBe(0);
    expect(d.y % PX).toBe(0);
    expect(Math.abs(anchor(d).x - (101.3 - 16 * PX + 17 * PX))).toBeLessThanOrEqual(PX / 2);
  });
});
