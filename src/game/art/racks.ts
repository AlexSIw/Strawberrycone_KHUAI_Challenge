// Server racks and the server units mounted in them, plus the rack shell the network cabinets share.
// Drawn in art px of U screen px each; layout constants are screen px relative to the texture's top-left.
import { PX } from '../pixelArt';
import { type Painter, type TextureSpec, text4x6 } from './painter';
import { CABLE, ENAMEL, IRON, KHU_RED, LED, STEEL } from './palette';

/** Screen px per art px: 32 art px per tile, like the lion. */
const U = PX;

/** A colour ramp, light → dark. */
export type Ramp = readonly number[];

export const RACK_TEX = {
  w: 64 * U,
  h: 112 * U,
  /** Height of the 3/4-view top that sticks out above the footprint */
  top: 16 * U,
  slotX: 8 * U,
  slotY0: 28 * U,
  slotH: 16 * U,
  slots: 5,
  unitW: 48 * U,
  unitH: 12 * U,
  /** A mounted unit sits this far below the top of its slot */
  unitDy: 2 * U,
  /** LED inside a server unit */
  ledX: 39 * U,
  ledY: 4 * U,
  ledW: 4 * U,
  ledH: 4 * U,
  /** Host-name label on the unit's label strip */
  labelX: 6 * U,
  labelY: 1 * U,
};

/** Raised panel in ramp[i]: lit top/left edge (ramp[i-1]), shaded bottom/right edge (ramp[i+1]). */
export function bevel(p: Painter, x: number, y: number, w: number, h: number, ramp: Ramp, i = 1): void {
  p.rect(x, y, w, h, ramp[i]);
  p.rect(x, y, w - 1, 1, ramp[i - 1]);
  p.rect(x, y, 1, h - 1, ramp[i - 1]);
  p.rect(x + 1, y + h - 1, w - 1, 1, ramp[i + 1]);
  p.rect(x + w - 1, y + 1, 1, h - 1, ramp[i + 1]);
}

/** Recessed area filled with `fill`: its top/left inner wall in shadow, its bottom lip catching the light. */
export function inset(p: Painter, x: number, y: number, w: number, h: number, fill: number, shadow: number, lit?: number): void {
  p.rect(x, y, w, h, fill);
  p.rect(x, y, w, 1, shadow);
  p.rect(x, y, 1, h, shadow);
  if (lit !== undefined) p.rect(x + 1, y + h - 1, w - 1, 1, lit);
}

/** Same colour, darker (k < 1) or lighter (k > 1); used for the shade side of cables and plugs. */
export function tone(c: number, k: number): number {
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((c >> s) & 0xff) * k)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * A cable seen from the front, along quadratic curves through pts (start, control, end, control, end …):
 * 1 art px of colour with its shade on the bottom/right side, so it reads 2 px thick whichever way it runs.
 */
export function cable(p: Painter, pts: [number, number][], color: number): void {
  const dots = new Map<string, [number, number]>();
  for (let s = 0; s + 2 < pts.length; s += 2) {
    const [a, b, c] = [pts[s], pts[s + 1], pts[s + 2]];
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const u = 1 - t;
      const x = Math.round(u * u * a[0] + 2 * u * t * b[0] + t * t * c[0]);
      const y = Math.round(u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]);
      dots.set(`${x},${y}`, [x, y]);
    }
  }
  const shade = tone(color, 0.62);
  const free = (x: number, y: number) => !dots.has(`${x},${y}`);
  for (const [x, y] of dots.values()) {
    if (free(x + 1, y)) p.dot(x + 1, y, shade);
    if (free(x, y + 1)) p.dot(x, y + 1, shade);
  }
  for (const [x, y] of dots.values()) p.dot(x, y, color);
}

/** Small screw head: a lit dot with its shadow below-right. */
export function screw(p: Painter, x: number, y: number, ramp: Ramp = STEEL): void {
  p.dot(x, y, ramp[1]);
  p.dot(x + 1, y + 1, ramp[3]);
}

