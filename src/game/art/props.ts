// Small props: water cooler, overhead cable tray, KHU banner, potted plant, cardboard box.
// Drawn in art px of U screen px each: a tile is 32 x 32 art px, the lion's density. Ramps come from ./palette.
import { PX } from '../pixelArt';
import type { Painter, TextureSpec } from './painter';
import { CABLE, ENAMEL, IRON, KHU_RED, LION, PLANT, STEEL, WOOD } from './palette';

/** Screen px per art px for this module's art. */
const U = PX;

type Ramp = readonly [number, number, number, number];

// Local ramps, light → dark, built around the shared cable colours.
const BLUE: Ramp = [0xb4dcff, CABLE.blue, 0x3f86cc, 0x2a5e96];
const YELLOW: Ramp = [0xffe58a, CABLE.yellow, 0xc99a1f, 0x8f6c12];
const TEAL: Ramp = [0x9aeee4, CABLE.teal, 0x2f9e94, 0x1f6e67];
const RED: Ramp = KHU_RED;
const WATER: Ramp = [0xe4f5ff, 0xa6dcfb, 0x74bdea, 0x4f97cf];
const SOIL = [0x6b4a33, 0x4f3524] as const;
const TAPE = [0xf4e7c0, 0xe4d09a, 0xc8b077] as const;
/** Cardboard in between the WOOD steps: the sunlit top edge and the front's lit edges. */
const CARD_HI = 0xf3d4a6;
const CARD_EDGE = 0xd9a86f;
/** Glaze glint on the red pot. */
const POT_GLINT = 0xf08a74;

/** Soft contact shadow on the floor under a prop. */
function contact(p: Painter, x: number, y: number, w: number): void {
  p.rect(x + 1, y, w - 2, 1, IRON[3], 0.35);
  p.rect(x, y, 1, 1, IRON[3], 0.18);
  p.rect(x + w - 1, y, 1, 1, IRON[3], 0.18);
}

