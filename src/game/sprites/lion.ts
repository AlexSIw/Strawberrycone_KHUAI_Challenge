// The player: the KHU lion pixel sheet (public/assets/sprites/lion.png, from art/lion_sprite/lion_spritesheet.json)
// and the dust its running feet kick up.
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

// Dust under the running feet (art/lion_sprite/effects/dust.json): a 16 x 16 puff, 6 frames played once.
const DUST_FRAME = 16;
const DUST_DURATIONS = [100, 100, 150, 150, 150, 150];
/** The puff's pixel that sits on the foot */
const DUST_ANCHOR = { x: 8, y: 15 };
/** At most this many puffs at once (a puff lasts 0.8 s; at 2x speed one spawns every ~0.1 s, so about 8 are up) */
const DUST_POOL = 12;
type DustEffect = 'dust_puff' | 'dust_side_left' | 'dust_side_right';
/** Effect and foot points (art px in the lion frame) for run columns 0 and 3, where a foot lands. */
const DUST: Record<Facing, { effect: DustEffect; feet: [{ x: number; y: number }, { x: number; y: number }] }> = {
  right: { effect: 'dust_side_right', feet: [{ x: 14, y: 31 }, { x: 14, y: 31 }] },
  left: { effect: 'dust_side_left', feet: [{ x: 17, y: 31 }, { x: 17, y: 31 }] },
  down: { effect: 'dust_puff', feet: [{ x: 13, y: 31 }, { x: 18, y: 31 }] },
  up: { effect: 'dust_puff', feet: [{ x: 13, y: 31 }, { x: 18, y: 31 }] },
};

/**
 * The puff for a run frame of a lion whose feet are at (x, y) (world px), or null on a frame where no foot lands:
 * its texture (also its animation key) and top-left, placed so the puff's anchor pixel sits on the landing foot,
 * on the even-px art grid.
 */
export function dustSpawn(dir: Facing, col: number, x: number, y: number): { key: DustEffect; x: number; y: number } | null {
  if (col !== 0 && col !== 3) return null;
  const { effect, feet } = DUST[dir];
  const foot = feet[col === 0 ? 0 : 1];
  const snap = (v: number) => Math.round(v / PX) * PX;
  return {
    key: effect,
    x: snap(x - (LION_FRAME / 2) * PX + (foot.x - DUST_ANCHOR.x) * PX),
    y: snap(y - LION_FRAME * PX + (foot.y - DUST_ANCHOR.y) * PX),
  };
}

const SHEETS = {
  lion: { url: 'assets/sprites/lion.png', frame: LION_FRAME },
  dust_puff: { url: 'assets/sprites/dust_puff.png', frame: DUST_FRAME },
  dust_side_left: { url: 'assets/sprites/dust_side_left.png', frame: DUST_FRAME },
  dust_side_right: { url: 'assets/sprites/dust_side_right.png', frame: DUST_FRAME },
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

/**
 * Call after loading: every lion animation, lion-{idle,run,interact}-{facing}, and one per dust effect, keyed like
 * its texture (animations are global to the game).
 */
export function setupLion(scene: Phaser.Scene): void {
  const anims = scene.anims;
  for (const key of new Set(Object.values(DUST).map((d) => d.effect))) {
    if (anims.exists(key) || !scene.textures.exists(key)) continue;
    anims.create({ key, frames: DUST_DURATIONS.map((duration, frame) => ({ key, frame, duration })), repeat: 0 });
  }
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

/**
 * Kick up dust where the running lion's feet land. The puffs stay where they were spawned (world space), at
 * `depth`: over the floor, under everything that stands on it. None when the player prefers reduced motion.
 */
export function attachLionDust(scene: Phaser.Scene, player: Phaser.GameObjects.Sprite, depth: number): void {
  const reduced = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const pool = scene.add.group({ maxSize: DUST_POOL });
  // A loop back to column 0 fires both UPDATE and REPEAT for the same frame: one puff per frame shown.
  let last: Phaser.Animations.AnimationFrame | null = null;
  const onFrame = (started: boolean) => (anim: Phaser.Animations.Animation, frame: Phaser.Animations.AnimationFrame) => {
    if (!started && frame === last) return;
    last = frame;
    if (reduced?.matches || !anim.key.startsWith('lion-run-')) return;
    const dir = anim.key.slice('lion-run-'.length) as Facing;
    const spawn = dustSpawn(dir, Number(frame.textureFrame) % COLUMNS, player.x, player.y);
    if (!spawn || !scene.anims.exists(spawn.key)) return;
    // null when all the puffs are still up
    const puff = pool.get(spawn.x, spawn.y, spawn.key) as Phaser.GameObjects.Sprite | null;
    if (!puff) return;
    puff.setActive(true).setVisible(true).setOrigin(0).setScale(PX).setDepth(depth).setPosition(spawn.x, spawn.y);
    puff.once('animationcomplete', () => pool.killAndHide(puff));
    puff.play(spawn.key);
  };
  player.on('animationstart', onFrame(true));
  player.on('animationupdate', onFrame(false));
  player.on('animationrepeat', onFrame(false));
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
