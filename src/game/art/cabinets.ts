// Network and power cabinets: TOR switch, border router, patch panel, PDU, UPS.
// Drawn in art px of U screen px each; layout constants are screen px relative to the texture's top-left.
import { PX } from '../pixelArt';
import { type Painter, type TextureSpec, text4x6 } from './painter';
import { CABLE, ENAMEL, IRON, KHU_RED, LED, LION, SCREEN, STEEL, WALL } from './palette';
import { bevel, cable, inset, rackFront, rackRoof, type Ramp, screw, tone } from './racks';

/** Screen px per art px: 32 art px per tile, like the lion. */
const U = PX;

export const CABINET_TEX = { w: 64 * U, h: 80 * U, top: 16 * U };

/** Switch port LED i (0..15): two rows of eight (Gi1/0/1–8 on top; Gi1/0/9–12 and Te1/1/1–4 below). */
export function switchLed(i: number) {
  return { x: (10 + (i % 8) * 5) * U, y: (i < 8 ? 30 : 41) * U, w: 4 * U, h: 2 * U };
}
export const ROUTER_LEDS = {
  wan: { x: 14 * U, y: 31 * U, w: 4 * U, h: 2 * U },
  lan: { x: 31 * U, y: 31 * U, w: 4 * U, h: 2 * U },
};
export const PATCH_LED = { x: 48 * U, y: 20 * U, w: 4 * U, h: 4 * U };
export const PDU_LEDS = {
  A: { x: 22 * U, y: 32 * U, w: 4 * U, h: 4 * U },
  B: { x: 50 * U, y: 32 * U, w: 4 * U, h: 4 * U },
};
export const UPS_LCD = { x: 14 * U, y: 24 * U, w: 36 * U, h: 10 * U };
export const UPS_LED = { x: 46 * U, y: 41 * U, w: 4 * U, h: 4 * U };

const H = 80;
const ramp3 = (c: number): Ramp => [tone(c, 1.2), c, tone(c, 0.68)];

/** RJ45 jack 4x3 at (x, y); the latch notch points up on the top row, down on the bottom row. */
function jack(p: Painter, x: number, y: number, notchUp: boolean, face: number): void {
  p.rect(x, y, 4, 3, IRON[3]);
  p.rect(x + 1, y + 2, 2, 1, IRON[2]);
  if (notchUp) {
    p.dot(x, y, face);
    p.dot(x + 3, y, face);
  } else {
    p.dot(x, y + 2, face);
    p.dot(x + 3, y + 2, face);
  }
}

/** LED window: the scene paints the live colour over it. */
function ledWindow(p: Painter, x: number, y: number, w: number, h: number, rim: number): void {
  p.rect(x - 1, y - 1, w + 2, h + 2, rim);
  p.rect(x, y, w, h, LED.off);
}

/** Plug boot seated in a 3x3 jack, cable colour. */
function plug(p: Painter, x: number, y: number, c: number): void {
  p.rect(x, y, 3, 3, c);
  p.rect(x, y, 3, 1, tone(c, 1.25));
  p.rect(x, y + 2, 3, 1, tone(c, 0.62));
}

function drawSwitch(p: Painter): void {
  rackRoof(p, [CABLE.blue, CABLE.yellow, CABLE.teal]);
  rackFront(p, H, ramp3(CABLE.blue), 'SWITCH');
  const N = LION.navy;
  // the switch: navy chassis, 2 x 8 RJ45 ports with their LEDs above / below, SFP cages and console on the right
  bevel(p, 8, 28, 48, 18, N, 1);
  for (let i = 0; i < 8; i++) {
    const x = 10 + i * 5;
    ledWindow(p, x, 30, 4, 2, N[2]);
    jack(p, x, 33, true, N[1]);
    jack(p, x, 37, false, N[1]);
    ledWindow(p, x, 41, 4, 2, N[2]);
  }
  for (const y of [33, 37]) {
    p.rect(50, y, 4, 3, IRON[3]);
    p.rect(50, y, 4, 1, STEEL[2]);
  }
  p.rect(51, 41, 3, 2, CABLE.teal);
  p.rect(51, 42, 3, 1, tone(CABLE.teal, 0.62));
  // patch cables hang in front of a blanking plate and gather into the floor cut-out on the right
  p.rect(8, 50, 48, 1, IRON[2]);
  bevel(p, 8, 58, 48, 12, IRON, 1);
  for (let row = 0; row < 3; row++) for (let x = 12 + (row % 2); x < 30; x += 2) p.dot(x, 62 + row * 2, IRON[3]);
  const cols = [CABLE.blue, CABLE.yellow, CABLE.teal, CABLE.red, CABLE.violet, CABLE.green];
  [11, 16, 21, 31, 36, 46].forEach((sx, i) => {
    const ex = 40 + i * 2;
    cable(
      p,
      [
        [sx, 46],
        [sx, 52],
        [sx, 58],
        [sx, 72],
        [ex, 74],
      ],
      cols[i],
    );
  });
  // velcro strap round the bundle
  p.rect(48, 70, 2, 5, IRON[0]);
  p.rect(49, 70, 1, 5, IRON[1]);
  // floor cut-out the bundle drops into
  p.rect(38, 75, 18, 1, IRON[3]);
}

