// Dialogue portraits: 32 x 32 text grids, one char per art pixel, '.' transparent.
// Same style as the lion sprite (art/lion_sprite): no dark outline; every shape is shaded with darker
// tones of its own colour, lit from the top-left. Busts share one framing: the head in the upper rows,
// the shoulders running off a flat bottom edge. No Phaser import, so tests can read the grids.
import type { Mood, Speaker } from '../../content/types';
import { Painter, canvasTarget } from './painter';

/** Width and height of every portrait, in art px. */
export const PORTRAIT_SIZE = 32;

/** The lion sprite's colours (art/lion_sprite/source/lion_sprite.py `PAL`) plus `u`, the worried sweat drop. */
export const LION_PALETTE: Record<string, number> = {
  // mane
  M: 0xcc342b,
  m: 0x9c241e,
  d: 0x781a16,
  H: 0xe8563e,
  // fur, inner ear
  F: 0xecc88d,
  f: 0xd0a46c,
  k: 0x4a2618,
  // face
  W: 0xfaf6f0,
  K: 0x2e1c18,
  w: 0xffffff,
  N: 0x341810,
  O: 0x601e16,
  T: 0xe25c32,
  P: 0xeea8ac,
  q: 0x805434,
  // shirt and tie
  S: 0xf8f5f0,
  s: 0xd2cecc,
  R: 0xd6342e,
  r: 0xa02220,
  // sweat drop (worried only)
  u: 0x9fd8ff,
};

/** 쿠사수 and 팀장님. Cloth reuses the lion's navy, red and white so the cast reads as one set. */
export const PEOPLE_PALETTE: Record<string, number> = {
  // dark brown hair (light, base, shade)
  H: 0x7d5b4a,
  h: 0x563c30,
  j: 0x3b2820,
  // grey hair
  a: 0xdcdfe4,
  A: 0xa9aeb8,
  Z: 0x777d89,
  // skin (light, shade, deep shade under the chin)
  s: 0xf2c9a0,
  S: 0xd9a67c,
  t: 0xb8845e,
  e: 0x2a1410,
  m: 0xb5655a,
  W: 0xffffff,
  // glasses
  g: 0x2c2a35,
  w: 0xcfe8ff,
  // headset (light, mid, dark) and its LED
  i: 0x9a9aa6,
  K: 0x6a6a74,
  k: 0x3a3a42,
  y: 0xffd166,
  // navy cloth: highlight, the lion's pants B / b
  L: 0x3d55a0,
  n: 0x243270,
  N: 0x18204e,
  // KHU red: the lion's mane M / m
  r: 0xcc342b,
  R: 0x9c241e,
  // white shirt: the lion's shirt S / s
  c: 0xf8f5f0,
  o: 0xd2cecc,
};

/** The 안내 tip bulb, in the amber of `.dlg-tip`. */
export const TIP_PALETTE: Record<string, number> = {
  // glass: specular, glow, light, amber, edge shade
  f: 0xfffbe8,
  Y: 0xfff4c4,
  y: 0xffe27a,
  A: 0xffc94a,
  o: 0xf0962e,
  // filament
  O: 0xc4661c,
  // rays (--amber)
  r: 0xffb547,
  // screw base
  g: 0xe6e8ee,
  G: 0xb4b9c6,
  h: 0x8d93a3,
  H: 0x5d6270,
};

