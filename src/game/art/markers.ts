// Map markers: the mentor's question bubble, the warning triangle, the objective arrow and the ground shadow.
// Drawn in art px of U screen px each (32 per tile, like the lion). No outlines: each shape is shaded with
// its own darker tones, lit from the top-left.
import { PX } from '../pixelArt';
import type { Painter, TextureSpec } from './painter';
import { KHU_RED, LED, LION } from './palette';

/** Screen px per art px: one tile is 32 x 32 art px, like the lion. */
const U = PX;

/** Screen px per texture px of the edge arrow at camera zoom 1 (the scene divides by the zoom): 3 screen px per art px. */
export const ARROW_SCREEN_SCALE = 1.5;

/** 20 x 24 speech bubble with a red "?", its tail down-left toward the speaker's head. */
const BUBBLE_QUESTION: string[] = [
  '..wwwwwwwwwwwwwwws..',
  '.wccccccccccccccccs.',
  'wccccccccccccccccccs',
  'wccccccchhhrcccccccs',
  'wcccccchrrrrrccccccs',
  'wccccchrccccrRcccccs',
  'wcccccrRccccrRcccccs',
  'wccccccccccrRccccccs',
  'wcccccccccrRcccccccs',
  'wccccccccrrccccccccs',
  'wccccccccRRccccccccs',
  'wccccccccccccccccccs',
  'wcccccccchrccccccccs',
  'wccccccccRRccccccccs',
  'wccccccccccccccccccs',
  'sccccccccccccccccccs',
  '.sccccccccccccccccs.',
  '..SScccccccSSSSSSS..',
  '....wcccccS.........',
  '...wccccSS..........',
  '...wccSS............',
  '..wcSS..............',
  '..wS................',
  '..S.................',
];

const BUBBLE_PALETTE: Record<string, number> = {
  // paper: highlight, base, shade, deep (the lion's shirt ramp)
  w: LION.shirt[0],
  c: LION.shirt[1],
  s: LION.shirt[2],
  S: LION.shirt[3],
  // the "?" in KHU red: highlight, base, shade
  h: KHU_RED[0],
  r: KHU_RED[1],
  R: KHU_RED[2],
};

/** 22 x 20 warning triangle: amber rim, yellow face lit from the left, a dark "!". */
const WARN_TRIANGLE: string[] = [
  '..........oo..........',
  '.........oYao.........',
  '.........oYao.........',
  '........oYyyao........',
  '........oYyyao........',
  '.......oYyyyyao.......',
  '.......oYyyyyao.......',
  '......oYyykkyyao......',
  '......oYyykkyyao......',
  '.....oYyyykkyyyao.....',
  '.....oYyyykkyyyao.....',
  '....oYyyyykkyyyyao....',
  '....oYyyyykkyyyyao....',
  '...oYyyyyyyyyyyyyao...',
  '...oYyyyyyyyyyyyyao...',
  '..oYyyyyyykkyyyyyyao..',
  '..oYyyyyyykkyyyyyyao..',
  '.oYyyyyyyyyyyyyyyyyao.',
  '.oYaaaaaaaaaaaaaaaaao.',
  'OOOOOOOOOOOOOOOOOOOOOO',
];

const WARN_PALETTE: Record<string, number> = {
  Y: 0xffe27a,
  y: 0xf3c63f,
  a: 0xe0a830,
  o: 0xf0962e,
  O: 0xc4661c,
  k: LION.fur[3],
};

/** 12 x 12 arrow pointing right (the scene turns it in quarter turns). Shaded symmetrically, so it reads the same at any turn. */
const ARROW: string[] = [
  '......d.....',
  '......dd....',
  '......dbd...',
  '......dbbd..',
  'ddddddbbbbd.',
  'dllllllllbbd',
  'dllllllllbbd',
  'ddddddbbbbd.',
  '......dbbd..',
  '......dbd...',
  '......dd....',
  '......d.....',
];

/** 12 x 12 arrow pointing down-right; with ARROW it covers all eight directions in quarter turns. */
const ARROW_DIAG: string[] = [
  '..d.........',
  '.dbd........',
  'dblbd.......',
  '.dblbd.....d',
  '..dblbd...dd',
  '...dblbd.dbd',
  '....dblbdbbd',
  '.....dblbbbd',
  '......dblbbd',
  '.....dbbblbd',
  '....dbbbbbld',
  '...ddddddddd',
];

/** The blue of the "여기" goal tag (#2f6fc0) as the rim, the map's LED blue as the body. */
const ARROW_PALETTE: Record<string, number> = { l: 0xc2e2ff, b: LED.blue, d: 0x2f6fc0 };

/** Stepped ellipse rows [left, right] (inclusive) of the 20 x 6 ground shadow. */
const SHADOW_ROWS: [number, number][] = [
  [4, 15],
  [1, 18],
  [0, 19],
  [0, 19],
  [1, 18],
  [4, 15],
];

function drawShadow(p: Painter): void {
  SHADOW_ROWS.forEach(([l, r], y) => p.rect(l, y, r - l + 1, 1, 0x000000, 0.26));
}

export function markerSpecs(): TextureSpec[] {
  return [
    { key: 'bubble-question', w: 20, h: 24, unit: U, draw: (p) => p.art(BUBBLE_QUESTION, BUBBLE_PALETTE) },
    { key: 'warn', w: 22, h: 20, unit: U, draw: (p) => p.art(WARN_TRIANGLE, WARN_PALETTE) },
    // blue arrow for the "go here" objective marker
    { key: 'arrow-blue', w: 12, h: 12, unit: U, draw: (p) => p.art(ARROW, ARROW_PALETTE) },
    { key: 'arrow-blue-diag', w: 12, h: 12, unit: U, draw: (p) => p.art(ARROW_DIAG, ARROW_PALETTE) },
    // soft shadow under the lion's and the mentor's feet
    { key: 'shadow', w: 20, h: 6, unit: U, draw: drawShadow },
  ];
}
