// Every world texture is painted here with Graphics + generateTexture: no image files.
// Coordinates inside draw functions are in "pixels" of PX (3) screen px; exported layout constants are in screen px.
import Phaser from 'phaser';
import {
  ARROW,
  ARROW_PALETTE,
  BOX,
  BOX_PALETTE,
  BUBBLE_ALERT,
  BUBBLE_PALETTE,
  BUBBLE_QUESTION,
  COLORS as C,
  MENTOR_FRAMES,
  MENTOR_PALETTE,
  PLANT,
  PLANT_PALETTE,
  PX,
  WARN_PALETTE,
  WARN_TRIANGLE,
} from './pixelArt';

// ---------- painter ----------

const GLYPHS: Record<string, string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '-': ['...', '...', '###', '...', '...'],
  ' ': ['...', '...', '...', '...', '...'],
};

class Painter {
  constructor(readonly g: Phaser.GameObjects.Graphics) {}

  rect(x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
    if (w <= 0 || h <= 0) return;
    this.g.fillStyle(color, alpha);
    this.g.fillRect(x * PX, y * PX, w * PX, h * PX);
  }

  dot(x: number, y: number, color: number, alpha = 1): void {
    this.rect(x, y, 1, 1, color, alpha);
  }

  /** Filled rect with a 1-pixel dark outline. */
  box(x: number, y: number, w: number, h: number, fill: number, outline: number = C.outline): void {
    this.rect(x, y, w, h, outline);
    this.rect(x + 1, y + 1, w - 2, h - 2, fill);
  }

  /** Pixel circle centred on pixel (cx, cy). */
  circle(cx: number, cy: number, r: number, color: number): void {
    for (let dy = -r; dy <= r; dy++) {
      const half = Math.floor(Math.sqrt(r * r - dy * dy) + 0.35);
      this.rect(cx - half, cy + dy, half * 2 + 1, 1, color);
    }
  }

  art(rows: string[], pal: Record<string, number>, ox = 0, oy = 0): void {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.') continue;
        const c = pal[ch];
        if (c !== undefined) this.dot(ox + x, oy + y, c);
      }
    });
  }

  /** Tiny 3x5 pixel font (capital letters only). */
  text(s: string, x: number, y: number, color: number): void {
    let cx = x;
    for (const ch of s.toUpperCase()) {
      const g = GLYPHS[ch];
      if (g) g.forEach((row, gy) => [...row].forEach((v, gx) => v === '#' && this.dot(cx + gx, y + gy, color)));
      cx += 4;
    }
  }
}

function bake(scene: Phaser.Scene, key: string, wPx: number, hPx: number, draw: (p: Painter) => void): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(new Painter(g));
  g.generateTexture(key, wPx, hPx);
  g.destroy();
}

/** Slice a baked strip into numbered frames 0..n-1. */
function addFrames(scene: Phaser.Scene, key: string, frameW: number, frameH: number, count: number): void {
  const tex = scene.textures.get(key);
  for (let i = 0; i < count; i++) tex.add(i, 0, i * frameW, 0, frameW, frameH);
}

/** Small deterministic random so floors look the same every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ---------- layout constants used by the scene (screen px, relative to the texture's top-left) ----------

export const RACK_TEX = {
  w: 96,
  h: 168,
  /** Height of the 3/4-view top that sticks out above the footprint */
  top: 24,
  slotX: 12,
  slotY0: 42,
  slotH: 24,
  slots: 5,
  unitW: 72,
  unitH: 18,
  /** LED inside a server unit */
  ledX: 57,
  ledY: 6,
};

export const CABINET_TEX = { w: 96, h: 120, top: 24 };