/**
 * The 3/4-view roof of a 64-ap-wide rack cabinet (rows 0..15): a lit top plate with two brush grommets,
 * `rising` cables leaving the left one for the overhead tray and two power leads in the right one.
 * A cabinet standing away from the wall (no tray above) gets short cable loops instead.
 */
export function rackRoof(p: Painter, rising: number[], toTray = true): void {
  const I = IRON;
  const S = STEEL;
  p.rect(0, 0, 64, 16, I[0]);
  p.rect(0, 0, 64, 1, S[3]);
  p.rect(0, 0, 1, 15, S[2]);
  p.rect(63, 1, 1, 15, S[3]);
  p.rect(0, 15, 64, 1, S[2]);
  // corner bolts of the top plate
  for (const [x, y] of [
    [3, 3],
    [59, 3],
    [3, 11],
    [59, 11],
  ])
    screw(p, x, y);
  // brush grommets: far inner wall, then the dark slot with bristles along both lips
  for (const gx of [8, 36]) {
    p.rect(gx, 5, 20, 1, I[2]);
    p.rect(gx, 6, 20, 5, I[3]);
    p.rect(gx, 11, 20, 1, S[3]);
    for (let x = gx + 1; x < gx + 20; x += 2) {
      p.dot(x, 6, I[1]);
      p.dot(x, 10, I[1]);
    }
  }
  rising.forEach((c, i) => {
    const x = 11 + i * 5;
    if (toTray) {
      // data cables rising out of the left grommet toward the tray
      p.rect(x, 0, 1, 10, c);
      p.rect(x + 1, 0, 1, 10, tone(c, 0.62));
      p.dot(x, 10, tone(c, 0.62));
    } else {
      // loops of slack poking out of the grommet
      cable(
        p,
        [
          [x - 1, 9],
          [x + 1, 0],
          [x + 3, 9],
        ],
        c,
      );
    }
  });
  // two black power leads in the right grommet
  for (const x of [44, 50]) {
    if (toTray) {
      p.rect(x, 0, 2, 10, I[3]);
      p.rect(x, 0, 1, 10, I[1]);
    } else {
      p.rect(x, 4, 2, 6, I[3]);
      p.rect(x, 4, 1, 6, I[1]);
      p.rect(x, 4, 2, 1, I[0]);
    }
  }
  // perforated strip between the grommets
  for (let y = 6; y < 11; y += 2) for (let x = 30; x < 34; x += 2) p.dot(x, y, I[2]);
}

/**
 * Rack front for a 64-ap-wide texture of height h: frame, header (rows 16..27) with a coloured tag and `label`,
 * posts with U holes down to h-5, plinth in the last 4 rows. The bay between the posts (x 8..55) is left dark.
 */
export function rackFront(p: Painter, h: number, tag: Ramp, label: string): void {
  const I = IRON;
  const S = STEEL;
  const bottom = h - 4;
  // frame
  p.rect(0, 16, 64, bottom - 16, I[1]);
  p.rect(0, 16, 1, bottom - 16, I[0]);
  p.rect(63, 16, 1, bottom - 16, I[2]);
  p.rect(1, 16, 62, 1, I[2]);
  // header: recessed label holder with an asset tag and the name
  inset(p, 8, 18, 48, 8, I[2], I[3]);
  p.rect(10, 19, 4, 6, tag[1]);
  p.rect(10, 19, 4, 1, tag[0]);
  p.rect(10, 24, 4, 1, tag[2]);
  text4x6(p, label, 17, 19, S[0]);
  // door lock
  p.rect(50, 20, 3, 4, S[2]);
  p.rect(50, 20, 3, 1, S[1]);
  p.rect(51, 21, 1, 2, I[3]);
  // bay
  p.rect(8, 28, 48, bottom - 28, I[3]);
  // posts with square U holes (three per 16-ap slot)
  for (const px of [4, 56]) {
    p.rect(px, 27, 4, bottom - 27, S[2]);
    p.rect(px, 27, 1, bottom - 27, S[1]);
    p.rect(px + 3, 27, 1, bottom - 27, S[3]);
    for (let y = 28; y + 2 <= bottom; y += 16) {
      for (const dy of [1, 6, 11]) {
        if (y + dy + 2 > bottom) continue;
        p.rect(px + 1, y + dy, 2, 1, I[3]);
        p.rect(px + 1, y + dy + 1, 2, 1, I[2]);
      }
    }
  }
  // plinth: lit top edge, vent slots, darkest where it meets the floor
  p.rect(0, bottom, 64, 1, I[0]);
  p.rect(0, bottom + 1, 64, 2, I[1]);
  p.rect(63, bottom + 1, 1, 2, I[2]);
  for (let x = 12; x < 52; x += 4) p.rect(x, bottom + 1, 2, 1, I[3]);
  p.rect(0, bottom + 3, 64, 1, I[3]);
}

