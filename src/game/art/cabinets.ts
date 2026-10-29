// Network and power cabinets: TOR switch, border router, patch panel, PDU, UPS.
// Drawn in art px of U screen px each; layout constants are screen px relative to the texture's top-left.
import { COLORS as C, OLD_UNIT } from '../pixelArt';
import type { Painter, TextureSpec } from './painter';

/** Screen px per art px for this module's art (old 16-px-per-tile art until it is redrawn). */
const U = OLD_UNIT;

export const CABINET_TEX = { w: 32 * U, h: 40 * U, top: 8 * U };

/** Switch port LED i (0..15): two rows of eight (Gi1/0/1–8 on top; Gi1/0/9–12 and Te1/1/1–4 below). */
export function switchLed(i: number) {
  return { x: (4 + (i % 8) * 3) * U, y: (12 + Math.floor(i / 8) * 3) * U, w: 2 * U, h: U };
}
export const ROUTER_LEDS = {
  wan: { x: 8 * U, y: 12 * U, w: 2 * U, h: U },
  lan: { x: 14 * U, y: 12 * U, w: 2 * U, h: U },
};
export const PATCH_LED = { x: 26 * U, y: 10 * U, w: 2 * U, h: 2 * U };
export const PDU_LEDS = {
  A: { x: 8 * U, y: 13 * U, w: 2 * U, h: 2 * U },
  B: { x: 21 * U, y: 13 * U, w: 2 * U, h: 2 * U },
};
export const UPS_LCD = { x: 7 * U, y: 12 * U, w: 18 * U, h: 5 * U };
export const UPS_LED = { x: 24 * U, y: 20 * U, w: 2 * U, h: 2 * U };

function drawCabinet(p: Painter, accent: number): void {
  p.rect(0, 0, 32, 40, C.outline);
  p.rect(1, 1, 30, 7, 0x4b4f5c);
  p.rect(4, 3, 24, 1, 0x3a3d48);
  p.rect(4, 5, 24, 1, 0x3a3d48);
  p.rect(1, 7, 30, 1, 0x6a6f7d);
  p.rect(1, 8, 30, 31, C.rack);
  p.rect(1, 8, 1, 31, 0x40434f);
  p.rect(30, 8, 1, 31, 0x22242b);
  p.rect(3, 9, 26, 29, 0x17181d);
  p.rect(2, 9, 1, 29, 0x5d6270);
  p.rect(29, 9, 1, 29, 0x5d6270);
  p.rect(3, 9, 3, 1, accent);
  p.rect(2, 39, 4, 1, C.outline);
  p.rect(26, 39, 4, 1, C.outline);
}

function hangingCables(p: Painter, xs: number[], fromY: number, toY: number): void {
  const colors = [C.blue, C.yellow, 0x4fd1c5, C.red, 0x9b7bff];
  xs.forEach((x, i) => {
    const col = colors[i % colors.length];
    for (let y = fromY; y < toY; y++) {
      const sway = Math.round(Math.sin((y - fromY) / 3 + i) * 0.8);
      p.dot(x + sway, y, col);
    }
  });
}

function drawSwitch(p: Painter): void {
  drawCabinet(p, C.blue);
  p.box(3, 10, 26, 9, 0x2d3a5a, C.outline);
  p.rect(4, 11, 24, 1, 0x3f4f78);
  for (let i = 0; i < 16; i++) {
    const x = 4 + (i % 8) * 3;
    const y = 13 + Math.floor(i / 8) * 3;
    p.rect(x, y, 2, 2, 0x0d0e12);
    p.rect(x, y, 2, 1, 0x1f2129);
  }
  hangingCables(p, [6, 10, 14, 18, 22, 26], 19, 37);
}

function drawRouter(p: Painter): void {
  drawCabinet(p, C.amber);
  p.box(3, 10, 26, 9, 0x3a2f4a, C.outline);
  p.rect(4, 11, 24, 1, 0x4e4063);
  for (const x of [8, 14]) {
    p.rect(x, 13, 2, 2, 0x0d0e12);
    p.rect(x, 13, 2, 1, 0x1f2129);
  }
  // globe icon
  p.circle(23, 14, 3, 0x6ab7ff);
  p.rect(20, 14, 7, 1, 0x2d5f8f);
  p.rect(23, 11, 1, 7, 0x2d5f8f);
  hangingCables(p, [9, 15], 19, 37);
  // second, idle unit
  p.box(3, 26, 26, 5, 0x2b2d36, C.outline);
  for (let x = 6; x < 26; x += 3) p.dot(x, 28, 0x4a4d58);
}