/** 쿠사수: dark hair, glasses, headset with a mic and LED, navy hoodie with the KHU red stripe. */
export const MENTOR: string[] = [
  '................................',
  '...........HHHhhhhhhj...........',
  '.........HHHhhhhhhhhhhj.........',
  '........HhiiiiiiKKKKkkhj........',
  '.......HhihhhhhhhhhhhhKhj.......',
  '.......HiHHHhhhhhhhhhhhKj.......',
  '.......iHhhhHHhhhhhhhhhhK.......',
  '.......KhhhhhhjhhhhjhhhjK.......',
  '.......KhhhhhjhhhhjhhjshK.......',
  '.......KhhhhjhhhhhjSssshK.......',
  '.......KhhhhhhjSSsssssshK.......',
  '.....KKKhhhjSSssssssssShKKK.....',
  '....KiKkhgggggssssggggghKKkk....',
  '....KKKkhgWewggggggWewghKKkk....',
  '....KKkkhgwewgssssgwewghKKkk....',
  '....KykksgggggssssgggggSKkkk....',
  '.....kk.ssssssssSsssssSS.kk.....',
  '......K..ssssssSSsssssS.........',
  '.......K.ssssmssssmsssS.........',
  '........KkksssmmmmsssS..........',
  '...........sssssssssS...........',
  '.............SSSSSS.............',
  '........LLLLnttttttnnnnN........',
  '.....LLnnnnnnSSSSSSnnnnnnnN.....',
  '...LnnnnnnnnnNSSSSNnnnnnnnnNN...',
  '..LnnnnnnnnnncnSSncnnnnnnnnnNN..',
  '..nnnnnNnnnnncnNNncnnnnnNnnnNN..',
  '..rrrrrrrrrrrrrrrrrrrrrrrrrrrR..',
  '..RRRRRRRRRRRRRRRRRRRRRRRRRRRR..',
  '..nnnnnNnnnnnnnNNnnnnnnnNnnnNN..',
  '..nnnnnNnnnnnnnNNnnnnnnnNnnnNN..',
  '..nnnnnNnnnnnnnNNnnnnnnnNnnnNN..',
];

/** 팀장님: grey side-parted hair and moustache, white shirt, red tie, navy jacket. */
export const BOSS: string[] = [
  '................................',
  '...........aaaaAAAAAZ...........',
  '.........aaaAAAAAAAAAAZ.........',
  '........aAAAZaaaaAAAAAAZ........',
  '........aAAAZAAaaaAAAAAZ........',
  '........aAAAZAAAAAAAAAAZ........',
  '........aAAAZAAAAAAAAAAZ........',
  '........aAZZZZZZZZZZZZAZ........',
  '........aASSssssssssSSAZ........',
  '........aAssssssssssssAZ........',
  '........aAssssssssssssAZ........',
  '........AsZZZZssssZZZZSZ........',
  '.......sssssssssssssssSSs.......',
  '.......sSssWessssssWesSSS.......',
  '.......sSsSeesssssseeSSSS.......',
  '........sssSSsssSssSSsSS........',
  '.........sssssssSsssssS.........',
  '.........sssSssSSssSssS.........',
  '.........sssSaAAAAZSssS.........',
  '..........ssssmmmmsssS..........',
  '...........sssssssssS...........',
  '.............SSSSSS.............',
  '......LLLLnncttttttcnnnnnN......',
  '...LLnnnnnnncccrRcconnnnnnnNN...',
  '..LnnnnnnnnnLccrRcoNnnnnnnnnNN..',
  '..LnnnnnnnnnLocrRcoNnnnnnnnnNN..',
  '..nnnnnNnnnnnLcrRoNnnnnnNnnnNN..',
  '..nnnnnNnnnnnLcrRoNnnnnnNnnnNN..',
  '..nnnnnNnnnnnLcrRoNnnnnnNnnnNN..',
  '..nnnnnNnnnnnLcrRoNnnnnnNnnnNN..',
  '..nnnnnNnnnnnLcrRoNnnnnnNnnnNN..',
  '..nnnnnNnnnnnLcrRoNnnnnnNnnnNN..',
];

