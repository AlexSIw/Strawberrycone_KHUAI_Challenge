// The CRAC (항온항습기) unit, its spinning fan and the grille over it.
// Drawn in art px of U screen px each; layout constants are screen px relative to the texture's top-left.
import { PX } from '../pixelArt';
import { type Painter, type TextureSpec, text4x6 } from './painter';
import { ENAMEL, IRON, KHU_RED, LED, LION, STEEL } from './palette';
import { bevel, inset } from './racks';

/** Screen px per art px: 32 art px per tile, like the lion. */
const U = PX;

/** Fan centre in the CRAC art: on a pixel corner, so the fan and the grille turn about the same point. */
const FAN_CX = 48;
const FAN_CY = 64;
/** Fan frame and grille sizes (even, so their centres sit on that corner too). */
const FAN = 44;
const GRILLE = 54;

export const CRAC_TEX = {
  w: 96 * U,
  h: 112 * U,
  top: 16 * U,
  /** Centre of the fan opening */
  fanX: FAN_CX * U,
  fanY: FAN_CY * U,
  /** Origin of the fan sprite: its centre (the frames are even-sized) */
  fanOrigin: 0.5,
  led: { x: 81 * U, y: 23 * U, w: 4 * U, h: 4 * U },
  display: { x: 10 * U, y: 20 * U, w: 24 * U, h: 10 * U },
};

/** Light comes from the top-left: how much a surface whose outward normal is (nx, ny) faces it, -1..1. */
const facing = (nx: number, ny: number) => (-nx - ny) / Math.SQRT2;

/** Pick a ramp step for a lit amount -1..1. */
const lit = (ramp: readonly number[], f: number) => ramp[f > 0.55 ? 0 : f > -0.15 ? 1 : f > -0.65 ? 2 : 3];

function drawCrac(p: Painter): void {
  const E = ENAMEL;
  const S = STEEL;
  const I = IRON;
  // roof: lit enamel top with a long intake grille
  p.rect(0, 0, 96, 16, E[0]);
  p.rect(0, 0, 96, 1, E[2]);
  p.rect(95, 1, 1, 15, E[2]);
  p.rect(0, 14, 96, 1, E[1]);
  inset(p, 6, 3, 84, 9, E[3], S[2]);
  for (let x = 8; x < 88; x += 3) {
    p.rect(x, 4, 2, 7, S[3]);
    p.rect(x, 4, 2, 1, I[1]);
  }
  for (const x of [3, 92]) {
    p.dot(x, 5, S[1]);
    p.dot(x, 10, S[1]);
  }
  // body: enamel cabinet, lit left edge, shaded right edge
  p.rect(0, 16, 96, 90, E[1]);
  p.rect(0, 16, 1, 90, E[0]);
  p.rect(95, 16, 1, 90, E[3]);
  p.rect(94, 16, 1, 90, E[2]);
  p.rect(1, 15, 94, 1, E[0]);
  p.rect(1, 16, 94, 1, E[2]);
  // control panel: display bezel, CRAC label, buttons, status LED
  bevel(p, 5, 18, 86, 13, E, 2);
  inset(p, 8, 18, 27, 13, I[2], I[3], E[1]);
  p.rect(10, 20, 24, 10, LION.navy[3]);
  text4x6(p, 'CRAC', 40, 22, LION.navy[1]);
  for (const x of [64, 69, 74]) {
    p.rect(x, 23, 3, 3, S[1]);
    p.rect(x, 23, 3, 1, S[0]);
    p.rect(x, 25, 3, 1, S[2]);
  }
  inset(p, 80, 22, 6, 6, I[3], I[3], E[0]);
  p.rect(81, 23, 4, 4, LED.off);
  // KHU stripe
  p.rect(1, 32, 94, 1, KHU_RED[0]);
  p.rect(1, 33, 94, 1, KHU_RED[1]);
  p.rect(1, 34, 94, 1, KHU_RED[2]);
  // fan plate: a recessed square with corner screws
  const fx = FAN_CX - 28;
  const fy = FAN_CY - 28;
  inset(p, fx, fy, 56, 56, E[2], E[3], E[0]);
  for (const [x, y] of [
    [fx + 3, fy + 3],
    [fx + 51, fy + 3],
    [fx + 3, fy + 51],
    [fx + 51, fy + 51],
  ]) {
    p.dot(x, y, S[1]);
    p.dot(x + 1, y, S[2]);
    p.dot(x, y + 1, S[2]);
    p.dot(x + 1, y + 1, S[3]);
  }
  // fan opening: a raised steel bezel ring around a dark hole, shaded per pixel by the light
  for (let y = fy; y < fy + 56; y++) {
    for (let x = fx; x < fx + 56; x++) {
      const dx = x + 0.5 - FAN_CX;
      const dy = y + 0.5 - FAN_CY;
      const d = Math.hypot(dx, dy);
      const nx = dx / d;
      const ny = dy / d;
      if (d < 22.5) p.dot(x, y, I[3]);
      else if (d < 23.5) p.dot(x, y, facing(-nx, -ny) > 0.2 ? I[1] : I[2]);
      else if (d < 25.5) p.dot(x, y, lit(S, facing(-nx, -ny)));
      else if (d < 27.5) p.dot(x, y, lit(S, facing(nx, ny)));
    }
  }
  // cold-air decal
  p.art(
    ['....#....', '.#..#..#.', '..#.#.#..', '...###...', '#########', '...###...', '..#.#.#..', '.#..#..#.', '....#....'],
    { '#': LED.blue },
    6,
    41,
  );
  p.dot(10, 45, ENAMEL[0]);
  // service door handle
  p.rect(86, 44, 3, 18, E[3]);
  p.rect(87, 45, 1, 16, S[1]);
  p.rect(86, 44, 3, 1, S[2]);
  // bottom louvres
  for (let y = 93; y < 104; y += 3) {
    p.rect(8, y, 80, 1, E[0]);
    p.rect(8, y + 1, 80, 1, S[2]);
    p.rect(8, y + 2, 80, 1, E[3]);
  }
  // plinth, darkest where it meets the floor
  p.rect(0, 106, 96, 1, S[1]);
  p.rect(0, 107, 96, 4, S[2]);
  for (let x = 10; x < 88; x += 6) p.rect(x, 108, 3, 1, S[3]);
  p.rect(0, 111, 96, 1, S[3]);
}