function drawRouter(p: Painter): void {
  rackRoof(p, [CABLE.yellow, CABLE.blue, CABLE.red]);
  rackFront(p, H, ramp3(LED.amber), 'ROUTER');
  const W = WALL;
  // border router: WAN / LAN ports with labels, globe badge
  bevel(p, 8, 28, 48, 18, W, 1);
  for (const x of [14, 31]) {
    p.rect(x, 31, 4, 2, LED.off);
    jack(p, x, 34, true, W[1]);
  }
  text4x6(p, 'WAN', 9, 38, ENAMEL[2]);
  text4x6(p, 'LAN', 26, 38, ENAMEL[2]);
  // globe: ocean disc lit from the top-left, meridian and parallels in navy
  const gx = 47;
  const gy = 36;
  p.circle(gx, gy, 6, LION.navy[0]);
  p.circle(gx, gy, 5, CABLE.blue);
  p.circle(gx - 1, gy - 1, 3, tone(CABLE.blue, 1.22));
  for (const dy of [-3, 0, 3]) p.rect(gx - (dy === 0 ? 5 : 4), gy + dy, dy === 0 ? 11 : 9, 1, LION.navy[1]);
  p.rect(gx, gy - 5, 1, 11, LION.navy[1]);
  for (const [dx, dy] of [
    [-2, -4],
    [-3, -2],
    [-3, 2],
    [-2, 4],
    [2, -4],
    [3, -2],
    [3, 2],
    [2, 4],
  ])
    p.dot(gx + dx, gy + dy, LION.navy[1]);
  p.dot(gx - 3, gy - 4, ENAMEL[0]);
  // firewall below, KHU red brick badge, four ports
  bevel(p, 8, 56, 48, 12, IRON, 1);
  const R = KHU_RED;
  const bx = 14;
  p.rect(bx, 58, 11, 8, R[2]);
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? 0 : 3;
    for (let x = bx - off; x < bx + 11; x += 6) {
      const x0 = Math.max(bx, x);
      const x1 = Math.min(bx + 11, x + 5);
      if (x1 > x0) {
        p.rect(x0, 58 + row * 2, x1 - x0, 1, R[1]);
        p.dot(x0, 58 + row * 2, R[0]);
      }
    }
  }
  for (let x = 27; x < 33; x += 2) p.rect(x, 59, 1, 6, IRON[3]);
  for (let i = 0; i < 4; i++) {
    jack(p, 35 + i * 5, 60, true, IRON[1]);
    p.rect(35 + i * 5, 58, 4, 1, LED.off);
  }
  // WAN drops to the floor down the left edge, LAN loops down into the firewall
  cable(
    p,
    [
      [15, 46],
      [15, 51],
      [10, 54],
      [10, 64],
      [10, 75],
    ],
    LED.amber,
  );
  cable(
    p,
    [
      [32, 46],
      [32, 52],
      [32, 56],
      [36, 56],
      [36, 59],
    ],
    CABLE.blue,
  );
  plug(p, 35, 60, CABLE.blue);
  // blanking plate under the firewall
  bevel(p, 8, 70, 48, 5, IRON, 1);
  for (let x = 30; x < 54; x += 2) p.dot(x, 72, IRON[3]);
  p.rect(9, 75, 6, 1, IRON[3]);
}

/** 1U copper patch panel at row y: label ticks over 11 jacks. */
function patchPanel(p: Painter, y: number): void {
  bevel(p, 8, y, 48, 8, STEEL, 2);
  screw(p, 9, y + 1, STEEL);
  screw(p, 53, y + 5, STEEL);
  for (let j = 0; j < 11; j++) {
    const x = 10 + j * 4;
    p.rect(x, y + 2, 3, 1, ENAMEL[2]);
    p.rect(x, y + 3, 3, 3, IRON[3]);
    p.rect(x, y + 5, 3, 1, IRON[2]);
  }
}

const jx = (j: number) => 10 + j * 4;