/** Switch port LED i (0..9): two rows of five. */
export function switchLed(i: number) {
  return { x: (6 + (i % 5) * 4) * PX, y: (12 + Math.floor(i / 5) * 3) * PX, w: 2 * PX, h: PX };
}
export const ROUTER_LEDS = {
  wan: { x: 8 * PX, y: 12 * PX, w: 2 * PX, h: PX },
  lan: { x: 14 * PX, y: 12 * PX, w: 2 * PX, h: PX },
};
export const PATCH_LED = { x: 26 * PX, y: 10 * PX, w: 2 * PX, h: 2 * PX };
export const PDU_LEDS = {
  A: { x: 8 * PX, y: 13 * PX, w: 2 * PX, h: 2 * PX },
  B: { x: 21 * PX, y: 13 * PX, w: 2 * PX, h: 2 * PX },
};
export const UPS_LCD = { x: 7 * PX, y: 12 * PX, w: 18 * PX, h: 5 * PX };
export const UPS_LED = { x: 24 * PX, y: 20 * PX, w: 2 * PX, h: 2 * PX };

export const CRAC_TEX = {
  w: 144,
  h: 168,
  top: 24,
  /** Centre of the fan opening */
  fanX: 24.5 * PX,
  fanY: 33.5 * PX,
  led: { x: 39 * PX, y: 11 * PX, w: 3 * PX, h: 3 * PX },
  display: { x: 5 * PX, y: 10 * PX, w: 12 * PX, h: 5 * PX },
};

export const MONITOR_TEX = { w: 144, h: 96 };
/** Screens on the NOC monitor wall (tinted red/amber during incidents). */
export const MONITOR_SCREENS = [0, 1, 2].flatMap((col) =>
  [0, 1].map((row) => ({ x: (3 + col * 15) * PX, y: (3 + row * 10) * PX, w: 13 * PX, h: 8 * PX })),
);

export const DESK_TEX = { w: 96, h: 72 };
export const BOARD_TEX = { w: 96, h: 96 };

// ---------- floors & walls ----------

interface FloorStyle {
  base: number;
  seam: number;
  hi: number;
  dot: number;
  pattern: 'perforated' | 'grate' | 'speckle' | 'carpet';
}

const FLOORS: Record<string, FloorStyle> = {
  server: { base: 0x8a90a0, seam: 0x6b7080, hi: 0xa2a8b7, dot: 0x727788, pattern: 'perforated' },
  network: { base: 0x7f8dab, seam: 0x63708c, hi: 0x98a5c1, dot: 0x6c7995, pattern: 'perforated' },
  cooling: { base: 0x7ea5a5, seam: 0x628887, hi: 0x97bdbc, dot: 0x6a9190, pattern: 'grate' },
  corridor: { base: 0xcdb89c, seam: 0xb9a385, hi: 0xdcc9ae, dot: 0xbfa98d, pattern: 'speckle' },
  power: { base: 0xa39d8c, seam: 0x8a8474, hi: 0xb5af9e, dot: 0x928c7b, pattern: 'speckle' },
  noc: { base: 0x3d4776, seam: 0x323b63, hi: 0x4a5588, dot: 0x47528a, pattern: 'carpet' },
};

function drawFloor(p: Painter, st: FloorStyle, variant: number, seed: number): void {
  p.rect(0, 0, 16, 16, st.base);
  const rand = rng(seed);
  switch (st.pattern) {
    case 'perforated':
      p.rect(0, 0, 16, 1, st.hi);
      p.rect(0, 0, 1, 16, st.hi);
      p.rect(0, 15, 16, 1, st.seam);
      p.rect(15, 0, 1, 16, st.seam);
      if (variant === 0) {
        for (let y = 3; y <= 12; y += 2) for (let x = 3; x <= 12; x += 2) p.dot(x, y, st.dot);
      } else {
        for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) p.dot(x, y, st.seam);
      }
      break;
    case 'grate':
      p.rect(0, 15, 16, 1, st.seam);
      p.rect(15, 0, 1, 16, st.seam);
      if (variant === 0) for (let y = 2; y < 15; y += 3) p.rect(1, y, 14, 1, st.dot);
      else for (let x = 2; x < 15; x += 3) p.rect(x, 1, 1, 14, st.dot);
      p.rect(0, 0, 16, 1, st.hi);
      break;
    case 'speckle':
      p.rect(0, 15, 16, 1, st.seam, 0.6);
      p.rect(15, 0, 1, 16, st.seam, 0.6);
      for (let i = 0; i < 9; i++) p.dot(Math.floor(rand() * 15), Math.floor(rand() * 15), rand() > 0.5 ? st.dot : st.hi);
      break;
    case 'carpet':
      p.rect(0, 15, 16, 1, st.seam);
      p.rect(15, 0, 1, 16, st.seam);
      for (let y = 1; y < 15; y += 2) {
        for (let x = (y + variant) % 4 === 1 ? 1 : 3; x < 15; x += 4) p.dot(x, y, st.dot);
      }
      break;
  }
}

