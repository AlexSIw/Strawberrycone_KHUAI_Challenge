// Room floors, walls and doors (one tile each).
// Drawn in art px of U screen px each: a tile is 32 x 32 art px, the lion's density. Ramps come from ./palette.
import { PX } from '../pixelArt';
import { rng, type Painter, type TextureSpec } from './painter';
import { CABLE, FLOOR, IRON, KHU_RED, LED, STEEL, WALL, WALL_PANEL } from './palette';

/** Screen px per art px for this module's art. */
const U = PX;
/** Art px per tile side. */
const T = 32;

type Ramp = readonly [number, number, number, number];
type Pattern = 'perforated' | 'grille' | 'grate' | 'terrazzo' | 'concrete' | 'carpet';

const FLOORS: Record<string, { ramp: Ramp; pattern: Pattern }> = {
  server: { ramp: FLOOR.server, pattern: 'perforated' },
  network: { ramp: FLOOR.network, pattern: 'grille' },
  cooling: { ramp: FLOOR.cooling, pattern: 'grate' },
  corridor: { ramp: FLOOR.corridor, pattern: 'terrazzo' },
  power: { ramp: FLOOR.power, pattern: 'concrete' },
  noc: { ramp: FLOOR.noc, pattern: 'carpet' },
};

/** Light sliding-door glass, light → dark. */
const GLASS = [0xe6f6fd, 0xb4dcf0, 0x86bcdc, 0x6497bd] as const;
/** Green door lamp, light → dark. */
const LAMP = [0xb8f5c8, LED.green, 0x2f9e5a] as const;

/** Raised-floor panel: lit top/left edge, shaded bottom/right edge, so neighbouring panels read as a grid. */
function panel(p: Painter, r: Ramp): void {
  p.rect(0, 0, T, T, r[1]);
  p.rect(0, 0, T, 1, r[0]);
  p.rect(0, 0, 1, T, r[0]);
  p.rect(0, T - 1, T, 1, r[2]);
  p.rect(T - 1, 0, 1, T, r[2]);
}

/** Domed screw head: lit top-left, shaded bottom-right. */
function screw(p: Painter, x: number, y: number, r: Ramp): void {
  p.dot(x, y, r[0]);
  p.dot(x + 1, y, r[2]);
  p.dot(x, y + 1, r[2]);
  p.dot(x + 1, y + 1, r[3]);
}

function cornerScrews(p: Painter, r: Ramp): void {
  for (const [x, y] of [
    [3, 3],
    [27, 3],
    [3, 27],
    [27, 27],
  ])
    screw(p, x, y, r);
}

/** Scattered 1-ap flecks inside [x0, x1) x [y0, y1). */
function speckle(p: Painter, rand: () => number, n: number, colors: readonly number[], alpha: number, x0 = 1, y0 = 1, x1 = T - 1, y1 = T - 1): void {
  for (let i = 0; i < n; i++) {
    const x = x0 + Math.floor(rand() * (x1 - x0));
    const y = y0 + Math.floor(rand() * (y1 - y0));
    p.dot(x, y, colors[Math.floor(rand() * colors.length)], alpha);
  }
}