/** Patch cord from jack j1 in the panel at row ya to jack j2 in the panel at row yb, slack hanging `sag` below. */
function cord(p: Painter, j1: number, ya: number, j2: number, yb: number, sag: number, c: number): void {
  const x1 = jx(j1) + 1;
  const x2 = jx(j2) + 1;
  const low = Math.max(ya, yb) + 6 + sag * 2;
  cable(
    p,
    [
      [x1, ya + 6],
      [(x1 + x2) / 2, low],
      [x2, yb + 6],
    ],
    c,
  );
  plug(p, jx(j1), ya + 3, c);
  plug(p, jx(j2), yb + 3, c);
}

function drawPatch(p: Painter): void {
  rackRoof(p, [CABLE.teal, CABLE.violet, CABLE.yellow], false);
  rackFront(p, H, ramp3(CABLE.teal), 'PATCH');
  inset(p, 47, 19, 6, 6, IRON[3], IRON[3], IRON[1]);
  p.rect(48, 20, 4, 4, LED.off);
  const P = [29, 40, 51];
  for (const y of P) patchPanel(p, y);
  // looping cords between the panels
  cord(p, 1, P[0], 3, P[1], 2, CABLE.blue);
  cord(p, 3, P[0], 7, P[1], 3, CABLE.yellow);
  cord(p, 6, P[0], 1, P[1], 3, CABLE.red);
  cord(p, 9, P[0], 9, P[1], 1, CABLE.teal);
  cord(p, 5, P[1], 2, P[2], 2, CABLE.violet);
  cord(p, 10, P[1], 6, P[2], 3, CABLE.green);
  // fiber panel: duplex LC ports with aqua cords looping down to the floor
  bevel(p, 8, 62, 48, 7, IRON, 1);
  for (let k = 0; k < 6; k++) {
    const x = 11 + k * 7;
    p.rect(x, 64, 4, 2, IRON[3]);
    p.dot(x + 1, 64, k < 3 ? CABLE.yellow : CABLE.teal);
    p.dot(x + 2, 64, k < 3 ? CABLE.yellow : CABLE.teal);
  }
  for (const [x, c] of [
    [12, CABLE.yellow],
    [19, CABLE.yellow],
    [33, CABLE.teal],
  ] as const) {
    cable(
      p,
      [
        [x + 1, 66],
        [x + 1, 74],
        [x + 8, 74],
      ],
      c,
    );
  }
  p.rect(20, 75, 26, 1, IRON[3]);
}

/** Breaker column at x: coloured header with its letter and LED window, six breakers below. */
function breakerColumn(p: Painter, x: number, ramp: Ramp, letter: string): void {
  const E = ENAMEL;
  inset(p, x, 29, 26, 45, E[2], E[3], E[0]);
  bevel(p, x + 1, 30, 24, 8, ramp, 1);
  text4x6(p, letter, x + 4, 31, E[0]);
  p.rect(x + 16, 31, 6, 6, ramp[2]);
  p.rect(x + 17, 32, 4, 4, LED.off);
  for (let k = 0; k < 6; k++) {
    const y = 41 + k * 5;
    bevel(p, x + 3, y, 20, 4, IRON, 1);
    // toggle up = on
    p.rect(x + 5, y + 1, 3, 2, E[0]);
    p.rect(x + 5, y + 2, 3, 1, E[2]);
    p.rect(x + 10, y + 1, 11, 1, IRON[2]);
    p.rect(x + 10, y + 2, 6, 1, E[3]);
  }
}

function drawPdu(p: Painter): void {
  const E = ENAMEL;
  const S = STEEL;
  // enamel roof with a vent grille and two cable glands, their black feeds bending away behind
  p.rect(0, 0, 64, 16, E[0]);
  p.rect(0, 0, 64, 1, E[2]);
  p.rect(63, 1, 1, 15, E[2]);
  p.rect(0, 15, 64, 1, E[0]);
  p.rect(0, 14, 64, 1, E[1]);
  inset(p, 18, 4, 28, 8, E[2], E[3]);
  for (let x = 20; x < 44; x += 3) p.rect(x, 5, 2, 6, E[3]);
  for (const x of [7, 52]) {
    p.rect(x - 1, 8, 7, 3, S[2]);
    p.rect(x - 1, 8, 7, 1, S[1]);
    p.rect(x, 2, 5, 7, IRON[1]);
    p.rect(x, 2, 1, 7, IRON[0]);
    p.rect(x + 4, 2, 1, 7, IRON[2]);
    p.rect(x, 1, 5, 1, IRON[2]);
  }
  // body
  p.rect(0, 16, 64, 60, E[1]);
  p.rect(0, 16, 1, 60, E[0]);
  p.rect(63, 16, 1, 60, E[3]);
  p.rect(1, 16, 62, 1, E[2]);
  // name plate and the lightning sticker
  inset(p, 6, 18, 22, 9, IRON[1], IRON[3]);
  text4x6(p, 'PDU', 10, 20, E[0]);
  const Y = CABLE.yellow;
  const tri = [
    '.....#.....',
    '....###....',
    '....###....',
    '...#####...',
    '...#####...',
    '..#######..',
    '..#######..',
    '.#########.',
    '.#########.',
    '###########',
  ];
  p.art(tri, { '#': Y }, 44, 17);
  p.rect(44, 26, 11, 1, tone(Y, 0.72));
  p.art(['......#', '.....#.', '....###', '.....#.', '....#..'], { '#': IRON[3] }, 44, 20);
  // A (KHU red) and B (navy) feeds
  breakerColumn(p, 5, KHU_RED, 'A');
  breakerColumn(p, 33, LION.navy, 'B');
  // plinth
  p.rect(0, 76, 64, 1, S[1]);
  p.rect(0, 77, 64, 2, S[2]);
  p.rect(0, 79, 64, 1, S[3]);
}

