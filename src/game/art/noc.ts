// Ops-room furniture: the NOC monitor wall, the admin desk, chairs and the design whiteboard.
// Drawn in art px of U screen px each (32 per tile, like the lion); layout constants are screen px relative to
// the texture's top-left. No outlines: each part is shaded with its own ramp, lit from the top-left, and only
// the rows that meet the floor use a ramp's deepest tone.
import { PX } from '../pixelArt';
import type { Painter, TextureSpec } from './painter';
import { CABLE, ENAMEL, IRON, KHU_RED, LED, LION, SCREEN, STEEL, WOOD } from './palette';

/** Screen px per art px: one tile is 32 x 32 art px. */
const U = PX;

type Ramp = readonly number[];

/** Monitor wall: 3 x 2 screens, each a 30 x 20 bezel with 28 x 18 glass, over a console counter. */
const WALL = { cols: 3, rows: 2, x: 3, y: 2, w: 30, h: 20 };
const glassOf = (col: number, row: number) => ({ x: WALL.x + col * WALL.w + 1, y: WALL.y + row * WALL.h + 1, w: WALL.w - 2, h: WALL.h - 2 });

export const MONITOR_TEX = { w: 96 * U, h: 64 * U };
/** Screens on the NOC monitor wall (tinted red/amber during incidents): exactly the glass, on whole art px. */
export const MONITOR_SCREENS = [0, 1, 2].flatMap((col) =>
  [0, 1].map((row) => {
    const g = glassOf(col, row);
    return { x: g.x * U, y: g.y * U, w: g.w * U, h: g.h * U };
  }),
);

export const DESK_TEX = { w: 64 * U, h: 48 * U };
export const BOARD_TEX = { w: 64 * U, h: 64 * U };

/** Screen-content colours: grid and link lines, dim and bright text. */
const UI = { grid: 0x24324a, line: 0x3e5a7a, dim: 0x5d6f94, text: 0x9aa8c8, fill: 0x1d4a3c, blueDark: 0x3987e5 };

/** A block lit from the top-left: highlight on the top row and left column, shade on the bottom row and right column. */
function bevel(p: Painter, x: number, y: number, w: number, h: number, r: Ramp, hi = 0, base = 1, lo = 2): void {
  p.rect(x, y, w, h, r[base]);
  p.rect(x, y, w, 1, r[hi]);
  p.rect(x, y + 1, 1, h - 1, r[hi]);
  p.rect(x + 1, y + h - 1, w - 1, 1, r[lo]);
  p.rect(x + w - 1, y + 1, 1, h - 2, r[lo]);
}

// ---------------------------------------------------------------- monitor wall

function screenCpu(p: Painter, x: number, y: number): void {
  p.text('CPU', x + 2, y + 2, UI.text);
  p.rect(x + 22, y + 3, 4, 3, LED.green);
  p.rect(x + 22, y + 3, 4, 1, 0x8fe8a8);
  for (let i = 0; i < 26; i += 2) {
    p.dot(x + 1 + i, y + 9, UI.grid);
    p.dot(x + 1 + i, y + 13, UI.grid);
  }
  p.rect(x + 1, y + 16, 26, 1, UI.line);
  const v = [14, 13, 13, 12, 13, 11, 12, 10, 11, 11, 9, 10, 8, 9, 9, 10, 8, 7, 8, 9, 8, 10, 9, 8, 9, 8];
  v.forEach((vy, i) => p.rect(x + 1 + i, y + vy + 1, 1, 15 - vy, UI.fill));
  v.forEach((vy, i) => {
    const prev = i ? v[i - 1] : vy;
    const top = Math.min(prev, vy);
    p.rect(x + 1 + i, y + top, 1, Math.abs(prev - vy) + 1, LED.green);
  });
}