function drawWallTop(p: Painter): void {
  p.rect(0, 0, 16, 16, 0x3b3040);
  p.rect(0, 0, 16, 1, 0x4d3f55);
  p.rect(0, 15, 16, 1, 0x2a2230);
  for (const [x, y] of [[4, 5], [11, 10]]) p.dot(x, y, 0x463a4f);
}

function drawWallFace(p: Painter, variant: number): void {
  // cap
  p.rect(0, 0, 16, 5, 0x3b3040);
  p.rect(0, 0, 16, 1, 0x4d3f55);
  p.rect(0, 4, 16, 1, 0x6b5a73);
  // painted panel
  p.rect(0, 5, 16, 8, 0xcbbba8);
  p.rect(0, 5, 16, 1, 0xdccdbb);
  p.rect(0, 9, 16, 1, 0xb8a691);
  p.rect(15, 5, 1, 8, 0xb8a691);
  if (variant === 1) {
    // KHU red stripe at hand height
    p.rect(0, 10, 16, 1, C.red);
  }
  // baseboard
  p.rect(0, 13, 16, 3, 0x5a4a42);
  p.rect(0, 13, 16, 1, 0x7a665b);
  p.rect(0, 15, 16, 1, C.outline);
}

function drawDoor(p: Painter): void {
  // header (lintel) and jambs; centre stays transparent so the floor shows through
  p.rect(0, 0, 32, 3, 0x2a2230);
  p.rect(0, 2, 32, 1, 0x6b5a73);
  p.rect(0, 0, 2, 16, 0x2a2230);
  p.rect(30, 0, 2, 16, 0x2a2230);
  // retracted glass panels
  p.rect(2, 3, 2, 12, 0x9ccbe8, 0.85);
  p.rect(28, 3, 2, 12, 0x9ccbe8, 0.85);
  p.rect(2, 3, 1, 12, 0xd8eefa, 0.9);
  // threshold with safety stripes
  p.rect(2, 14, 28, 2, 0x8d93a3);
  for (let x = 2; x < 30; x += 4) p.rect(x, 15, 2, 1, C.yellow);
  // green exit-style lamp
  p.rect(14, 0, 4, 2, C.green);
}

// ---------- equipment ----------

function drawRack(p: Painter, n: number): void {
  // body + outline
  p.rect(0, 0, 32, 56, C.outline);
  // 3/4 top surface
  p.rect(1, 1, 30, 7, 0x4b4f5c);
  for (const y of [3, 5]) p.rect(4, y, 24, 1, 0x3a3d48);
  p.rect(1, 7, 30, 1, 0x6a6f7d);
  // front frame
  p.rect(1, 8, 30, 47, C.rack);
  p.rect(1, 8, 1, 47, 0x40434f);
  p.rect(30, 8, 1, 47, 0x22242b);
  // header plate with KHU red tag
  p.rect(3, 9, 26, 5, 0x3c404c);
  p.rect(4, 10, 2, 3, C.red);
  p.text(`RACK${n}`, 8, 9, 0xc9ccd6);
  // rails + empty slots
  for (let i = 0; i < RACK_TEX.slots; i++) {
    const y = 14 + i * 8;
    p.rect(4, y, 24, 8, 0x17181d);
    p.rect(4, y, 24, 1, 0x23252c);
    p.rect(4, y + 7, 24, 1, 0x101115);
  }
  p.rect(2, 14, 2, 40, 0x5d6270);
  p.rect(28, 14, 2, 40, 0x5d6270);
  for (let y = 15; y < 54; y += 4) {
    p.dot(2, y, 0x2a2c33);
    p.dot(29, y, 0x2a2c33);
  }
  // base / feet
  p.rect(1, 54, 30, 1, 0x22242b);
  p.rect(2, 55, 4, 1, C.outline);
  p.rect(26, 55, 4, 1, C.outline);
}

