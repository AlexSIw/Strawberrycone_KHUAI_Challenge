// The player: the KHU lion pixel sheet (public/assets/sprites/lion.png, from art/lion_sprite/lion_spritesheet.json).
// Phaser is imported for types only, so the pure helpers below can be unit-tested without a browser.
import type Phaser from 'phaser';
import { PX } from '../pixelArt';

/** One frame of the sheet is 32 x 32 art px; the feet stand on the bottom row (31). */
export const LION_FRAME = 32;
/** Screen px per art px, the same as the world: a frame covers exactly one tile. */
export const LION_SCALE = PX;
/** How far above the feet the [E] prompt must stay to clear the lion's head (world px): ~30 art px tall, plus a gap. */
export const LION_HEAD_CLEAR = 30 * PX + 14;
/** Run cycle speed. 6 frames at 14 fps is a 0.43 s stride: the feet slide a little at 280 px/s, but read as running. */
export const RUN_FPS = 14;

export type Facing = 'down' | 'left' | 'right' | 'up';
/** Row order inside each group of the sheet */
export const FACINGS: Facing[] = ['down', 'left', 'right', 'up'];

export type LionState = 'idle' | 'run' | 'interact';
/** The sheet's row groups, top to bottom: 4 rows (one per facing) each. */
const GROUP: Record<LionState, number> = { idle: 0, run: 1, interact: 2 };
const COLUMNS = 6;
/** Frames, speed and looping per state (the sheet's JSON, except the run speed). interact plays once and holds. */
const ANIMS: Record<LionState, { frames: number; fps: number; repeat: number }> = {
  idle: { frames: 4, fps: 4, repeat: -1 },
  run: { frames: 6, fps: RUN_FPS, repeat: -1 },
  interact: { frames: 4, fps: 8, repeat: 0 },
};

/** Frame index in the sheet for a state, facing and column. */
export function lionFrame(state: LionState, dir: Facing, col: number): number {
  return (GROUP[state] * FACINGS.length + FACINGS.indexOf(dir)) * COLUMNS + col;
}

export const lionAnimKey = (state: LionState, dir: Facing) => `lion-${state}-${dir}`;

const SHEETS = {
  lion: { url: 'assets/sprites/lion.png', frame: LION_FRAME },
} as const;

type SheetKey = keyof typeof SHEETS;
type SheetImages = Partial<Record<SheetKey, HTMLImageElement>>;

/** Sheets are fetched once per page and reused by every Phaser.Game (one per stage). */
let sheetImages: Promise<SheetImages> | null = null;

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
export function loadLionSheets(): Promise<SheetImages> {
  if (!sheetImages) {
    const base = import.meta.env.BASE_URL ?? '/';
    const keys = Object.keys(SHEETS) as SheetKey[];
    sheetImages = Promise.all(keys.map((k) => loadImage(`${base}${SHEETS[k].url}`))).then((imgs) => {
      const out: SheetImages = {};
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

/** Register the loaded sheets as spritesheets in this game's texture manager (NEAREST, from the game's pixelArt). */
export function addLionSheets(scene: Phaser.Scene, images: SheetImages): void {
  for (const key of Object.keys(images) as SheetKey[]) {
    const img = images[key];
    const size = SHEETS[key].frame;
    if (img && !scene.textures.exists(key)) scene.textures.addSpriteSheet(key, img, { frameWidth: size, frameHeight: size });
  }
}

/** Call after loading: every lion animation, lion-{idle,run,interact}-{facing} (animations are global to the game). */
export function setupLion(scene: Phaser.Scene): void {
  const anims = scene.anims;
  // a sheet that failed to load leaves the lion on Phaser's "missing" texture instead of crashing
  if (!scene.textures.exists('lion')) return;
  for (const state of Object.keys(ANIMS) as LionState[]) {
    const { frames, fps, repeat } = ANIMS[state];
    for (const dir of FACINGS) {
      const key = lionAnimKey(state, dir);
      if (anims.exists(key)) continue;
      anims.create({
        key,
        frames: Array.from({ length: frames }, (_, col) => ({ key: 'lion', frame: lionFrame(state, dir, col) })),
        frameRate: fps,
        repeat,
      });
    }
  }
}

export interface LionPose {
  moving: boolean;
  facing: Facing;
  fixing: boolean;
}

/** The animation for a pose: interacting wins over running, running over standing. */
export function lionAnim(p: LionPose): string {
  return lionAnimKey(p.fixing ? 'interact' : p.moving ? 'run' : 'idle', p.facing);
}

/** Facing from a movement vector; keeps the current facing on diagonals when it still matches. */
export function facingFor(vx: number, vy: number, current: Facing): Facing {
  if (vx === 0 && vy === 0) return current;
  const h: Facing | null = vx < 0 ? 'left' : vx > 0 ? 'right' : null;
  const v: Facing | null = vy < 0 ? 'up' : vy > 0 ? 'down' : null;
  if (h && v) return current === h || current === v ? current : h;
  return (h ?? v)!;
}

/**
 * Facing from a point toward a rect (a device's footprint): toward the rect's nearest point, sideways when that
 * is more across than up or down. From inside the rect, toward its centre.
 */
export function facingToward(px: number, py: number, rect: { x: number; y: number; w: number; h: number }): Facing {
  let dx = Math.min(Math.max(px, rect.x), rect.x + rect.w) - px;
  let dy = Math.min(Math.max(py, rect.y), rect.y + rect.h) - py;
  if (dx === 0 && dy === 0) {
    dx = rect.x + rect.w / 2 - px;
    dy = rect.y + rect.h / 2 - py;
  }
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}