function screenNet(p: Painter, x: number, y: number): void {
  p.text('NET', x + 2, y + 2, UI.text);
  p.rect(x + 18, y + 3, 3, 1, LED.blue);
  p.rect(x + 22, y + 3, 4, 1, UI.dim);
  p.rect(x + 18, y + 5, 3, 1, CABLE.teal);
  p.rect(x + 22, y + 5, 3, 1, UI.dim);
  [5, 7, 4, 8, 6, 9, 5, 7].forEach((h, i) => {
    const bx = x + 3 + i * 3;
    const color = i % 2 ? CABLE.teal : LED.blue;
    p.rect(bx, y + 16 - h, 2, h, color);
    p.rect(bx + 1, y + 17 - h, 1, h - 1, i % 2 ? 0x2f9f96 : UI.blueDark);
  });
  p.rect(x + 1, y + 16, 26, 1, UI.line);
}

function screenStatus(p: Painter, x: number, y: number): void {
  const rows = [
    { led: LED.green, w: 12, v: 4 },
    { led: LED.green, w: 9, v: 5 },
    { led: LED.amber, w: 14, v: 3 },
    { led: LED.green, w: 10, v: 5 },
  ];
  rows.forEach((r, i) => {
    const ry = y + 2 + i * 4;
    p.rect(x + 2, ry, 2, 2, r.led);
    p.rect(x + 6, ry, r.w, 1, UI.text);
    p.rect(x + 6, ry + 1, r.w - 4, 1, UI.dim);
    p.rect(x + 26 - r.v, ry, r.v, 2, r.led === LED.amber ? LED.amber : 0x2f8a55);
  });
}

function screenTopology(p: Painter, x: number, y: number): void {
  const L = UI.line;
  // core -> three switches -> six servers
  p.rect(x + 14, y + 5, 1, 2, L);
  p.rect(x + 5, y + 6, 19, 1, L);
  for (const sx of [5, 14, 23]) {
    p.rect(x + sx, y + 7, 1, 1, L);
    p.rect(x + sx, y + 11, 1, 1, L);
    p.rect(x + sx - 3, y + 12, 7, 1, L);
    p.rect(x + sx - 3, y + 13, 1, 1, L);
    p.rect(x + sx + 3, y + 13, 1, 1, L);
  }
  p.rect(x + 12, y + 2, 5, 3, LED.blue);
  p.rect(x + 12, y + 2, 5, 1, 0xb5dcff);
  for (const sx of [5, 14, 23]) {
    p.rect(x + sx - 2, y + 8, 5, 3, LED.green);
    p.rect(x + sx - 2, y + 8, 5, 1, 0x8fe8a8);
  }
  [2, 8, 11, 17, 20, 26].forEach((lx, i) => p.rect(x + lx - 1, y + 14, 2, 2, i === 3 ? LED.amber : 0x2f8a55));
}

function screenHeat(p: Painter, x: number, y: number): void {
  p.text('DC', x + 2, y + 2, UI.text);
  p.rect(x + 12, y + 4, 14, 1, UI.dim);
  const heat = [
    [0, 1, 0, 0, 2, 0],
    [1, 0, 0, 1, 3, 1],
    [0, 0, 1, 0, 1, 0],
  ];
  const tone = [0x2f8a55, LED.green, CABLE.teal, LED.amber];
  heat.forEach((row, r) =>
    row.forEach((t, c) => {
      p.rect(x + 3 + c * 4, y + 7 + r * 3, 3, 2, tone[t]);
    }),
  );
}

function screenPower(p: Painter, x: number, y: number): void {
  p.text('UPS', x + 2, y + 2, UI.text);
  // battery icon
  p.rect(x + 19, y + 2, 6, 5, UI.dim);
  p.rect(x + 25, y + 3, 1, 3, UI.dim);
  p.rect(x + 20, y + 3, 4, 3, LED.green);
  // three load meters
  [20, 15, 9].forEach((w, i) => {
    const my = y + 9 + i * 3;
    p.rect(x + 2, my, 24, 2, UI.grid);
    p.rect(x + 2, my, w, 2, i === 2 ? LED.amber : LED.green);
    p.rect(x + 2, my + 1, w, 1, i === 2 ? 0xd9932f : 0x35a862);
  });
}

const SCREENS = [screenCpu, screenTopology, screenNet, screenHeat, screenStatus, screenPower];