/** Fan frames: four steps of a quarter turn (the blades repeat every 90 degrees). */
export const FAN_FRAMES = 4;

/** One fan frame at x offset ox: four swept blades and a hub, turned by `angle` (clockwise on screen). */
function drawFan(p: Painter, ox: number, angle: number): void {
  const S = STEEL;
  const c = FAN / 2;
  for (let y = 0; y < FAN; y++) {
    for (let x = 0; x < FAN; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const r = Math.hypot(dx, dy);
      if (r < 4.5) {
        // hub, lit from the top-left
        const f = facing(dx / (r || 1), dy / (r || 1)) * Math.min(1, r / 3);
        p.dot(ox + x, y, r < 1.5 ? S[2] : lit(S, f * 0.9 + 0.1));
        continue;
      }
      if (r >= 21.5) continue;
      const t = (r - 4.5) / 17;
      const tip = r > 19 ? Math.sqrt(Math.max(0, 1 - ((r - 19) / 2.6) ** 2)) : 1;
      const hw = (0.22 + 0.42 * t * (1.3 - t)) * tip;
      const th = Math.atan2(dy, dx);
      for (let k = 0; k < 4; k++) {
        const mid = angle + (k * Math.PI) / 2 - 0.75 * t;
        const delta = Math.atan2(Math.sin(th - mid), Math.cos(th - mid));
        if (Math.abs(delta) >= hw) continue;
        const s = delta / hw;
        // leading edge catches the light, trailing edge in shade, blades facing the light a step lighter
        const toward = facing(Math.cos(mid), Math.sin(mid)) > 0.5;
        const col = s > 0.55 ? S[toward ? 0 : 1] : s < -0.6 ? S[toward ? 2 : 3] : S[toward ? 1 : 2];
        p.dot(ox + x, y, col);
        break;
      }
    }
  }
}

/** Fan guard over the opening: wire rings and four diagonal spokes, lit top-left, each casting a shadow. */
function drawFanGrille(p: Painter): void {
  // chromed wire: brighter than the blades behind it so the two read apart
  const W = [ENAMEL[0], ENAMEL[2], STEEL[1], STEEL[2]];
  const c = GRILLE / 2;
  const wire = new Map<string, number>();
  for (let y = 0; y < GRILLE; y++) {
    for (let x = 0; x < GRILLE; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.hypot(dx, dy);
      const ring = [25.5, 19, 12.5].some((r) => Math.abs(d - r) < 0.5);
      const spoke = (x === y || x + y === GRILLE - 1) && d > 3 && d < 26;
      if (d < 3.5) wire.set(`${x},${y}`, d < 1.5 ? W[2] : lit(W, facing(dx / d, dy / d)));
      else if (ring) wire.set(`${x},${y}`, lit(W, facing(dx / d, dy / d) * 0.9 + 0.1));
      else if (spoke) wire.set(`${x},${y}`, W[1]);
    }
  }
  for (const k of wire.keys()) {
    const [x, y] = k.split(',').map(Number);
    if (x + 1 < GRILLE && y + 1 < GRILLE && !wire.has(`${x + 1},${y + 1}`)) p.dot(x + 1, y + 1, IRON[3], 0.4);
  }
  for (const [k, col] of wire) {
    const [x, y] = k.split(',').map(Number);
    p.dot(x, y, col);
  }
}

export function coolingSpecs(): TextureSpec[] {
  return [
    { key: 'crac', w: 96, h: 112, unit: U, draw: drawCrac },
    {
      key: 'crac-fan',
      w: FAN * FAN_FRAMES,
      h: FAN,
      unit: U,
      frames: FAN_FRAMES,
      draw: (p: Painter) => {
        for (let i = 0; i < FAN_FRAMES; i++) drawFan(p, i * FAN, (i * Math.PI) / 2 / FAN_FRAMES);
      },
    },
    { key: 'crac-grille', w: GRILLE, h: GRILLE, unit: U, draw: drawFanGrille },
  ];
}