function drawWater(p: Painter): void {
  // 32 x 48 water cooler: inverted bottle on an enamel cabinet, cup tube on the side
  // bottle
  const rows: [number, number, number][] = [
    [2, 12, 19],
    [3, 10, 21],
    [4, 9, 22],
    [16, 9, 22],
    [17, 10, 21],
    [18, 12, 19],
  ];
  for (let y = 2; y <= 18; y++) {
    let x0 = 9;
    let x1 = 22;
    for (const [ry, a, b] of rows) if (y === ry) [x0, x1] = [a, b];
    p.rect(x0, y, x1 - x0 + 1, 1, y <= 4 ? WATER[0] : WATER[1]);
    if (y > 4) {
      p.rect(x1 - 1, y, 2, 1, WATER[2]);
    }
  }
  p.rect(10, 5, 12, 1, WATER[0]);
  p.rect(10, 6, 1, 10, WATER[0]);
  p.rect(11, 7, 1, 7, 0xffffff, 0.8);
  for (const y of [9, 13]) {
    p.rect(10, y, 11, 1, WATER[2], 0.6);
    p.rect(10, y + 1, 11, 1, WATER[0], 0.5);
  }
  p.dot(15, 11, WATER[0]);
  p.dot(17, 8, WATER[0]);
  p.dot(16, 15, WATER[0]);
  // neck and collar
  p.rect(13, 19, 6, 2, WATER[2]);
  p.dot(13, 19, WATER[1]);
  p.rect(11, 20, 10, 1, ENAMEL[0]);
  // cabinet top
  p.rect(8, 21, 16, 1, ENAMEL[0]);
  p.rect(7, 22, 18, 1, ENAMEL[1]);
  p.rect(8, 23, 16, 1, ENAMEL[3]);
  // cabinet body
  p.rect(8, 24, 16, 21, ENAMEL[1]);
  p.rect(8, 24, 1, 21, ENAMEL[0]);
  p.rect(22, 24, 2, 21, ENAMEL[2]);
  // dispensing niche
  p.rect(10, 25, 12, 9, STEEL[1]);
  p.rect(10, 25, 12, 1, IRON[1]);
  p.rect(10, 26, 1, 8, STEEL[2]);
  p.rect(11, 26, 11, 1, STEEL[2]);
  // taps: cold (blue) and hot (red)
  for (const [x, r] of [
    [12, BLUE],
    [18, RED],
  ] as [number, Ramp][]) {
    p.rect(x, 26, 2, 1, r[0]);
    p.rect(x, 27, 2, 1, r[1]);
    p.dot(x + 1, 27, r[2]);
    p.rect(x, 28, 2, 1, STEEL[0]);
    p.dot(x + 1, 28, STEEL[2]);
  }
  // drip tray
  p.rect(10, 32, 12, 1, STEEL[0]);
  p.rect(10, 33, 12, 1, STEEL[2]);
  for (let x = 11; x < 21; x += 2) p.dot(x, 32, STEEL[2]);
  // lower door with a vent
  p.rect(9, 35, 14, 1, ENAMEL[2]);
  p.rect(9, 36, 14, 1, ENAMEL[0]);
  for (const y of [38, 40, 42]) {
    p.rect(11, y, 10, 1, ENAMEL[3]);
    p.rect(11, y + 1, 10, 1, ENAMEL[0]);
  }
  // cup tube on the right side
  p.rect(24, 25, 1, 10, ENAMEL[3]);
  p.rect(25, 24, 3, 11, ENAMEL[0]);
  p.rect(27, 24, 1, 11, ENAMEL[2]);
  p.rect(25, 24, 3, 1, ENAMEL[1]);
  for (let y = 26; y < 34; y += 2) p.rect(25, y, 2, 1, ENAMEL[1]);
  p.rect(25, 35, 3, 1, ENAMEL[2]);
  // plinth, darkest where it meets the floor
  p.rect(8, 45, 16, 1, STEEL[2]);
  p.rect(8, 46, 16, 1, IRON[1]);
  contact(p, 6, 47, 20);
  p.rect(9, 47, 14, 1, IRON[3]);
}

function drawTray(p: Painter): void {
  // 32 x 16 overhead ladder tray carrying a cable bundle; repeats every tile
  // tray bed seen between the rungs
  p.rect(0, 3, 32, 10, IRON[2]);
  for (const x of [2, 10, 18, 26]) {
    p.rect(x, 3, 3, 10, STEEL[1]);
    p.rect(x, 3, 1, 10, STEEL[0]);
    p.rect(x + 2, 3, 1, 10, STEEL[2]);
  }
  // the bundle's shadow on the rungs below it
  p.rect(0, 11, 32, 1, IRON[3], 0.55);
  // cable bundle, each cable lit on top: patch (blue), fibre (yellow), patch (teal), power (red)
  p.rect(0, 5, 32, 1, BLUE[0]);
  p.rect(0, 6, 32, 1, BLUE[1]);
  p.rect(0, 7, 32, 1, YELLOW[1]);
  p.rect(0, 8, 32, 1, TEAL[0]);
  p.rect(0, 9, 32, 1, TEAL[1]);
  p.rect(0, 10, 32, 1, RED[1]);
  // a few twists so the run doesn't look painted on
  for (const [x, y, c] of [
    [5, 6, BLUE[2]],
    [6, 5, BLUE[1]],
    [13, 7, YELLOW[0]],
    [29, 7, YELLOW[2]],
    [11, 9, TEAL[2]],
    [12, 8, TEAL[1]],
    [27, 10, RED[0]],
    [16, 10, RED[2]],
  ])
    p.dot(x, y, c);
  // velcro tie around the bundle
  p.rect(22, 5, 2, 6, IRON[1]);
  p.dot(22, 5, IRON[0]);
  p.dot(23, 10, IRON[2]);
  // rails: back (top) and front (bottom, its face shows)
  p.rect(0, 0, 32, 1, STEEL[0]);
  p.rect(0, 1, 32, 1, STEEL[1]);
  p.rect(0, 2, 32, 1, STEEL[2]);
  p.rect(0, 13, 32, 1, STEEL[0]);
  p.rect(0, 14, 32, 1, STEEL[1]);
  p.rect(0, 15, 32, 1, STEEL[3]);
  for (const x of [6, 22]) p.dot(x, 14, STEEL[2]);
}