function drawMonitorWall(p: Painter): void {
  // backplate holding the six screens
  bevel(p, 1, 0, 94, 44, IRON, 1, 2, 3);
  for (let col = 0; col < WALL.cols; col++) {
    for (let row = 0; row < WALL.rows; row++) {
      bevel(p, WALL.x + col * WALL.w, WALL.y + row * WALL.h, WALL.w, WALL.h, IRON);
      const g = glassOf(col, row);
      p.rect(g.x, g.y, g.w, g.h, SCREEN[1]);
      // glass glare in the top-left corner, darker toward the bottom-right
      p.rect(g.x, g.y, 6, 1, SCREEN[0]);
      p.rect(g.x, g.y + 1, 1, 3, SCREEN[0]);
      p.rect(g.x + 1, g.y + g.h - 1, g.w - 1, 1, SCREEN[2]);
      SCREENS[col * WALL.rows + row](p, g.x, g.y);
    }
  }
  // status LED strip under the screens
  for (let i = 0; i < 3; i++) p.rect(WALL.x + 13 + i * WALL.w, 42, 4, 1, LED.green);

  // console counter: steel top seen from above, dark front
  p.rect(1, 44, 94, 1, STEEL[2]);
  p.rect(0, 45, 96, 6, STEEL[1]);
  p.rect(0, 45, 1, 6, STEEL[0]);
  p.rect(0, 50, 96, 1, STEEL[0]);
  p.rect(95, 45, 1, 5, STEEL[2]);
  // keyboard and mouse at each seat
  for (let col = 0; col < WALL.cols; col++) {
    const kx = WALL.x + col * WALL.w + 6;
    p.rect(kx, 46, 17, 3, IRON[1]);
    p.rect(kx, 46, 17, 1, IRON[0]);
    for (let i = 0; i < 7; i++) p.dot(kx + 2 + i * 2, 47, STEEL[2]);
    p.rect(kx + 5, 48, 7, 1, STEEL[3]);
    p.rect(kx + 19, 47, 2, 2, IRON[1]);
    p.dot(kx + 19, 47, IRON[0]);
  }
  // desk phone at the left end, a paper cup at the right
  p.rect(2, 45, 1, 5, STEEL[1]);
  p.rect(88, 46, 3, 3, ENAMEL[1]);
  p.rect(88, 46, 3, 1, ENAMEL[0]);
  p.dot(90, 47, ENAMEL[2]);
  p.dot(90, 48, ENAMEL[2]);

  // front: shadow under the lip, three doors with vents, the KHU stripe, a kick plate on the floor
  p.rect(0, 51, 96, 11, IRON[1]);
  p.rect(0, 51, 96, 1, IRON[3]);
  p.rect(0, 52, 1, 10, IRON[0]);
  p.rect(95, 52, 1, 10, IRON[2]);
  p.rect(0, 54, 96, 1, KHU_RED[1]);
  p.rect(0, 55, 96, 1, KHU_RED[2]);
  for (const sx of [32, 64]) {
    p.rect(sx - 1, 52, 1, 10, IRON[2]);
    p.rect(sx, 52, 1, 10, IRON[0]);
  }
  for (let d = 0; d < 3; d++) {
    const dx = d * 32 + 8;
    for (let i = 0; i < 2; i++) {
      p.rect(dx, 57 + i * 2, 16, 1, IRON[3]);
      p.rect(dx, 58 + i * 2, 16, 1, IRON[0]);
    }
  }
  p.rect(1, 62, 94, 2, IRON[3]);
  p.rect(1, 62, 94, 1, IRON[2]);
}

// ---------------------------------------------------------------- admin desk