function drawServerUnit(p: Painter): void {
  p.rect(0, 0, 24, 6, C.outline);
  p.rect(1, 1, 22, 4, 0xc9ccd6);
  p.rect(1, 1, 22, 1, 0xe4e6ec);
  p.rect(1, 4, 22, 1, 0x9da1ad);
  // label strip (scene writes the host name here)
  p.rect(1, 1, 15, 4, 0x2b2e38);
  // vents
  p.rect(16, 2, 1, 2, 0x7d818d);
  // LED socket
  p.rect(18, 1, 4, 4, 0x6f7380);
  p.rect(19, 2, 2, 2, 0x202228);
}

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
  p.box(3, 10, 26, 9, 0x2d3a5a);
  p.rect(4, 11, 24, 1, 0x3f4f78);
  for (let i = 0; i < 10; i++) {
    const x = 6 + (i % 5) * 4;
    const y = 13 + Math.floor(i / 5) * 3;
    p.rect(x, y, 2, 2, 0x0d0e12);
    p.rect(x, y, 2, 1, 0x1f2129);
  }
  p.rect(25, 13, 2, 1, C.green);
  hangingCables(p, [6, 10, 14, 18, 22, 26], 19, 37);
}

function drawRouter(p: Painter): void {
  drawCabinet(p, C.amber);
  p.box(3, 10, 26, 9, 0x3a2f4a);
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
  p.box(3, 26, 26, 5, 0x2b2d36);
  for (let x = 6; x < 26; x += 3) p.dot(x, 28, 0x4a4d58);
}