/** Bold 6 x 8 capitals for the banner, 2-ap strokes. */
const BANNER_GLYPHS: Record<string, string[]> = {
  K: ['##..##', '##..##', '##.##.', '####..', '####..', '##.##.', '##..##', '##..##'],
  H: ['##..##', '##..##', '##..##', '######', '######', '##..##', '##..##', '##..##'],
  U: ['##..##', '##..##', '##..##', '##..##', '##..##', '##..##', '######', '.####.'],
  D: ['#####.', '######', '##..##', '##..##', '##..##', '##..##', '######', '#####.'],
  C: ['.#####', '######', '##....', '##....', '##....', '##....', '######', '.#####'],
};

function bannerText(p: Painter, s: string, x: number, y: number): void {
  for (const pass of [0, 1]) {
    let cx = x;
    for (const ch of s) {
      const g = BANNER_GLYPHS[ch];
      if (g) {
        g.forEach((row, gy) =>
          [...row].forEach((v, gx) => {
            if (v !== '#') return;
            if (pass === 0) p.dot(cx + gx + 1, y + gy + 1, KHU_RED[3]);
            else p.dot(cx + gx, y + gy, gy >= 6 ? LION.shirt[2] : LION.shirt[1]);
          }),
        );
        cx += 8;
      } else cx += 4;
    }
  }
}

function drawBanner(p: Painter): void {
  // 64 x 24 KHU banner hung from a rod on the wall, gold fringe along the bottom
  p.rect(3, 2, 58, 19, KHU_RED[1]);
  p.rect(3, 2, 1, 19, KHU_RED[0]);
  p.rect(60, 2, 1, 19, KHU_RED[2]);
  p.rect(4, 2, 56, 1, KHU_RED[3]);
  p.rect(4, 3, 56, 1, KHU_RED[0]);
  p.rect(4, 20, 57, 1, KHU_RED[2]);
  // gentle folds
  for (const x of [20, 43]) {
    p.rect(x, 4, 1, 16, KHU_RED[2], 0.45);
    p.rect(x + 1, 4, 1, 16, KHU_RED[0], 0.3);
  }
  // gold trim and lettering
  p.rect(5, 5, 54, 1, LION.fur[1]);
  p.rect(5, 17, 54, 1, LION.fur[2]);
  bannerText(p, 'KHU DC', 11, 7);
  // fringe
  for (let x = 4; x < 60; x += 2) {
    p.rect(x, 21, 1, 2, LION.fur[1]);
    p.dot(x, 23, LION.fur[2]);
  }
  // rod with knobs
  p.rect(2, 0, 60, 1, STEEL[0]);
  p.rect(2, 1, 60, 1, STEEL[2]);
  for (const x of [0, 62]) {
    p.rect(x, 0, 2, 2, WOOD[1]);
    p.dot(x, 0, WOOD[0]);
    p.dot(x + 1, 1, WOOD[2]);
  }
}

/**
 * One oval leaf along a gently drooping axis from (x0, y0), `tone` picks its place on the PLANT ramp (1 front, 2 back).
 * The half facing the top-left light is lighter and its edge lighter still; the far edge takes the next darker green,
 * so overlapping leaves stay apart without an outline.
 */