/** The player lion, from the sprite's front face: open smile and blush. */
export const LION_HAPPY: string[] = [
  '................................',
  '............HHHHHHHm............',
  '......FF..HHMMMMMMMMHm..FF......',
  '.....FkkFHMMmMMMMMMmMMHFkkF.....',
  '.....FkkMMMmMMMMMMMMmMMMkkf.....',
  '.....FMMMMMMMMMMMMMMMMMMMMf.....',
  '.....HMMMMMMMMMMMMMMMMMMMMm.....',
  '.....HMMMMMMMmmMMmmMMMMMMMm.....',
  '....HMMMMMmmmFFmmFFmmmMMMMMm....',
  '...mMMMmMmFqqFFFFFFqqFmMmMMMm...',
  '....mMmMMFFFFFFFFFFFFFFMMmMm....',
  '.....MMMMFFwKFFFFFFwKFfMMMm.....',
  '....MMMMMFFKKFFFFFFKKFfMMMMm....',
  '...mMMMmMFFKKFFFFFFKKFfMmMMMm...',
  '....mMmMMFFFFWNNNNWFFFfMMmMm....',
  '.....MMMMFFFWWWNNWWWFFfMMMm.....',
  '....MMMMMFPPWWOOOOWWPPfMMMMm....',
  '...mMMMmMFFFFWOTTOWFFFfMmMMMm...',
  '....mMmMMFFFFFWWWWFFFFfMMmMm....',
  '.....mMMMdFFFFFFFFFFFfdMMMm.....',
  '......mMMMdffffffffffdMMMm......',
  '...SSSSmmMMddddddddddMMmmSSSs...',
  '..SSSSSSSmmmmmmmmmmmmmmSSSSSSs..',
  '..SSSSSSssSSSSsRRsSSSSssSSSSSS..',
  '..SSSSSSsSSsSSSRrSSSsSSsSSSSSs..',
  '..SSSSSsSSSSsSSRRSSsSSSSsSSSSs..',
  '..SSSSSsSSSSSSSRRSSSSSSSsSSSSs..',
  '..SSSSSsSSSSSSRRRrSSSSSSsSSSSs..',
  '..SSSSSsSSSSSSRRRrSSSSSSsSSSSs..',
  '..SSSSSsSSSSSSRRRrSSSSSSsSSSSs..',
  '..SSSSSsSSSSSSRRRrSSSSSSsSSSSs..',
  '..SSSSSsSSSSSSRRRrSSSSSSsSSSSs..',
];

/** The player lion, worried: brows up in the middle, a small frown, one sweat drop. */
export const LION_WORRIED: string[] = [
  '................................',
  '............HHHHHHHm............',
  '......FF..HHMMMMMMMMHm..FF......',
  '.....FkkFHMMmMMMMMMmMMHFkkF.....',
  '.....FkkMMMmMMMMMMMMmMMMkkf.....',
  '.....FMMMMMMMMMMMMMMMMMMMMf.....',
  '.....HMMMMMMMMMMMMMMMMMMMum.....',
  '.....HMMMMMMMmmMMmmMMMMMuum.....',
  '....HMMMMMmmmFFmmFFmmmMuuuum....',
  '...mMMMmMmFFqFFFFFFqFFmwuuuMm...',
  '....mMmMMFqqFFFFFFFFqqFMuuMm....',
  '.....MMMMFFwKFFFFFFwKFfMMMm.....',
  '....MMMMMFFKKFFFFFFKKFfMMMMm....',
  '...mMMMmMFFKKFFFFFFKKFfMmMMMm...',
  '....mMmMMFFFFWNNNNWFFFfMMmMm....',
  '.....MMMMFFFWWWNNWWWFFfMMMm.....',
  '....MMMMMFFFWWWWWWWWFFfMMMMm....',
  '...mMMMmMFFFFWWOOWWFFFfMmMMMm...',
  '....mMmMMFFFFFOWWOFFFFfMMmMm....',
  '.....mMMMdFFFFFFFFFFFfdMMMm.....',
  '......mMMMdffffffffffdMMMm......',
  '...SSSSmmMMddddddddddMMmmSSSs...',
  '..SSSSSSSmmmmmmmmmmmmmmSSSSSSs..',
  '..SSSSSSssSSSSsRRsSSSSssSSSSSS..',
  '..SSSSSSsSSsSSSRrSSSsSSsSSSSSs..',
  '..SSSSSsSSSSsSSRRSSsSSSSsSSSSs..',
  '..SSSSSsSSSSSSSRRSSSSSSSsSSSSs..',
  '..SSSSSsSSSSSSRRRrSSSSSSsSSSSs..',
  '..SSSSSsSSSSSSRRRrSSSSSSsSSSSs..',
  '..SSSSSsSSSSSSRRRrSSSSSSsSSSSs..',
  '..SSSSSsSSSSSSRRRrSSSSSSsSSSSs..',
  '..SSSSSsSSSSSSRRRrSSSSSSsSSSSs..',
];