function drawDesk(p: Painter): void {
  // monitor: bezel, glass with a terminal, a sticky note, chin with a power LED, neck and foot
  bevel(p, 18, 1, 30, 21, IRON);
  p.rect(19, 2, 28, 17, SCREEN[1]);
  p.rect(19, 2, 28, 2, SCREEN[0]);
  p.dot(21, 2, LED.red);
  p.dot(23, 2, LED.amber);
  p.dot(25, 2, LED.green);
  const lines = [
    [2, 10, 0],
    [2, 6, 1],
    [4, 14, 0],
    [4, 9, 0],
    [2, 12, 1],
  ];
  lines.forEach(([ind, w, dim], i) => {
    const ly = 5 + i * 2;
    p.dot(20, ly, LED.green);
    p.rect(20 + ind, ly, w, 1, dim ? UI.dim : 0x8fe8a8);
  });
  p.dot(20, 15, LED.green);
  p.rect(22, 15, 2, 2, LED.green);
  p.rect(20 + 1, 18, 26, 1, SCREEN[2]);
  p.rect(41, 20, 2, 1, LED.green);
  p.rect(43, 0, 5, 5, CABLE.yellow);
  p.rect(43, 4, 5, 1, 0xd9a72c);
  p.rect(44, 1, 3, 1, 0xd9a72c);
  p.rect(30, 22, 6, 3, IRON[2]);
  p.rect(30, 22, 1, 3, IRON[1]);

  // desk top seen from above: far edge in shade, wood grain, a lit front lip
  p.rect(1, 23, 62, 1, WOOD[2]);
  p.rect(0, 24, 64, 9, WOOD[1]);
  p.rect(0, 24, 1, 9, WOOD[0]);
  p.rect(63, 24, 1, 9, WOOD[2]);
  for (const [gx, gy, gw] of [
    [4, 25, 9],
    [40, 26, 12],
    [14, 31, 10],
    [52, 30, 8],
  ]) {
    p.rect(gx, gy, gw, 1, WOOD[0]);
  }
  p.rect(0, 33, 64, 1, WOOD[0]);
  // monitor foot
  p.rect(26, 25, 14, 2, IRON[1]);
  p.rect(26, 25, 14, 1, IRON[0]);
  // KHU mug: rim, coffee, white K, handle
  p.rect(5, 22, 7, 9, KHU_RED[1]);
  p.rect(5, 22, 1, 9, KHU_RED[0]);
  p.rect(11, 23, 1, 8, KHU_RED[2]);
  p.rect(5, 22, 7, 1, KHU_RED[0]);
  p.rect(6, 23, 5, 1, WOOD[3]);
  p.text('K', 7, 25, LION.shirt[1]);
  p.rect(12, 24, 2, 1, KHU_RED[2]);
  p.rect(13, 25, 1, 3, KHU_RED[2]);
  p.rect(12, 28, 2, 1, KHU_RED[2]);
  // keyboard
  p.rect(18, 27, 22, 4, ENAMEL[2]);
  p.rect(18, 27, 22, 1, ENAMEL[0]);
  for (let r = 0; r < 2; r++) for (let i = 0; i < 10; i++) p.dot(19 + i * 2 + r, 28 + r, ENAMEL[0]);
  p.rect(23, 30, 11, 1, ENAMEL[1]);
  p.rect(18, 31, 22, 1, ENAMEL[3]);
  // mouse on a navy pad
  p.rect(43, 27, 8, 5, LION.navy[1]);
  p.rect(43, 27, 8, 1, LION.navy[0]);
  p.rect(46, 28, 3, 3, ENAMEL[0]);
  p.rect(48, 29, 1, 2, ENAMEL[2]);
  // notes
  p.rect(54, 24, 7, 6, ENAMEL[0]);
  p.rect(54, 29, 7, 1, ENAMEL[2]);
  p.rect(55, 25, 5, 1, UI.dim);
  p.rect(55, 27, 3, 1, UI.dim);

  // front: an apron under the top, a leg on the left, the knee space open to the floor, a drawer pedestal
  p.rect(0, 34, 64, 3, WOOD[2]);
  p.rect(0, 34, 1, 3, WOOD[1]);
  p.rect(5, 37, 33, 3, 0x000000, 0.28);
  p.rect(5, 40, 33, 2, 0x000000, 0.14);
  p.rect(1, 37, 4, 9, WOOD[2]);
  p.rect(1, 37, 1, 9, WOOD[1]);
  p.rect(4, 37, 1, 9, WOOD[3]);
  p.rect(38, 37, 26, 9, WOOD[2]);
  p.rect(38, 37, 1, 9, WOOD[1]);
  for (let d = 0; d < 2; d++) {
    const dy = 37 + d * 4;
    bevel(p, 40, dy, 21, 4, WOOD);
    p.rect(48, dy + 1, 5, 1, WOOD[3]);
  }
  p.rect(63, 34, 1, 12, WOOD[3]);
  p.rect(1, 46, 4, 2, WOOD[3]);
  p.rect(38, 46, 26, 2, WOOD[3]);
}