function drawUps(p: Painter): void {
  const I = IRON;
  const E = ENAMEL;
  // roof: lit top with a vent grille and a carry recess
  p.rect(0, 0, 64, 16, I[0]);
  p.rect(0, 0, 64, 1, STEEL[3]);
  p.rect(0, 0, 1, 15, STEEL[2]);
  p.rect(63, 1, 1, 15, STEEL[3]);
  p.rect(0, 15, 64, 1, STEEL[2]);
  for (let y = 4; y < 12; y += 2) p.rect(8, y, 48, 1, I[2]);
  p.rect(26, 3, 12, 1, I[3]);
  // body
  p.rect(0, 16, 64, 60, I[1]);
  p.rect(0, 16, 1, 60, I[0]);
  p.rect(63, 16, 1, 60, I[2]);
  p.rect(1, 16, 62, 1, I[2]);
  // LCD bezel (the scene paints the live screen colour inside)
  inset(p, 11, 21, 42, 16, I[2], I[3], I[0]);
  p.rect(13, 23, 38, 12, I[3]);
  p.rect(14, 24, 36, 10, SCREEN[1]);
  // name, buttons, status LED window
  text4x6(p, 'UPS', 13, 40, E[1]);
  for (const x of [32, 38]) {
    p.rect(x, 41, 4, 4, I[0]);
    p.rect(x, 41, 4, 1, STEEL[2]);
    p.rect(x, 44, 4, 1, I[2]);
  }
  inset(p, 45, 40, 6, 6, I[3], I[3], I[0]);
  p.rect(46, 41, 4, 4, LED.off);
  // KHU stripe
  p.rect(1, 50, 62, 1, KHU_RED[0]);
  p.rect(1, 51, 62, 1, KHU_RED[1]);
  p.rect(1, 52, 62, 1, KHU_RED[2]);
  // battery bars: four cells with their charge level
  for (let i = 0; i < 4; i++) {
    const x = 13 + i * 10;
    p.rect(x + 2, 55, 4, 1, STEEL[2]);
    inset(p, x, 56, 8, 12, I[3], I[3], I[0]);
    p.rect(x + 1, 59, 6, 8, tone(LED.green, 0.8));
    p.rect(x + 1, 59, 6, 1, LED.green);
    p.rect(x + 6, 60, 1, 7, tone(LED.green, 0.6));
  }
  // intake slots
  for (let y = 70; y < 75; y += 2) p.rect(8, y, 48, 1, I[3]);
  // plinth
  p.rect(0, 76, 64, 1, I[0]);
  p.rect(0, 77, 64, 2, I[2]);
  p.rect(0, 79, 64, 1, I[3]);
}

/** Emergency lamp in a blacked-out power room: stepped rings instead of a smooth gradient. */
function drawLampGlow(p: Painter): void {
  for (const d of [88, 68, 48, 28]) p.ellipse(46 - d / 2, 46 - d / 2, d, d, 0xff2a2a, 0.08);
}

export function cabinetSpecs(): TextureSpec[] {
  return [
    { key: 'switch', w: 64, h: H, unit: U, draw: drawSwitch },
    { key: 'router', w: 64, h: H, unit: U, draw: drawRouter },
    { key: 'patch', w: 64, h: H, unit: U, draw: drawPatch },
    { key: 'pdu', w: 64, h: H, unit: U, draw: drawPdu },
    { key: 'ups', w: 64, h: H, unit: U, draw: drawUps },
    { key: 'lamp-glow', w: 92, h: 92, unit: U, draw: drawLampGlow },
  ];
}
