import { describe, expect, it } from 'vitest';
import { textureSpecs } from '../src/game/art';
import { Painter, type PixelTarget } from '../src/game/art/painter';

/** Records every filled rect instead of drawing it. */
function recorder() {
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const target: PixelTarget = { fill: (x, y, w, h) => rects.push({ x, y, w, h }) };
  return { rects, target };
}

describe('world texture specs', () => {
  const specs = textureSpecs();

  it('have unique keys', () => {
    const keys = specs.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('come out a whole number of screen px, frames included', () => {
    for (const s of specs) {
      expect(Number.isInteger(s.w * s.unit), s.key).toBe(true);
      expect(Number.isInteger(s.h * s.unit), s.key).toBe(true);
      if (s.frames) expect(Number.isInteger((s.w * s.unit) / s.frames), s.key).toBe(true);
    }
  });

  it('paint only inside their own texture', () => {
    for (const s of specs) {
      const { rects, target } = recorder();
      s.draw(new Painter(target, s.unit));
      expect(rects.length, s.key).toBeGreaterThan(0);
      for (const r of rects) {
        expect(r.x >= 0 && r.y >= 0, `${s.key} ${JSON.stringify(r)}`).toBe(true);
        expect(r.x + r.w <= s.w * s.unit && r.y + r.h <= s.h * s.unit, `${s.key} ${JSON.stringify(r)}`).toBe(true);
      }
    }
  });
});

describe('Painter', () => {
  it('merges a run of one colour in a text grid into one rect', () => {
    const { rects, target } = recorder();
    new Painter(target, 2).art(['.aab.'], { a: 1, b: 2 });
    expect(rects).toEqual([
      { x: 2, y: 0, w: 4, h: 2 },
      { x: 6, y: 0, w: 2, h: 2 },
    ]);
  });
});
