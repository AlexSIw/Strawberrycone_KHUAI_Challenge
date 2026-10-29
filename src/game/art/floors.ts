// Room floors, walls and doors (one tile each).
// Drawn in art px of U screen px each; layout constants are screen px relative to the texture's top-left.
import { COLORS as C, PX } from '../pixelArt';
import { rng, type Painter, type TextureSpec } from './painter';

/** Screen px per art px for this module's art. */
const U = PX;

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

export function floorSpecs(): TextureSpec[] {
  const out: TextureSpec[] = [];
  // two variants per room so the tiles checker a little
  let seed = 7;
  for (const [name, style] of Object.entries(FLOORS)) {
    for (const v of [0, 1]) {
      const s = seed++ * 977;
      out.push({ key: `floor-${name}-${v}`, w: 16, h: 16, unit: U, draw: (p) => drawFloor(p, style, v, s) });
    }
  }
  out.push({
    key: 'floor-corridor-stripe',
    w: 16,
    h: 16,
    unit: U,
    draw: (p) => {
      drawFloor(p, FLOORS.corridor, 0, 4242);
      p.rect(0, 7, 16, 2, C.red);
      p.rect(0, 7, 16, 1, C.redLight);
    },
  });
  out.push({ key: 'wall-top', w: 16, h: 16, unit: U, draw: drawWallTop });
  out.push({ key: 'wall-face-0', w: 16, h: 16, unit: U, draw: (p) => drawWallFace(p, 0) });
  out.push({ key: 'wall-face-1', w: 16, h: 16, unit: U, draw: (p) => drawWallFace(p, 1) });
  out.push({ key: 'door', w: 32, h: 16, unit: U, draw: drawDoor });
  return out;
}
