import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BOSS,
  LION_HAPPY,
  LION_PALETTE,
  LION_WORRIED,
  MENTOR,
  PORTRAIT_SIZE,
  PORTRAITS,
  portraitKey,
  SYSTEM_TIP,
} from '../src/game/art/portraits';

/** `PAL` from the lion sprite generator, as 0xRRGGBB numbers. */
function spritePalette(): Record<string, number> {
  const src = readFileSync(new URL('../art/lion_sprite/source/lion_sprite.py', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('PAL = {'), src.indexOf('}', src.indexOf('PAL = {')));
  const pal: Record<string, number> = {};
  for (const [, key, r, g, b] of block.matchAll(/'(\w)': \((\d+), (\d+), (\d+)\)/g)) {
    pal[key] = (+r << 16) | (+g << 8) | +b;
  }
  return pal;
}

const usedChars = (rows: string[]) => new Set([...rows.join('')].filter((c) => c !== '.'));

describe('portrait grids', () => {
  it.each(Object.entries(PORTRAITS))('%s is 32 x 32 and every colour is in its palette', (_key, { rows, palette }) => {
    expect(PORTRAIT_SIZE).toBe(32);
    expect(rows).toHaveLength(32);
    rows.forEach((row, y) => expect(row, `row ${y}`).toHaveLength(32));
    for (const c of usedChars(rows)) expect(palette, `char ${c}`).toHaveProperty(c);
  });

  it('busts sit on one flat bottom edge', () => {
    for (const rows of [MENTOR, BOSS, LION_HAPPY, LION_WORRIED]) expect(rows[31]).toMatch(/^\.*[^.]+\.*$/);
  });

  it('the lion uses the sprite palette exactly, plus only the sweat-drop blue', () => {
    const sprite = spritePalette();
    expect(Object.keys(sprite).length).toBeGreaterThan(20);
    for (const c of usedChars([...LION_HAPPY, ...LION_WORRIED])) {
      if (c === 'u') continue;
      expect(LION_PALETTE[c], `lion colour ${c}`).toBe(sprite[c]);
    }
    expect(sprite).not.toHaveProperty('u');
    expect(usedChars(LION_HAPPY).has('u')).toBe(false);
    expect(usedChars(LION_WORRIED).has('u')).toBe(true);
  });

  it('the tip bulb is centred art, not a bust', () => {
    expect(SYSTEM_TIP[0]).toMatch(/^\.+$/);
    expect(SYSTEM_TIP[31]).toMatch(/^\.+$/);
  });
});

describe('portraitKey', () => {
  it('only the lion changes with mood; neutral keeps the happy face', () => {
    expect(portraitKey('lion')).toBe('lion-happy');
    expect(portraitKey('lion', 'happy')).toBe('lion-happy');
    expect(portraitKey('lion', 'neutral')).toBe('lion-happy');
    expect(portraitKey('lion', 'worried')).toBe('lion-worried');
    expect(portraitKey('mentor', 'worried')).toBe('mentor');
    expect(portraitKey('boss', 'happy')).toBe('boss');
    expect(portraitKey('system')).toBe('system-tip');
  });
});