function drawFloor(p: Painter, r: Ramp, pattern: Pattern, variant: number, seed: number): void {
  const rand = rng(seed);
  switch (pattern) {
    case 'perforated':
      // Server room raised floor: perforated "cold aisle" panels (0) and solid panels (1).
      panel(p, r);
      if (variant === 0) {
        p.rect(4, 4, 24, 1, r[2], 0.5);
        p.rect(4, 4, 1, 24, r[2], 0.5);
        p.rect(4, 27, 24, 1, r[0], 0.6);
        p.rect(27, 4, 1, 24, r[0], 0.6);
        for (let y = 6; y <= 25; y += 3) for (let x = 6; x <= 25; x += 3) p.dot(x, y, r[3], 0.75);
      } else {
        cornerScrews(p, r);
        speckle(p, rand, 10, [r[0], r[2]], 0.45, 6, 6, 26, 26);
      }
      break;
    case 'grille':
      // Network room: grille vent panels (0) checkered with solid panels (1).
      panel(p, r);
      if (variant === 0) {
        // square-hole grille: each hole shaded on its top/left inner edge
        for (let y = 5; y <= 25; y += 4)
          for (let x = 5; x <= 25; x += 4) {
            p.rect(x, y, 2, 2, r[2]);
            p.rect(x, y, 2, 1, r[3], 0.8);
            p.dot(x, y + 1, r[3], 0.8);
          }
      } else {
        cornerScrews(p, r);
        speckle(p, rand, 10, [r[0], r[2]], 0.45, 6, 6, 26, 26);
      }
      break;
    case 'grate': {
      // Cooling room: bar grating over the under-floor plenum, bars run across (0) or down (1).
      p.rect(0, 0, T, T, r[1]);
      for (let k = 3; k < T - 2; k += 3) {
        if (variant === 0) {
          p.rect(2, k, T - 4, 1, r[3], 0.65);
          p.rect(2, k + 1, T - 4, 1, r[0], 0.45);
        } else {
          p.rect(k, 2, 1, T - 4, r[3], 0.65);
          p.rect(k + 1, 2, 1, T - 4, r[0], 0.45);
        }
      }
      // frame
      p.rect(0, 0, T, 2, r[1]);
      p.rect(0, 0, 2, T, r[1]);
      p.rect(0, T - 2, T, 2, r[1]);
      p.rect(T - 2, 0, 2, T, r[1]);
      p.rect(0, 0, T, 1, r[0]);
      p.rect(0, 0, 1, T, r[0]);
      p.rect(0, T - 1, T, 1, r[2]);
      p.rect(T - 1, 0, 1, T, r[2]);
      break;
    }
    case 'terrazzo':
      // Corridor: lilac-grey vinyl tiles with chips; faint seams.
      p.rect(0, 0, T, T, r[1]);
      speckle(p, rand, 34, [r[0], r[2]], 0.7);
      speckle(p, rand, 8, [r[3]], 0.35);
      for (let i = 0; i < 4; i++) {
        const x = 2 + Math.floor(rand() * 27);
        const y = 2 + Math.floor(rand() * 27);
        p.rect(x, y, 2, 1, rand() > 0.5 ? r[0] : r[2], 0.6);
      }
      if (variant === 1) {
        // a soft scuff
        for (let i = 0; i < 7; i++) p.dot(9 + i * 2, 18 + Math.round(Math.sin(i / 2) * 2), r[2], 0.35);
      }
      p.rect(0, T - 1, T, 1, r[2], 0.55);
      p.rect(T - 1, 0, 1, T, r[2], 0.55);
      p.rect(0, 0, T - 1, 1, r[0], 0.35);
      p.rect(0, 0, 1, T - 1, r[0], 0.35);
      break;
    case 'concrete':
      // Power room: sealed concrete slabs with saw-cut joints and fine aggregate.
      p.rect(0, 0, T, T, r[1]);
      speckle(p, rand, 46, [r[2]], 0.45);
      speckle(p, rand, 26, [r[0]], 0.5);
      speckle(p, rand, 5, [r[3]], 0.35);
      if (variant === 1) {
        // a darker patch where the slab cured unevenly
        p.ellipse(5, 9, 18, 12, r[2], 0.1);
        p.ellipse(9, 11, 9, 6, r[2], 0.08);
      }
      p.rect(0, T - 1, T, 1, r[3], 0.6);
      p.rect(T - 1, 0, 1, T, r[3], 0.6);
      p.rect(0, 0, T - 1, 1, r[0], 0.4);
      p.rect(0, 0, 1, T - 1, r[0], 0.4);
      break;
    case 'carpet':
      // NOC: carpet tiles laid quarter-turned, so the pile ribs run across (0) or down (1) and the pile catches
      // the light a touch differently on alternate tiles.
      p.rect(0, 0, T, T, r[1]);
      if (variant === 1) p.rect(0, 0, T, T, r[0], 0.08);
      for (let a = 1; a < T - 1; a += 2) {
        for (let b = 1; b < T - 1; b++) {
          const k = (b + (a % 4 === 1 ? 0 : 2)) % 4;
          const c = k === 0 ? r[2] : k === 2 ? r[0] : -1;
          if (c < 0) continue;
          if (variant === 0) p.dot(b, a, c, k === 0 ? 0.6 : 0.22);
          else p.dot(a, b, c, k === 0 ? 0.6 : 0.22);
        }
      }
      p.rect(0, T - 1, T, 1, r[3], 0.5);
      p.rect(T - 1, 0, 1, T, r[3], 0.5);
      break;
  }
}

/** Top of a wall seen from above: dark, with faint grain. */
function wallGrain(p: Painter, w: number, h: number, seed: number): void {
  p.rect(0, 0, w, h, WALL[2]);
  const rand = rng(seed);
  const n = (w * h) / T;
  speckle(p, rand, Math.round(n * 0.6), [WALL[1]], 0.7, 0, 0, w, h);
  speckle(p, rand, Math.round(n * 0.35), [WALL[3]], 0.6, 0, 0, w, h);
}

function drawWallTop(p: Painter): void {
  wallGrain(p, T, T, 31);
}

function drawWallFace(p: Painter, variant: number): void {
  // cap: the wall's top, then its lit front lip
  wallGrain(p, T, 9, 57);
  p.rect(0, 9, T, 1, WALL[0]);
  // painted panel, in the lip's shadow at the top
  p.rect(0, 10, T, 16, WALL_PANEL[1]);
  p.rect(0, 10, T, 1, WALL_PANEL[3]);
  p.rect(0, 11, T, 1, WALL_PANEL[2]);
  p.rect(0, 12, 1, 14, WALL_PANEL[0]);
  p.rect(T - 1, 11, 1, 15, WALL_PANEL[2]);
  if (variant === 1) {
    // KHU red stripe at hand height
    p.rect(0, 18, T, 1, KHU_RED[0]);
    p.rect(0, 19, T, 2, KHU_RED[1]);
    p.rect(0, 21, T, 1, KHU_RED[2]);
  } else {
    // horizontal groove
    p.rect(0, 18, T, 1, WALL_PANEL[2]);
    p.rect(0, 19, T, 1, WALL_PANEL[0]);
  }
  // baseboard, deepest where it meets the floor
  p.rect(0, 26, T, 6, WALL[1]);
  p.rect(0, 26, T, 1, WALL[0]);
  p.rect(0, 30, T, 1, WALL[2]);
  p.rect(0, 31, T, 1, WALL[3]);
}

