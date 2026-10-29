// The player: KHU lion mascot sheets (smooth hand-drawn art, so LINEAR filtering instead of the pixel-art NEAREST).
import Phaser from 'phaser';
import { TILE } from '../map';

export const LION_FRAME = 96;
/** ~1.2 tiles tall on screen */
export const LION_SCALE = (0.62 * TILE) / 48;
/** How far above the feet the [E] prompt must stay to clear the lion's head (world px) */
export const LION_HEAD_CLEAR = (60 * TILE) / 48;
/** Feet baseline inside a 96 px frame (see scripts/prepare-sprites.mjs: 240/256 of a cell) */
export const LION_FEET_Y = 90;

export type Facing = 'down' | 'left' | 'right' | 'up';
/** Sheet rows, top to bottom */
export const FACINGS: Facing[] = ['down', 'left', 'right', 'up'];

const SHEETS = {
  lion_walk: 'assets/sprites/lion_walk.png',
  lion_angry: 'assets/sprites/lion_angry.png',
  lion_idle: 'assets/sprites/lion_idle.png',
  lion_fix: 'assets/sprites/lion_fix.png',
} as const;

type SheetKey = keyof typeof SHEETS;

/** Sheets are fetched once per page and reused by every Phaser.Game (one per stage). */
let sheetImages: Promise<Partial<Record<SheetKey, HTMLImageElement>>> | null = null;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn(`[lion] could not load ${url}`);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * Load the lion sheets outside Phaser's loader: a game destroyed mid-load (fast stage switch)
 * then never receives late loader callbacks, and later stages start instantly from the cache.
 */
export function loadLionSheets(): Promise<Partial<Record<SheetKey, HTMLImageElement>>> {
  if (!sheetImages) {
    const base = import.meta.env.BASE_URL ?? '/';
    const keys = Object.keys(SHEETS) as SheetKey[];
    sheetImages = Promise.all(keys.map((k) => loadImage(`${base}${SHEETS[k]}`))).then((imgs) => {
      const out: Partial<Record<SheetKey, HTMLImageElement>> = {};
      keys.forEach((k, i) => {
        const img = imgs[i];
        if (img) out[k] = img;
      });
      // retry on the next game if something failed (e.g. dev server restarted)
      if (imgs.some((i) => !i)) sheetImages = null;
      return out;
    });
  }
  return sheetImages;
}

/** Register the loaded sheets as 96 x 96 spritesheets in this game's texture manager. */
export function addLionSheets(scene: Phaser.Scene, images: Partial<Record<SheetKey, HTMLImageElement>>): void {
  for (const [key, img] of Object.entries(images)) {
    if (img && !scene.textures.exists(key)) {
      scene.textures.addSpriteSheet(key, img, { frameWidth: LION_FRAME, frameHeight: LION_FRAME });
    }
  }
}

/** Call after loading: smooth filtering + all lion animations (animations are global to the game). */
export function setupLion(scene: Phaser.Scene): void {
  for (const key of Object.keys(SHEETS)) {
    if (scene.textures.exists(key)) scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
  }
  const anims = scene.anims;
  const make = (config: Phaser.Types.Animations.Animation) => {
    if (!config.key || anims.exists(config.key)) return;
    // a sheet that failed to load leaves the lion on Phaser's "missing" texture instead of crashing
    const frames = config.frames;
    if (Array.isArray(frames) && (frames.length === 0 || !scene.textures.exists(frames[0].key ?? ''))) return;
    anims.create(config);
  };
  FACINGS.forEach((dir, row) => {
    make({
      key: `lion-walk-${dir}`,
      frames: anims.generateFrameNumbers('lion_walk', { start: row * 4, end: row * 4 + 3 }),
      frameRate: 8,
      repeat: -1,
    });
    make({
      key: `lion-angry-${dir}`,
      frames: anims.generateFrameNumbers('lion_angry', { start: row * 4, end: row * 4 + 3 }),
      frameRate: 8,
      repeat: -1,
    });
  });
  // Hold the standing pose ~2.5 s, blink for 0.15 s.
  make({
    key: 'lion-idle',
    frames: [
      { key: 'lion_idle', frame: 0, duration: 2500 },
      { key: 'lion_idle', frame: 1, duration: 150 },
    ],
    repeat: -1,
  });
  make({
    key: 'lion-fix',
    frames: anims.generateFrameNumbers('lion_fix', { start: 0, end: 1 }),
    frameRate: 4,
    repeat: -1,
  });
}

export interface LionPose {
  moving: boolean;
  facing: Facing;
  angry: boolean;
  fixing: boolean;
}

/** What to show for a pose: an animation key, or a single standing frame. */
export function lionLook(p: LionPose): { anim: string } | { texture: string; frame: number } {
  if (p.fixing) return { anim: 'lion-fix' };
  if (p.moving) return { anim: `lion-${p.angry ? 'angry' : 'walk'}-${p.facing}` };
  if (p.facing === 'down' && !p.angry) return { anim: 'lion-idle' };
  return { texture: p.angry ? 'lion_angry' : 'lion_walk', frame: FACINGS.indexOf(p.facing) * 4 };
}

/** Facing from a movement vector; keeps the current facing on diagonals when it still matches. */
export function facingFor(vx: number, vy: number, current: Facing): Facing {
  if (vx === 0 && vy === 0) return current;
  const h: Facing | null = vx < 0 ? 'left' : vx > 0 ? 'right' : null;
  const v: Facing | null = vy < 0 ? 'up' : vy > 0 ? 'down' : null;
  if (h && v) return current === h || current === v ? current : h;
  return (h ?? v)!;
}