// ---------------------------------------------------------------- office chair (seen from behind)

function drawChair(p: Painter): void {
  const N = LION.navy;
  // backrest
  p.rect(8, 2, 16, 15, N[1]);
  p.rect(7, 3, 18, 13, N[1]);
  p.rect(8, 2, 16, 1, N[0]);
  p.rect(7, 3, 1, 13, N[0]);
  p.dot(8, 3, N[0]);
  p.rect(24, 3, 1, 13, N[2]);
  p.rect(8, 16, 16, 1, N[2]);
  p.rect(9, 4, 14, 1, 0x34478a);
  // KHU stripe
  p.rect(8, 8, 16, 2, KHU_RED[1]);
  p.rect(8, 9, 16, 1, KHU_RED[2]);
  p.rect(7, 8, 1, 2, KHU_RED[0]);
  p.rect(24, 8, 1, 2, KHU_RED[2]);
  // armrests
  for (const ax of [4, 25]) {
    p.rect(ax, 11, 3, 2, IRON[1]);
    p.rect(ax, 11, 3, 1, IRON[0]);
    p.rect(ax + 1, 13, 1, 4, IRON[2]);
  }
  // seat edge below the backrest
  p.rect(5, 17, 22, 3, N[2]);
  p.rect(5, 17, 22, 1, N[1]);
  p.rect(6, 20, 20, 1, IRON[2]);
  // gas lift
  p.rect(14, 21, 4, 5, STEEL[1]);
  p.rect(14, 21, 1, 5, STEEL[0]);
  p.rect(17, 21, 1, 5, STEEL[2]);
  // five-star base and casters
  p.rect(10, 26, 12, 2, IRON[1]);
  p.rect(10, 26, 12, 1, IRON[0]);
  p.rect(5, 27, 6, 2, IRON[1]);
  p.rect(5, 27, 6, 1, IRON[0]);
  p.rect(21, 27, 6, 2, IRON[2]);
  p.rect(21, 27, 6, 1, IRON[1]);
  p.rect(15, 28, 2, 2, IRON[2]);
  for (const cx of [4, 26]) p.rect(cx, 29, 2, 2, IRON[3]);
  for (const cx of [9, 21]) p.rect(cx, 28, 2, 2, IRON[3]);
  p.rect(15, 30, 2, 2, IRON[3]);
}

// ---------------------------------------------------------------- whiteboard on a wheeled stand

/** Marker-drawn database cylinder, 11 x 12. */
const CYLINDER = [
  '..#######..',
  '.#.......#.',
  '#.........#',
  '.#.......#.',
  '#.#######.#',
  '#.........#',
  '#.........#',
  '#.........#',
  '#.........#',
  '#.........#',
  '.#.......#.',
  '..#######..',
];

function marker(p: Painter, rows: string[], x: number, y: number, color: number): void {
  p.art(rows, { '#': color }, x, y);
}

function outline(p: Painter, x: number, y: number, w: number, h: number, color: number): void {
  p.rect(x + 1, y, w - 2, 1, color);
  p.rect(x + 1, y + h - 1, w - 2, 1, color);
  p.rect(x, y + 1, 1, h - 2, color);
  p.rect(x + w - 1, y + 1, 1, h - 2, color);
}

/** Marker arrow: a shaft ending in a ">" chevron at x + len - 1. */
function arrowRight(p: Painter, x: number, y: number, len: number, color: number): void {
  p.rect(x, y, len, 1, color);
  for (const d of [1, 2]) {
    p.dot(x + len - 1 - d, y - d, color);
    p.dot(x + len - 1 - d, y + d, color);
  }
}