/** 안내 tips: a lit bulb with short rays. */
export const SYSTEM_TIP: string[] = [
  '................................',
  '................................',
  '...............rr...............',
  '................................',
  '.....r....................r.....',
  '......r.....yyyyyyyA.....r......',
  '..........yyffYYYYyyyA..........',
  '.........yffYYYYYYYyyyA.........',
  '........yfYYYYYYYYYyyyAo........',
  '.......yfYYYYYYYYYyyyyAAo.......',
  '.......yfYYYYYYYYyyyyyAAo.......',
  '.......yyYYYYYYYyyyyyAAAo.......',
  '..rrr..yyYYYYOYOOyOyyAAAo..rrr..',
  '.......yyYYYYyOyyOyyyAAAo.......',
  '.......yyyyyyyoyyoyAAAAAo.......',
  '........yyyyyyoAAoAAAAoo........',
  '........yyyyAAoAAoAAAAoo........',
  '.........yyAAAoAAoAAAoo.........',
  '..........yAAAoAAoAAoo..........',
  '.....r.....AAAoAAoAoo.....r.....',
  '....r.......AAoAAoAo.......r....',
  '............AAoAAoAo............',
  '...........gggGGGGGhh...........',
  '............HHHHHHHH............',
  '...........ggGGGGGGhh...........',
  '............HHHHHHHH............',
  '...........ggGGGGGGhh...........',
  '............HHHHHHHH............',
  '.............hhhhhh.............',
  '...............HH...............',
  '................................',
  '................................',
];

export type PortraitKey = 'mentor' | 'boss' | 'lion-happy' | 'lion-worried' | 'system-tip';

export const PORTRAITS: Record<PortraitKey, { rows: string[]; palette: Record<string, number> }> = {
  mentor: { rows: MENTOR, palette: PEOPLE_PALETTE },
  boss: { rows: BOSS, palette: PEOPLE_PALETTE },
  'lion-happy': { rows: LION_HAPPY, palette: LION_PALETTE },
  'lion-worried': { rows: LION_WORRIED, palette: LION_PALETTE },
  'system-tip': { rows: SYSTEM_TIP, palette: TIP_PALETTE },
};

/** Which portrait a dialogue line shows. Only the lion changes with mood; 'neutral' keeps his smile. */
export function portraitKey(who: Speaker, mood: Mood = 'neutral'): PortraitKey {
  switch (who) {
    case 'lion':
      return mood === 'worried' ? 'lion-worried' : 'lion-happy';
    case 'mentor':
      return 'mentor';
    case 'boss':
      return 'boss';
    case 'system':
      return 'system-tip';
  }
}

const dataUrls = new Map<PortraitKey, string>();

/** The portrait as a 32 x 32 PNG data URL (1 px per art px), drawn once per key. Browser only: it needs a canvas. */
export function portraitDataUrl(key: PortraitKey): string {
  const cached = dataUrls.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = PORTRAIT_SIZE;
  canvas.height = PORTRAIT_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const { rows, palette } = PORTRAITS[key];
  new Painter(canvasTarget(ctx), 1).art(rows, palette);
  const url = canvas.toDataURL('image/png');
  dataUrls.set(key, url);
  return url;
}
