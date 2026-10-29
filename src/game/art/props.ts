// Small props: water cooler, overhead cable tray, KHU banner, potted plant, cardboard box.
// Drawn in art px of U screen px each; layout constants are screen px relative to the texture's top-left.
import { BOX, BOX_PALETTE, COLORS as C, PLANT, PLANT_PALETTE, OLD_UNIT } from '../pixelArt';
import type { Painter, TextureSpec } from './painter';

/** Screen px per art px for this module's art (old 16-px-per-tile art until it is redrawn). */
const U = OLD_UNIT;

function drawWater(p: Painter): void {
  // 16 x 24 water cooler
  p.rect(4, 0, 8, 9, C.outline);
  p.rect(5, 1, 6, 7, 0x8fd0ff);
  p.rect(5, 1, 2, 7, 0xc8ecff);
  p.rect(3, 8, 10, 15, C.outline);
  p.rect(4, 9, 8, 13, 0xe9ecef);
  p.rect(4, 9, 8, 1, 0xffffff);
  p.rect(5, 12, 2, 2, C.blue);
  p.rect(9, 12, 2, 2, C.red);
  p.rect(5, 16, 6, 3, 0xb7bcc5);
  p.rect(3, 23, 10, 1, C.outline);
}

function drawTray(p: Painter): void {
  // 16 x 8 overhead ladder tray with cables
  p.rect(0, 0, 16, 8, 0x5d6270);
  p.rect(0, 1, 16, 6, 0x2a2c33);
  for (let x = 1; x < 16; x += 4) p.rect(x, 1, 1, 6, 0x6f7380);
  p.rect(0, 2, 16, 1, C.blue);
  p.rect(0, 3, 16, 1, C.yellow);
  p.rect(0, 4, 16, 1, C.blue);
  p.rect(0, 5, 16, 1, C.red);
  p.rect(0, 0, 16, 1, 0x8d93a3);
  p.rect(0, 7, 16, 1, C.outline);
}

function drawBanner(p: Painter): void {
  // 32 x 12 KHU banner hung on the NOC wall
  p.rect(0, 0, 32, 1, 0x5d6270);
  p.rect(1, 1, 30, 10, C.outline);
  p.rect(2, 1, 28, 9, C.red);
  p.rect(2, 1, 28, 1, C.redLight);
  p.text('KHU DC', 5, 3, C.cream);
  p.dot(2, 10, C.red);
  p.dot(29, 10, C.red);
}

export function propSpecs(): TextureSpec[] {
  return [
    { key: 'water', w: 16, h: 24, unit: U, draw: drawWater },
    { key: 'tray', w: 16, h: 8, unit: U, draw: drawTray },
    { key: 'banner', w: 32, h: 12, unit: U, draw: drawBanner },
    { key: 'plant', w: 16, h: 24, unit: U, draw: (p) => p.art(PLANT, PLANT_PALETTE) },
    { key: 'box', w: 16, h: 14, unit: U, draw: (p) => p.art(BOX, BOX_PALETTE) },
  ];
}
