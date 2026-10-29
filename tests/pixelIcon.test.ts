import { describe, expect, it } from 'vitest';
import { ICONS, iconPath } from '../src/ui/pixelIcons';

describe('pixel icons', () => {
  it('every icon is an 8 x 8 grid of . # +', () => {
    for (const [name, rows] of Object.entries(ICONS)) {
      expect(rows, name).toHaveLength(8);
      for (const row of rows) expect(row, name).toMatch(/^[.#+]{8}$/);
    }
  });

  it('merges a horizontal run into one rectangle', () => {
    expect(iconPath(['.##.....'], '#')).toBe('M1 0h2v1h-2z');
    expect(iconPath(['#.#'], '#')).toBe('M0 0h1v1h-1zM2 0h1v1h-1z');
    expect(iconPath(['....'], '+')).toBe('');
  });
});