function drawWhiteboard(p: Painter): void {
  const navy = LION.navy[1];
  const red = KHU_RED[1];
  const green = 0x3f9b4f;
  // aluminium frame and the white board
  bevel(p, 0, 2, 64, 40, STEEL);
  p.rect(1, 3, 62, 38, STEEL[2]);
  p.rect(2, 4, 60, 36, ENAMEL[0]);
  p.rect(2, 4, 60, 1, 0xffffff);
  // faint eraser smudges and a glare streak
  p.rect(44, 33, 12, 1, ENAMEL[1]);
  p.rect(47, 35, 9, 1, ENAMEL[1]);
  for (let i = 0; i < 6; i++) p.dot(52 + i, 10 - i, 0xffffff);

  // the sketch: WEB -> API -> DB
  outline(p, 4, 8, 15, 9, navy);
  p.text('WEB', 6, 10, navy);
  arrowRight(p, 20, 12, 6, red);
  outline(p, 27, 8, 15, 9, navy);
  p.text('API', 29, 10, navy);
  arrowRight(p, 43, 12, 5, red);
  marker(p, CYLINDER, 49, 7, red);
  p.text('DB', 51, 12, red);
  // a check list
  p.text('TODO', 4, 22, red);
  for (let i = 0; i < 3; i++) {
    const ly = 29 + i * 4;
    if (i < 2) {
      p.dot(5, ly, green);
      p.dot(6, ly + 1, green);
      p.dot(7, ly, green);
      p.dot(8, ly - 1, green);
    } else {
      outline(p, 4, ly - 1, 4, 3, navy);
    }
    p.rect(11, ly, [12, 9, 14][i], 1, navy);
  }
  // a rising load curve, circled
  for (const [cx, cy] of [
    [32, 34],
    [33, 33],
    [34, 33],
    [35, 32],
    [36, 31],
    [37, 31],
    [38, 30],
    [39, 28],
    [40, 27],
    [41, 25],
  ]) {
    p.dot(cx, cy, green);
  }
  p.rect(31, 35, 12, 1, navy);
  p.rect(31, 24, 1, 11, navy);
  outline(p, 39, 22, 6, 6, red);

  // marker tray with markers and an eraser
  p.rect(5, 42, 54, 2, STEEL[1]);
  p.rect(5, 42, 54, 1, STEEL[0]);
  p.rect(5, 43, 54, 1, STEEL[2]);
  p.rect(10, 41, 6, 1, red);
  p.dot(15, 41, KHU_RED[2]);
  p.rect(18, 41, 6, 1, navy);
  p.dot(23, 41, LION.navy[2]);
  p.rect(26, 41, 5, 1, green);
  p.rect(44, 40, 8, 2, IRON[1]);
  p.rect(44, 40, 8, 1, ENAMEL[1]);

  // stand: two legs on T-feet with casters
  for (const lx of [9, 52]) {
    p.rect(lx, 44, 3, 13, STEEL[1]);
    p.rect(lx, 44, 1, 13, STEEL[0]);
    p.rect(lx + 2, 44, 1, 13, STEEL[2]);
    p.rect(lx - 7, 57, 17, 2, STEEL[1]);
    p.rect(lx - 7, 57, 17, 1, STEEL[0]);
    p.rect(lx - 6, 59, 15, 1, STEEL[2]);
    for (const cx of [lx - 7, lx + 7]) {
      p.rect(cx, 59, 3, 1, STEEL[2]);
      p.rect(cx, 60, 3, 3, IRON[1]);
      p.dot(cx, 60, IRON[0]);
      p.rect(cx, 63, 3, 1, IRON[3]);
    }
  }
}

export function nocSpecs(): TextureSpec[] {
  return [
    { key: 'monitor-wall', w: 96, h: 64, unit: U, draw: drawMonitorWall },
    { key: 'desk', w: 64, h: 48, unit: U, draw: drawDesk },
    { key: 'chair', w: 32, h: 32, unit: U, draw: drawChair },
    { key: 'whiteboard', w: 64, h: 64, unit: U, draw: drawWhiteboard },
  ];
}