function drawPatch(p: Painter): void {
  drawCabinet(p, 0x4fd1c5);
  for (const y0 of [11, 18, 25]) {
    p.box(3, y0, 26, 5, 0x3a3d48, C.outline);
    for (let x = 5; x < 27; x += 2) p.dot(x, y0 + 2, 0x0d0e12);
  }
  // looping patch cords
  const colors = [C.blue, C.yellow, C.red, 0x4fd1c5, 0x9b7bff, C.green];
  colors.forEach((col, i) => {
    const x = 6 + i * 3;
    for (let y = 13; y < 26; y++) p.dot(x + Math.round(Math.sin(y / 2 + i) * 1.2), y, col);
  });
  p.rect(25, 9, 4, 4, 0x2a2c33);
}

function drawPdu(p: Painter): void {
  p.rect(0, 0, 32, 40, C.outline);
  p.rect(1, 1, 30, 7, 0x9fa3ad);
  p.rect(1, 7, 30, 1, 0xc7cad2);
  p.rect(1, 8, 30, 31, 0xb9bcc4);
  p.rect(1, 8, 1, 31, 0xd2d4da);
  p.rect(30, 8, 1, 31, 0x8e929c);
  // two breaker columns: A (red) and B (navy)
  p.box(4, 10, 11, 26, 0xa3a7b1, C.outline);
  p.box(17, 10, 11, 26, 0xa3a7b1, C.outline);
  p.rect(5, 11, 9, 2, C.red);
  p.rect(18, 11, 9, 2, C.navy);
  p.text('A', 11, 13, C.outline);
  p.text('B', 24, 13, C.outline);
  for (let y = 17; y < 34; y += 3) {
    p.rect(6, y, 7, 2, 0x2b2e38);
    p.rect(19, y, 7, 2, 0x2b2e38);
    p.rect(7, y, 2, 2, 0xe6e7eb);
    p.rect(20, y, 2, 2, 0xe6e7eb);
  }
  // lightning sticker
  p.rect(14, 2, 4, 5, C.yellow);
  p.dot(16, 3, C.outline);
  p.dot(15, 4, C.outline);
  p.dot(16, 5, C.outline);
  p.rect(2, 39, 4, 1, C.outline);
  p.rect(26, 39, 4, 1, C.outline);
}

function drawUps(p: Painter): void {
  p.rect(0, 0, 32, 40, C.outline);
  p.rect(1, 1, 30, 7, 0x3a3a42);
  p.rect(4, 3, 24, 1, 0x2a2a30);
  p.rect(1, 7, 30, 1, 0x55555f);
  p.rect(1, 8, 30, 31, 0x2a2a30);
  p.rect(1, 8, 1, 31, 0x3d3d46);
  // LCD frame (the scene paints the screen colour on top)
  p.rect(6, 11, 20, 7, 0x16161a);
  p.rect(7, 12, 18, 5, 0x3c6e4a);
  p.text('UPS', 4, 20, 0xd0d0d8);
  // battery bars
  for (let i = 0; i < 4; i++) p.box(5 + i * 5, 27, 4, 7, 0x4a4a54, C.outline);
  for (let i = 0; i < 4; i++) p.rect(6 + i * 5, 30, 2, 3, C.green);
  p.rect(2, 39, 4, 1, C.outline);
  p.rect(26, 39, 4, 1, C.outline);
}

export function cabinetSpecs(): TextureSpec[] {
  return [
    { key: 'switch', w: 32, h: 40, unit: U, draw: drawSwitch },
    { key: 'router', w: 32, h: 40, unit: U, draw: drawRouter },
    { key: 'patch', w: 32, h: 40, unit: U, draw: drawPatch },
    { key: 'pdu', w: 32, h: 40, unit: U, draw: drawPdu },
    { key: 'ups', w: 32, h: 40, unit: U, draw: drawUps },
  ];
}
