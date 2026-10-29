// Hand-placed pixel sprites as text grids (1 char = one art pixel of PX screen px; '.' = transparent).
// Kept free of imports so it can be previewed outside Phaser.

/** Screen px per art px: one 64 px tile is 32 x 32 art px, the same density as the lion. */
export const PX = 2;
/** Screen px per art px for art still drawn at the old 16-px-per-tile density (until it is redrawn). */
export const OLD_UNIT = 4;

export const COLORS = {
  outline: 0x2a1410,
  red: 0xd7262b,
  redDark: 0x8d1519,
  redLight: 0xff5a5f,
  navy: 0x22305e,
  navyDark: 0x161f40,
  navyLight: 0x34478a,
  tan: 0xe9b77c,
  tanDark: 0xc48e57,
  tanLight: 0xf6d6a8,
  cream: 0xf4ece4,
  white: 0xffffff,
  black: 0x111014,
  steel: 0x8d93a3,
  steelDark: 0x5d6270,
  steelLight: 0xb4b9c6,
  rack: 0x2f323c,
  rackDark: 0x1b1c22,
  green: 0x4fd17a,
  amber: 0xffb547,
  blue: 0x6ab7ff,
  yellow: 0xf3c63f,
} as const;

/** Mentor 쿠사수: dark hair, glasses, headset, navy hoodie with a KHU red stripe. Two idle frames (breathing + mic bob). */
export const MENTOR_PALETTE: Record<string, number> = {
  o: COLORS.outline,
  h: 0x2b2230,
  H: 0x463a4f,
  s: 0xf2c9a0,
  S: 0xd9a67c,
  g: 0x1a1a1a,
  w: 0xcfe8ff,
  e: 0x2a1410,
  m: 0xb5655a,
  n: COLORS.navy,
  N: COLORS.navyDark,
  L: COLORS.navyLight,
  r: COLORS.red,
  k: 0x2a2a2e,
  K: 0x55555c,
  p: 0x2e2a36,
  b: 0x5a463a,
  c: COLORS.cream,
};

const MENTOR_BASE: string[] = [
  '.....oooooo.....',
  '...ookkkkkkoo...',
  '..ohhHhhhhhhho..',
  '.kohhhhhhhhhhok.',
  '.kohhssssssshhok',
  'kKohsgggsgggsoKk',
  'kKossgwgsgwgssok',
  'kKosssggsggsssok',
  '.kossssssssssok.',
  '..oossssmsssoKk.',
  '...ooSSSSSSoo.k.',
  '..onLccLLccLnok.',
  '.onnnncnncnnnno.',
  '.orrrrrrrrrrrro.',
  '.onnnnnnnnnnnno.',
  '.osnnnnnnnnnnso.',
  '..ooNNNNNNNNoo..',
  '...oppppopppo...',
  '...oppo..oppo...',
  '..obbbo..obbbo..',
];

/** Frame 2: head and shoulders dip one pixel (breathing). */
export const MENTOR_FRAMES: string[][] = [
  MENTOR_BASE,
  ['................', ...MENTOR_BASE.slice(0, 10), ...MENTOR_BASE.slice(11)],
];

export const PLANT_PALETTE: Record<string, number> = {
  o: COLORS.outline,
  g: 0x3f9b4f,
  G: 0x2c7339,
  l: 0x6cc56b,
  p: COLORS.red,
  P: COLORS.redDark,
  q: 0xff7a6e,
  d: 0x4a3326,
};

/** 16 x 24 */
export const PLANT: string[] = [
  '......oo........',
  '.....olgo..oo...',
  '..oo.olgGooglo..',
  '.olgooglGoglGo..',
  '.oGlgoglGgGlo...',
  '..oGlgglgGlgoo..',
  '.ooogGlgglgGlgo.',
  'olglggGlggGlGo..',
  'oGgGlgGglgGgGo..',
  '.oogGgglgglgoGo.',
  '.olgGglgGglGgGlo',
  '.oGgoGgGlgGgoGo.',
  '..oo.oGggGo.oo..',
  '......oGGo......',
  '...oooooooooo...',
  '...oqqqqqqqqo...',
  '...oppppppppo...',
  '....opppppPo....',
  '....oppppPPo....',
  '....opppppPo....',
  '....oppppPPo....',
  '.....opppPo.....',
  '.....oPPPPo.....',
  '......oooo......',
];

export const BOX_PALETTE: Record<string, number> = {
  o: COLORS.outline,
  t: 0xd9a066,
  T: 0xb57c45,
  l: 0xeec08a,
  y: 0xe9d9a6,
  r: COLORS.red,
};

/** 16 x 14 cardboard box with tape */
export const BOX: string[] = [
  '.oooooooooooooo.',
  'olllllllyylllllo',
  'olllllllyylllllo',
  'oTTTTTTTyyTTTTTo',
  'otttttttyyttttto',
  'otttttttyyttttto',
  'ottrrtttyyttttto',
  'ottrrtttttttttto',
  'otttttttttttttto',
  'otttttttttttTTto',
  'otttttttttttTTto',
  'oTTTTTTTTTTTTTTo',
  'oTTTTTTTTTTTTTTo',
  '.oooooooooooooo.',
];

/** 10 x 12 speech bubble with "?" */
export const BUBBLE_QUESTION: string[] = [
  '.oooooooo.',
  'owwwwwwwwo',
  'owwnnnnwwo',
  'ownnwwnnwo',
  'owwwwwnnwo',
  'owwwwnnwwo',
  'owwwnnwwwo',
  'owwwwwwwwo',
  'owwwnnwwwo',
  '.ooowwooo.',
  '...owwo...',
  '....oo....',
];

export const BUBBLE_PALETTE: Record<string, number> = {
  o: COLORS.outline,
  r: COLORS.red,
  w: COLORS.cream,
  n: COLORS.navy,
};

/** 11 x 10 warning triangle */
export const WARN_TRIANGLE: string[] = [
  '.....o.....',
  '....oyo....',
  '....oyo....',
  '...oyoyo...',
  '...oyoyo...',
  '..oyyoyyo..',
  '..oyyyyyo..',
  '.oyyyoyyyo.',
  '.oyyyyyyyo.',
  'ooooooooooo',
];

export const WARN_PALETTE: Record<string, number> = {
  o: COLORS.outline,
  y: COLORS.yellow,
};

/** 7 x 7 arrow pointing right (rotated at runtime) for off-screen incident pointers */
export const ARROW: string[] = [
  '.oo....',
  '.orro..',
  '.orrro.',
  '.orrrro',
  '.orrro.',
  '.orro..',
  '.oo....',
];

export const ARROW_PALETTE: Record<string, number> = { o: COLORS.outline, r: COLORS.red };