/** Blanking plate covering an empty 12-ap unit space (the server unit covers it exactly). */
function blankingPlate(p: Painter, y: number): void {
  const I = IRON;
  bevel(p, 8, y, 48, 12, I, 1);
  screw(p, 9, y + 2);
  screw(p, 9, y + 8);
  screw(p, 53, y + 2);
  screw(p, 53, y + 8);
  // a block of vent holes on the right
  for (let row = 0; row < 3; row++) for (let x = 42 + (row % 2); x < 52; x += 2) p.dot(x, y + 4 + row * 2, I[3]);
}

/** Rack n: the rising cable colours differ per rack so the four don't look stamped. */
const RACK_CABLES: number[][] = [
  [CABLE.blue, CABLE.yellow, CABLE.teal],
  [CABLE.yellow, CABLE.violet, CABLE.blue],
  [CABLE.teal, CABLE.blue, CABLE.red],
  [CABLE.violet, CABLE.green, CABLE.yellow],
];

function drawRack(p: Painter, n: number): void {
  rackRoof(p, RACK_CABLES[(n - 1) % RACK_CABLES.length]);
  rackFront(p, 112, KHU_RED, `RACK${n}`);
  for (let i = 0; i < RACK_TEX.slots; i++) {
    const ys = 28 + i * 16;
    // the rear rail seen through the gap between two units
    p.rect(8, ys, 48, 1, IRON[2]);
    blankingPlate(p, ys + 2);
  }
}

function drawServerUnit(p: Painter): void {
  const E = ENAMEL;
  const I = IRON;
  bevel(p, 0, 0, 48, 12, E, 2);
  // mounting ears, bent forward from the chassis
  p.rect(3, 1, 1, 10, E[3]);
  p.rect(44, 1, 1, 10, E[3]);
  screw(p, 1, 2);
  screw(p, 1, 8);
  screw(p, 45, 2);
  screw(p, 45, 8);
  // label strip (the scene writes the host name here)
  inset(p, 4, 1, 31, 10, I[1], I[3], I[0]);
  // vent slit
  p.rect(36, 3, 1, 6, I[2]);
  p.dot(36, 9, E[1]);
  // LED socket
  inset(p, 38, 3, 6, 6, I[2], I[3], E[1]);
  p.rect(39, 4, 4, 4, LED.off);
}

function drawServerGhost(p: Painter): void {
  // dashed amber outline where a not-yet-mounted server goes
  const a = LED.amber;
  for (let x = 0; x < 48; x += 5) {
    p.rect(x, 0, 3, 1, a);
    p.rect(x, 11, 3, 1, a);
  }
  for (const [y, h] of [
    [0, 3],
    [5, 2],
    [9, 3],
  ]) {
    p.rect(0, y, 1, h, a);
    p.rect(47, y, 1, h, a);
  }
}

export function rackSpecs(): TextureSpec[] {
  return [
    ...[1, 2, 3, 4].map((n) => ({ key: `rack-${n}`, w: 64, h: 112, unit: U, draw: (p: Painter) => drawRack(p, n) })),
    { key: 'server-unit', w: 48, h: 12, unit: U, draw: drawServerUnit },
    { key: 'server-ghost', w: 48, h: 12, unit: U, draw: drawServerGhost },
  ];
}
