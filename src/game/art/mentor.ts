// The mentor NPC 쿠사수 on the map: a strip of 32 x 32 idle frames, the same chibi build as the lion sprite
// (head in rows 3-19, hoodie 19-25, legs 26-29, shoes 30-31, centred on x 15.5) and the same look as the MENTOR
// portrait: dark brown hair with the fringe swept to his right, big glasses, a headset with the mic on his
// right (viewer's left), navy hoodie with the KHU red stripe. No outline: every shape is shaded with its own ramp.
import { PX } from '../pixelArt';
import type { TextureSpec } from './painter';
import { LION, STEEL } from './palette';
import { PEOPLE_PALETTE } from './portraits';

/** Screen px per art px: one tile is 32 x 32 art px, like the lion. */
const U = PX;

/** The portrait's colours (hair, skin, glasses, headset, hoodie, stripe, strings) plus grey trousers and white sneakers. */
const PALETTE: Record<string, number> = {
  ...PEOPLE_PALETTE,
  // trousers (base, shade)
  p: STEEL[2],
  q: STEEL[3],
  // sneakers: the lion's white shoe top and dark sole
  u: LION.shirt[1],
  v: LION.fur[3],
};

/** Standing, facing the viewer. Feet on row 31, like the lion. */
const BASE: string[] = [
  '................................',
  '................................',
  '................................',
  '...........HHHHhhhhhj...........',
  '.........HiiiiiiKKKKkkj.........',
  '........HiHHHhhhhhhhhhKj........',
  '.......HiHHhhhhhhhhhhhhKj.......',
  '.......hihhhhjhhhjhhSShKj.......',
  '.......ihhhhjhhjSSSSssSjK.......',
  '.......KhhjSSSSSssssssSjK.......',
  '.......iKgggggssssgggggKK.......',
  '......KikgWewggggggWewgkKK......',
  '......KKkgwewgssssgwewgkKk......',
  '......KKkgggggssssgggggkKk......',
  '......yKksssssssSsssssSkkk......',
  '.......kksssssmssmssssSkk.......',
  '........kssssssmmsssssS.........',
  '.........kkkKsssssssSS..........',
  '...........SssssssSSS...........',
  '..........LLnttttttnnN..........',
  '.........LLNnonNNnonNnN.........',
  '.........rrrrrrrrrrrrrR.........',
  '.........RRRRRRRRRRRRRR.........',
  '.........LnNnnnnnnnnNnN.........',
  '.........ssNnnnnnnnnNsS.........',
  '.........SSNNNNNNNNNNSt.........',
  '...........pppppppppq...........',
  '...........ppppqqpppq...........',
  '...........pppq..pppq...........',
  '...........pppq..pppq...........',
  '...........uuuu..uuuu...........',
  '...........vvvv..vvvv...........',
];

/** Rows 3-25 (head, hoodie, hands) sink one pixel onto the trousers: the lion's breathing frame. */
function breathe(rows: string[]): string[] {
  return [...rows.slice(0, 3), '.'.repeat(32), ...rows.slice(3, 26), ...rows.slice(27)];
}

function put(rows: string[], x: number, y: number, s: string): string[] {
  const out = [...rows];
  out[y] = out[y].slice(0, x) + s + out[y].slice(x + s.length);
  return out;
}

const DOWN = breathe(BASE);
/** Mic bob: the boom lags the head by a pixel and the on-air LED blinks off. */
const MIC = put(put(put(DOWN, 9, 17, 'kkK'), 9, 18, '.sss'), 6, 15, 'K');
/** Blink: the eyes close to a line behind the lenses. */
const BLINK = put(put(put(put(BASE, 10, 11, 'Www'), 19, 11, 'Www'), 10, 12, 'eee'), 19, 12, 'eee');

const FRAMES = [BASE, DOWN, MIC, BLINK];

export const MENTOR_FRAME = { w: 32, h: 32, count: FRAMES.length };
/** Idle loop: frame index and how long it shows (ms) */
export const MENTOR_ANIM = [
  { frame: 0, duration: 800 },
  { frame: 1, duration: 350 },
  { frame: 2, duration: 450 },
  { frame: 1, duration: 350 },
  { frame: 0, duration: 900 },
  { frame: 3, duration: 130 },
  { frame: 0, duration: 700 },
];

export function mentorSpecs(): TextureSpec[] {
  return [
    {
      key: 'mentor',
      w: MENTOR_FRAME.w * MENTOR_FRAME.count,
      h: MENTOR_FRAME.h,
      unit: U,
      frames: MENTOR_FRAME.count,
      draw: (p) => FRAMES.forEach((f, i) => p.art(f, PALETTE, i * MENTOR_FRAME.w, 0)),
    },
  ];
}