function leaf(p: Painter, x0: number, y0: number, angle: number, len: number, wid: number, tone: number, droop: number): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const nx = -dy;
  const ny = dx;
  const pts: { x: number; y: number; f: number; nx: number; ny: number }[] = [];
  for (let t = 0; t <= len; t += 0.25) {
    const f = t / len;
    // tangent of the bent axis, for the local normal
    const tx = dx + nx * droop * 2 * f;
    const ty = dy + ny * droop * 2 * f;
    const tl = Math.hypot(tx, ty);
    pts.push({ x: x0 + dx * t + nx * droop * f * f * len, y: y0 + dy * t + ny * droop * f * f * len, f, nx: -ty / tl, ny: tx / tl });
  }
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  const r = wid / 2 + 1;
  const hi = PLANT[Math.max(0, tone - 1)];
  const lit = PLANT[tone];
  const shade = PLANT[Math.min(3, tone + 1)];
  const rim = PLANT[Math.min(3, tone + 2)];
  for (let y = Math.floor(Math.min(...ys) - r); y <= Math.ceil(Math.max(...ys) + r); y++) {
    for (let x = Math.floor(Math.min(...xs) - r); x <= Math.ceil(Math.max(...xs) + r); x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      let best = pts[0];
      let bd = Infinity;
      for (const q of pts) {
        const d = (cx - q.x) ** 2 + (cy - q.y) ** 2;
        if (d < bd) [bd, best] = [d, q];
      }
      const half = (wid / 2) * Math.pow(Math.max(0, 1 - (2 * best.f - 1) ** 2), 0.6) * (1 - 0.25 * best.f);
      const v = (cx - best.x) * best.nx + (cy - best.y) * best.ny;
      if (Math.sqrt(bd) > half) continue;
      // light comes from the top-left: the side whose normal points up/left is lit
      const litSide = v * (-best.nx - best.ny) > 0;
      let c: number;
      if (Math.abs(v) > half - 1) c = litSide ? hi : rim;
      else if (Math.abs(v) < 0.5 && best.f > 0.12 && best.f < 0.8) c = shade;
      else c = litSide ? lit : shade;
      if (x >= 0 && y >= 0 && x < 32 && y < 48) p.dot(x, y, c);
    }
  }
}

function drawPlant(p: Painter): void {
  // 32 x 48 leafy plant in a KHU red pot
  const deg = Math.PI / 180;
  // stems
  for (const [x, y] of [
    [11, 18],
    [21, 18],
    [16, 12],
  ]) {
    const n = 16;
    for (let i = 0; i <= n; i++) p.dot(Math.round(16 + ((x - 16) * i) / n), Math.round(32 + ((y - 32) * i) / n), PLANT[3]);
  }
  // back leaves (darker): [origin x, origin y, angle, length, width, droop]
  for (const [x, y, a, l, w, d] of [
    [12, 20, -150, 12, 8, -0.2],
    [20, 20, -30, 12, 8, 0.2],
    [14, 14, -120, 12, 8, -0.1],
    [18, 14, -60, 12, 8, 0.1],
    [16, 12, -90, 11, 8, 0],
    [12, 27, -175, 11, 7, -0.3],
    [20, 27, -5, 11, 7, 0.3],
  ])
    leaf(p, x, y, a * deg, l, w, 2, d);
  // pot
  p.rect(9, 32, 14, 1, KHU_RED[2]);
  p.rect(10, 33, 12, 1, SOIL[1]);
  p.rect(12, 33, 5, 1, SOIL[0]);
  p.dot(9, 33, KHU_RED[1]);
  p.dot(22, 33, KHU_RED[2]);
  p.rect(8, 34, 16, 1, KHU_RED[0]);
  p.rect(8, 35, 16, 2, KHU_RED[1]);
  p.rect(8, 35, 1, 2, KHU_RED[0]);
  p.rect(23, 34, 1, 3, KHU_RED[2]);
  p.rect(9, 37, 14, 1, KHU_RED[3]);
  for (let y = 38; y <= 46; y++) {
    const inset = y >= 44 ? 2 : y >= 41 ? 1 : 0;
    const x0 = 10 + inset;
    const x1 = 21 - inset;
    p.rect(x0, y, x1 - x0 + 1, 1, KHU_RED[1]);
    p.rect(x0, y, 2, 1, KHU_RED[0]);
    p.rect(x1 - 1, y, 2, 1, KHU_RED[2]);
  }
  p.rect(13, 38, 1, 8, POT_GLINT, 0.6);
  contact(p, 9, 47, 14);
  p.rect(12, 47, 8, 1, KHU_RED[3]);
  // front leaves (lighter), spilling over the rim
  for (const [x, y, a, l, w, d] of [
    [14, 22, -135, 11, 8, -0.15],
    [18, 22, -45, 11, 8, 0.15],
    [16, 19, -95, 10, 8, 0],
    [13, 30, -165, 11, 7, -0.3],
    [19, 30, -15, 11, 7, 0.3],
  ])
    leaf(p, x, y, a * deg, l, w, 1, d);
}

