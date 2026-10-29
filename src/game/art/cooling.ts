// The CRAC (항온항습기) unit, its spinning fan and the grille over it.
// Drawn in art px of U screen px each; layout constants are screen px relative to the texture's top-left.
import { COLORS as C, PX } from '../pixelArt';
import type { Painter, TextureSpec } from './painter';

/** Screen px per art px for this module's art. */
const U = PX;

export const CRAC_TEX = {
  w: 48 * U,
  h: 56 * U,
  top: 8 * U,
  /** Centre of the fan opening */
  fanX: 24.5 * U,
  fanY: 33.5 * U,
  led: { x: 39 * U, y: 11 * U, w: 3 * U, h: 3 * U },
  display: { x: 5 * U, y: 10 * U, w: 12 * U, h: 5 * U },
};

function drawCrac(p: Painter): void {
  p.rect(0, 0, 48, 56, C.outline);
  // top with intake grille
  p.rect(1, 1, 46, 7, 0xc8ccd3);
  for (let x = 4; x < 44; x += 3) p.rect(x, 2, 1, 5, 0x9ea3ad);
  p.rect(1, 7, 46, 1, 0xeef0f3);
  // body
  p.rect(1, 8, 46, 47, 0xdfe3e8);
  p.rect(1, 8, 1, 47, 0xf1f3f6);
  p.rect(46, 8, 1, 47, 0xb6bbc4);
  // control panel
  p.box(3, 9, 42, 7, 0xc3c8d0, C.outline);
  p.rect(5, 10, 12, 5, 0x1b2a2a);
  p.text('CRAC', 20, 10, C.navy);
  p.rect(39, 11, 3, 3, 0x2a2c33);
  // KHU stripe
  p.rect(2, 17, 44, 1, C.red);
  // fan housing
  p.circle(24, 33, 14, 0x9ea3ad);
  p.circle(24, 33, 13, 0x4a4f5a);
  p.circle(24, 33, 12, 0x15171c);
  // bottom vents
  for (let y = 48; y < 53; y += 2) p.rect(5, y, 38, 1, 0xaab0ba);
  p.rect(2, 55, 6, 1, C.outline);
  p.rect(40, 55, 6, 1, C.outline);
}

function drawFan(p: Painter): void {
  // 22 x 22 pixels, centre at (11, 11): four swept blades + hub
  const blade = (dx: number, dy: number) => {
    for (let i = 2; i <= 9; i++) {
      const w = i < 4 ? 2 : i < 8 ? 3 : 2;
      for (let j = 0; j < w; j++) {
        // perpendicular offset gives the swept look
        const px = 11 + dx * i - dy * (j - 1 + Math.floor(i / 4));
        const py = 11 + dy * i + dx * (j - 1 + Math.floor(i / 4));
        p.dot(px, py, j === 0 ? 0xd7dce4 : 0xaab1bd);
      }
    }
  };
  blade(1, 0);
  blade(-1, 0);
  blade(0, 1);
  blade(0, -1);
  p.circle(11, 11, 2, 0x6a707c);
  p.dot(11, 11, 0xd7dce4);
}

function drawFanGrille(p: Painter): void {
  // 26 x 26 pixels, centre (13, 13): rings + cross bars, transparent between
  const ring = (r: number) => {
    for (let a = 0; a < 360; a += 4) {
      const x = Math.round(13 + Math.cos((a * Math.PI) / 180) * r);
      const y = Math.round(13 + Math.sin((a * Math.PI) / 180) * r);
      p.dot(x, y, 0x8a909b);
    }
  };
  ring(12);
  ring(8);
  ring(4);
  p.rect(1, 13, 25, 1, 0x8a909b);
  p.rect(13, 1, 1, 25, 0x8a909b);
}

export function coolingSpecs(): TextureSpec[] {
  return [
    { key: 'crac', w: 48, h: 56, unit: U, draw: drawCrac },
    { key: 'crac-fan', w: 22, h: 22, unit: U, draw: drawFan },
    { key: 'crac-grille', w: 27, h: 27, unit: U, draw: drawFanGrille },
  ];
}