function drawPatch(p: Painter): void {
  drawCabinet(p, 0x4fd1c5);
  for (const y0 of [11, 18, 25]) {
    p.box(3, y0, 26, 5, 0x3a3d48);
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
  p.box(4, 10, 11, 26, 0xa3a7b1);
  p.box(17, 10, 11, 26, 0xa3a7b1);
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
  for (let i = 0; i < 4; i++) p.box(5 + i * 5, 27, 4, 7, 0x4a4a54);
  for (let i = 0; i < 4; i++) p.rect(6 + i * 5, 30, 2, 3, C.green);
  p.rect(2, 39, 4, 1, C.outline);
  p.rect(26, 39, 4, 1, C.outline);
}

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
  p.box(3, 9, 42, 7, 0xc3c8d0);
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

function drawMonitorWall(p: Painter): void {
  // wall bracket
  p.rect(1, 1, 46, 21, 0x2a2230);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 2; row++) {
      const x = 2 + col * 15;
      const y = 2 + row * 10;
      p.box(x, y, 15, 10, 0x0f1626);
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

// ---------- entry point ----------

/** Paint every world texture. Call once from Boot. */
export function generateWorldTextures(scene: Phaser.Scene): void {
  const T = 48;

  // floors: two variants per room so the tiles checker a little
  let seed = 7;
  for (const [name, style] of Object.entries(FLOORS)) {
    for (const v of [0, 1]) {
      bake(scene, `floor-${name}-${v}`, T, T, (p) => drawFloor(p, style, v, seed++ * 977));
    }
  }
  bake(scene, 'floor-corridor-stripe', T, T, (p) => {
    drawFloor(p, FLOORS.corridor, 0, 4242);
    p.rect(0, 7, 16, 2, C.red);
    p.rect(0, 7, 16, 1, C.redLight);
  });

  bake(scene, 'wall-top', T, T, drawWallTop);
  bake(scene, 'wall-face-0', T, T, (p) => drawWallFace(p, 0));
  bake(scene, 'wall-face-1', T, T, (p) => drawWallFace(p, 1));
  bake(scene, 'door', T * 2, T, drawDoor);

  for (const n of [1, 2, 3, 4]) bake(scene, `rack-${n}`, RACK_TEX.w, RACK_TEX.h, (p) => drawRack(p, n));
  bake(scene, 'server-unit', RACK_TEX.unitW, RACK_TEX.unitH, drawServerUnit);
  bake(scene, 'switch', CABINET_TEX.w, CABINET_TEX.h, drawSwitch);
  bake(scene, 'router', CABINET_TEX.w, CABINET_TEX.h, drawRouter);
  bake(scene, 'patch', CABINET_TEX.w, CABINET_TEX.h, drawPatch);
  bake(scene, 'pdu', CABINET_TEX.w, CABINET_TEX.h, drawPdu);
  bake(scene, 'ups', CABINET_TEX.w, CABINET_TEX.h, drawUps);
  bake(scene, 'crac', CRAC_TEX.w, CRAC_TEX.h, drawCrac);
  bake(scene, 'crac-fan', 22 * PX, 22 * PX, drawFan);
  bake(scene, 'crac-grille', 27 * PX, 27 * PX, drawFanGrille);
  bake(scene, 'monitor-wall', MONITOR_TEX.w, MONITOR_TEX.h, drawMonitorWall);
  bake(scene, 'desk', DESK_TEX.w, DESK_TEX.h, drawDesk);
  bake(scene, 'chair', T, T, drawChair);
  bake(scene, 'whiteboard', BOARD_TEX.w, BOARD_TEX.h, drawWhiteboard);
  bake(scene, 'water', 16 * PX, 24 * PX, drawWater);
  bake(scene, 'tray', T, 8 * PX, drawTray);
  bake(scene, 'banner', 32 * PX, 12 * PX, drawBanner);

  bake(scene, 'plant', 16 * PX, 24 * PX, (p) => p.art(PLANT, PLANT_PALETTE));
  bake(scene, 'box', 16 * PX, 14 * PX, (p) => p.art(BOX, BOX_PALETTE));
  bake(scene, 'bubble-alert', 10 * PX, 12 * PX, (p) => p.art(BUBBLE_ALERT, BUBBLE_PALETTE));
  bake(scene, 'bubble-question', 10 * PX, 12 * PX, (p) => p.art(BUBBLE_QUESTION, BUBBLE_PALETTE));
  bake(scene, 'warn', 11 * PX, 10 * PX, (p) => p.art(WARN_TRIANGLE, WARN_PALETTE));
  bake(scene, 'arrow', 7 * PX, 7 * PX, (p) => p.art(ARROW, ARROW_PALETTE));
  // same arrow in blue, for the "go here" objective marker
  bake(scene, 'arrow-blue', 7 * PX, 7 * PX, (p) => p.art(ARROW, { ...ARROW_PALETTE, r: 0x3987e5 }));

  // mentor NPC: 2-frame strip (16 x 20 pixels each)
  const mw = 16 * PX;
  const mh = 20 * PX;
  bake(scene, 'mentor', mw * MENTOR_FRAMES.length, mh, (p) =>
    MENTOR_FRAMES.forEach((f, i) => p.art(f, MENTOR_PALETTE, i * 16, 0)),
  );
  addFrames(scene, 'mentor', mw, mh, MENTOR_FRAMES.length);

  // soft shadow under characters
  bake(scene, 'shadow', 36, 12, (p) => {
    p.g.fillStyle(0x000000, 0.28);
    p.g.fillEllipse(18, 6, 34, 10);
  });

  // 1x1 white pixel for LEDs, overlays and tinted rects
  bake(scene, 'px', 4, 4, (p) => {
    p.g.fillStyle(0xffffff, 1);
    p.g.fillRect(0, 0, 4, 4);
  });
}
