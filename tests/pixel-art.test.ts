import { describe, expect, it } from 'vitest';
import { textureSpecs } from '../src/game/art';
import { Painter, type PixelTarget } from '../src/game/art/painter';
import { TILE } from '../src/game/map';
import { PX } from '../src/game/pixelArt';
import { zoomFor } from '../src/game/view';

describe('pixel density', () => {
  it('a tile is 32 x 32 art px, the lion frame', () => {
    expect(TILE).toBe(32 * PX);
  });

  it('every world texture is drawn at that one density', () => {
    for (const s of textureSpecs()) expect(s.unit, s.key).toBe(PX);
  });

  it('the camera only zooms to steps where an art pixel stays a whole number of screen px', () => {
    for (const [w, h] of [
      [375, 667],
      [1280, 720],
      [1280, 800],
      [1440, 900],
      [1920, 1080],
      [2560, 1440],
      [3840, 2160],
    ]) {
      const z = zoomFor(w, h);
      expect([1, 1.5, 2], `${w}x${h}`).toContain(z);
      expect(Number.isInteger(z * PX), `${w}x${h}`).toBe(true);
    }
    expect(zoomFor(1920, 1080)).toBe(1);
    expect(zoomFor(2560, 1440)).toBe(1.5);
    expect(zoomFor(3840, 2160)).toBe(2);
  });
});

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