function drawBox(p: Painter): void {
  // 32 x 28 cardboard server box: lit top, front with a shipping label and a red "this side up" tag
  // top face
  p.rect(2, 0, 28, 1, WOOD[1]);
  p.rect(1, 1, 30, 7, WOOD[0]);
  p.rect(1, 1, 30, 1, CARD_HI);
  p.rect(30, 1, 1, 7, WOOD[1]);
  // front face: lit left edge and fold, shaded right edge, darkest where it meets the floor
  p.rect(1, 8, 30, 20, WOOD[1]);
  p.rect(1, 8, 30, 1, CARD_EDGE);
  p.rect(1, 9, 1, 17, CARD_EDGE);
  p.rect(2, 9, 27, 1, WOOD[2], 0.5);
  p.rect(29, 9, 2, 17, WOOD[2]);
  p.rect(30, 8, 1, 1, WOOD[2]);
  p.rect(1, 26, 30, 1, WOOD[2]);
  p.rect(1, 27, 30, 1, WOOD[3]);
  // tape over the flap seam, running down the front to a torn end
  p.rect(14, 0, 4, 8, TAPE[0]);
  p.rect(17, 0, 1, 8, TAPE[1]);
  p.rect(14, 8, 4, 6, TAPE[1]);
  p.rect(17, 8, 1, 6, TAPE[2]);
  p.dot(14, 14, TAPE[1]);
  p.dot(16, 14, TAPE[1]);
  // shipping label with a barcode
  p.rect(4, 15, 10, 9, LION.shirt[1]);
  p.rect(13, 16, 1, 8, LION.shirt[2]);
  p.rect(5, 23, 9, 1, LION.shirt[2]);
  p.rect(5, 16, 6, 1, STEEL[1]);
  p.rect(5, 18, 4, 1, STEEL[1]);
  for (const x of [5, 7, 8, 10, 12]) p.rect(x, 20, 1, 3, IRON[1]);
  // red "this side up" tag
  p.rect(19, 14, 9, 9, KHU_RED[1]);
  p.rect(19, 14, 9, 1, KHU_RED[0]);
  p.rect(27, 15, 1, 8, KHU_RED[2]);
  p.rect(20, 22, 7, 1, KHU_RED[2]);
  p.art(['...#...', '..###..', '.#####.', '#######', '..###..', '..###..'], { '#': LION.shirt[1] }, 20, 15);
}

export function propSpecs(): TextureSpec[] {
  return [
    { key: 'water', w: 32, h: 48, unit: U, draw: drawWater },
    { key: 'tray', w: 32, h: 16, unit: U, draw: drawTray },
    { key: 'banner', w: 64, h: 24, unit: U, draw: drawBanner },
    { key: 'plant', w: 32, h: 48, unit: U, draw: drawPlant },
    { key: 'box', w: 32, h: 28, unit: U, draw: drawBox },
  ];
}