function drawDoor(p: Painter): void {
  const W = 2 * T;
  // header: wall top, then the sliding-door operator housing with a green lamp
  wallGrain(p, W, 2, 57);
  p.rect(0, 2, W, 1, STEEL[0]);
  p.rect(0, 3, W, 5, STEEL[1]);
  p.rect(0, 8, W, 1, STEEL[2]);
  p.rect(0, 9, W, 1, STEEL[3]);
  p.rect(2, 5, W - 4, 1, STEEL[2], 0.6);
  p.rect(28, 3, 8, 5, IRON[1]);
  p.rect(29, 4, 6, 3, LAMP[1]);
  p.rect(29, 4, 3, 1, LAMP[0]);
  p.dot(34, 6, LAMP[2]);
  p.rect(52, 4, 3, 2, IRON[2]);
  p.dot(52, 4, IRON[0]);
  // soft shadow the header throws on the floor
  p.rect(4, 10, W - 8, 1, IRON[3], 0.28);
  p.rect(4, 11, W - 8, 1, IRON[3], 0.12);
  // jambs
  for (const x of [0, W - 4]) {
    p.rect(x, 10, 4, 22, STEEL[1]);
    p.rect(x, 10, 1, 22, STEEL[0]);
    p.rect(x + 3, 10, 1, 22, STEEL[2]);
    p.rect(x, 10, 4, 1, STEEL[2]);
    p.rect(x, 31, 4, 1, STEEL[3]);
  }
  // retracted glass leaves, inner stile toward the opening
  for (const [gx, sx] of [
    [4, 9],
    [W - 9, W - 10],
  ]) {
    p.rect(gx, 10, 5, 17, GLASS[1], 0.8);
    p.rect(gx, 10, 5, 2, GLASS[2], 0.85);
    p.rect(gx, 12, 1, 15, GLASS[0], 0.85);
    for (let i = 0; i < 4; i++) p.dot(gx + 1 + i, 20 - i, GLASS[0], 0.9);
    p.dot(gx + 2, 23, GLASS[0], 0.9);
    p.dot(gx + 3, 22, GLASS[0], 0.9);
    p.rect(sx, 10, 1, 17, STEEL[1]);
    p.rect(sx, 10, 1, 1, STEEL[2]);
  }
  // threshold plate with diagonal safety stripes
  p.rect(4, 27, W - 8, 1, STEEL[0]);
  for (let y = 28; y <= 29; y++) {
    for (let x = 4; x < W - 4; x++) p.dot(x, y, (x + y) % 6 < 3 ? CABLE.yellow : IRON[1]);
  }
  p.rect(4, 30, W - 8, 1, STEEL[2]);
  p.rect(4, 31, W - 8, 1, STEEL[3]);
}

export function floorSpecs(): TextureSpec[] {
  const out: TextureSpec[] = [];
  // two variants per room so the tiles checker a little
  let seed = 7;
  for (const [name, { ramp, pattern }] of Object.entries(FLOORS)) {
    for (const v of [0, 1]) {
      const s = seed++ * 977;
      out.push({ key: `floor-${name}-${v}`, w: T, h: T, unit: U, draw: (p) => drawFloor(p, ramp, pattern, v, s) });
    }
  }
  out.push({
    key: 'floor-corridor-stripe',
    w: T,
    h: T,
    unit: U,
    draw: (p) => {
      drawFloor(p, FLOOR.corridor, 'terrazzo', 0, 4242);
      // painted KHU red guide line, a little worn
      p.rect(0, 14, T, 1, KHU_RED[0]);
      p.rect(0, 15, T, 2, KHU_RED[1]);
      p.rect(0, 17, T, 1, KHU_RED[2]);
      for (const [x, y] of [
        [5, 15],
        [6, 16],
        [19, 16],
        [26, 15],
      ])
        p.dot(x, y, KHU_RED[2], 0.7);
    },
  });
  out.push({ key: 'wall-top', w: T, h: T, unit: U, draw: drawWallTop });
  out.push({ key: 'wall-face-0', w: T, h: T, unit: U, draw: (p) => drawWallFace(p, 0) });
  out.push({ key: 'wall-face-1', w: T, h: T, unit: U, draw: (p) => drawWallFace(p, 1) });
  out.push({ key: 'door', w: 2 * T, h: T, unit: U, draw: drawDoor });
  return out;
}
