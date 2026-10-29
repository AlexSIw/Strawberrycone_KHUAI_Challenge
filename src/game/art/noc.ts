// Ops-room furniture: the NOC monitor wall, the admin desk, chairs and the design whiteboard.
// Drawn in art px of U screen px each; layout constants are screen px relative to the texture's top-left.
import { COLORS as C, OLD_UNIT } from '../pixelArt';
import type { Painter, TextureSpec } from './painter';

/** Screen px per art px for this module's art (old 16-px-per-tile art until it is redrawn). */
const U = OLD_UNIT;

export const MONITOR_TEX = { w: 48 * U, h: 32 * U };
/** Screens on the NOC monitor wall (tinted red/amber during incidents). */
export const MONITOR_SCREENS = [0, 1, 2].flatMap((col) =>
  [0, 1].map((row) => ({ x: (3 + col * 15) * U, y: (3 + row * 10) * U, w: 13 * U, h: 8 * U })),
);

export const DESK_TEX = { w: 32 * U, h: 24 * U };
export const BOARD_TEX = { w: 32 * U, h: 32 * U };

function drawMonitorWall(p: Painter): void {
  // wall bracket
  p.rect(1, 1, 46, 21, 0x2a2230);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 2; row++) {
      const x = 2 + col * 15;
      const y = 2 + row * 10;
      p.box(x, y, 15, 10, 0x0f1626, C.outline);
      // screen content
      const sx = x + 1;
      const sy = y + 1;
      const kind = (col + row * 3) % 4;
      if (kind === 0) {
        // line graph
        const ys = [6, 5, 5, 3, 4, 2, 3, 2, 1, 2, 1, 1, 2];
        ys.forEach((v, i) => p.dot(sx + i, sy + v, C.green));
        p.rect(sx, sy + 7, 13, 1, 0x24324a);
      } else if (kind === 1) {
        // bars
        [3, 5, 2, 6, 4, 5].forEach((h, i) => p.rect(sx + 1 + i * 2, sy + 7 - h, 1, h, C.blue));
      } else if (kind === 2) {
        // status list
        for (let i = 0; i < 3; i++) {
          p.rect(sx + 1, sy + 1 + i * 2, 1, 1, C.green);
          p.rect(sx + 3, sy + 1 + i * 2, 7 - i, 1, 0x7d8db0);
        }
      } else {
        // network map
        p.dot(sx + 6, sy + 1, C.amber);
        for (const [dx, dy] of [[2, 5], [6, 6], [10, 5]]) {
          p.dot(sx + dx, sy + dy, C.green);
        }
        p.rect(sx + 3, sy + 3, 7, 1, 0x3e5a7a);
        p.rect(sx + 6, sy + 2, 1, 3, 0x3e5a7a);
      }
    }
  }
  // console counter on the floor in front
  p.rect(0, 22, 48, 10, C.outline);
  p.rect(1, 23, 46, 3, 0x5b4e66);
  p.rect(1, 23, 46, 1, 0x76688a);
  p.rect(1, 26, 46, 5, 0x3a3040);
  for (let x = 6; x < 44; x += 10) p.rect(x, 24, 5, 1, 0x2a2230);
  p.rect(2, 28, 44, 1, C.red);
}

function drawDesk(p: Painter): void {
  // monitor
  p.rect(9, 0, 15, 11, C.outline);
  p.rect(10, 1, 13, 8, 0x0f1626);
  for (let i = 0; i < 4; i++) p.rect(11, 2 + i * 2, 3 + ((i * 5) % 8), 1, C.green);
  p.dot(11 + 3 + ((3 * 5) % 8) + 1, 8, C.green);
  p.rect(15, 11, 3, 2, 0x2b2e38);
  // desk top (3/4 view) + front
  p.rect(0, 12, 32, 12, C.outline);
  p.rect(1, 13, 30, 4, C.tan);
  p.rect(1, 13, 30, 1, C.tanLight);
  p.rect(1, 17, 30, 6, C.tanDark);
  p.rect(20, 18, 9, 4, 0xa9763f);
  p.rect(23, 19, 3, 1, C.outline);
  p.rect(3, 18, 2, 5, 0x8a5a2e);
  // keyboard + mouse + KHU mug
  p.rect(10, 14, 12, 2, 0xd0d2da);
  p.rect(10, 15, 12, 1, 0x9da1ad);
  p.rect(24, 14, 2, 2, 0xd0d2da);
  p.rect(4, 12, 3, 4, C.red);
  p.dot(7, 13, C.red);
  p.rect(4, 12, 3, 1, C.cream);
}

function drawChair(p: Painter): void {
  p.rect(3, 1, 10, 9, C.outline);
  p.rect(4, 2, 8, 7, C.navy);
  p.rect(4, 2, 8, 1, C.navyLight);
  p.rect(5, 4, 6, 1, C.red);
  p.rect(2, 9, 12, 3, C.outline);
  p.rect(3, 10, 10, 1, C.navyDark);
  p.rect(7, 12, 2, 2, 0x2b2e38);
  p.rect(3, 14, 10, 1, 0x2b2e38);
  p.dot(3, 15, C.outline);
  p.dot(12, 15, C.outline);
  p.dot(8, 15, C.outline);
}

function drawWhiteboard(p: Painter): void {
  // board on a wheeled stand: 32 x 32 pixels
  p.rect(0, 1, 32, 20, C.outline);
  p.rect(1, 2, 30, 18, 0x9ea3ad);
  p.rect(2, 3, 28, 16, 0xf7f7f2);
  // architecture sketch: boxes and arrows
  p.box(3, 5, 7, 4, 0xf7f7f2, C.navy);
  p.box(12, 5, 7, 4, 0xf7f7f2, C.navy);
  p.box(3, 12, 7, 4, 0xf7f7f2, C.red);
  p.box(12, 12, 7, 4, 0xf7f7f2, C.red);
  p.rect(10, 7, 2, 1, C.red);
  p.rect(6, 9, 1, 3, C.red);
  p.rect(15, 9, 1, 3, C.red);
  p.text('API', 19, 6, C.navy);
  p.rect(21, 13, 6, 1, 0x3f9b4f);
  p.rect(21, 15, 4, 1, 0x3f9b4f);
  // marker tray
  p.rect(3, 20, 26, 1, 0x6a6f7d);
  p.dot(6, 19, C.red);
  p.dot(8, 19, C.navy);
  // legs + wheels
  p.rect(4, 21, 2, 9, 0x5d6270);
  p.rect(26, 21, 2, 9, 0x5d6270);
  p.rect(2, 29, 28, 1, 0x5d6270);
  for (const x of [2, 7, 24, 29]) p.dot(x, 30, C.outline);
}

export function nocSpecs(): TextureSpec[] {
  return [
    { key: 'monitor-wall', w: 48, h: 32, unit: U, draw: drawMonitorWall },
    { key: 'desk', w: 32, h: 24, unit: U, draw: drawDesk },
    { key: 'chair', w: 16, h: 16, unit: U, draw: drawChair },
    { key: 'whiteboard', w: 32, h: 32, unit: U, draw: drawWhiteboard },
  ];
}
