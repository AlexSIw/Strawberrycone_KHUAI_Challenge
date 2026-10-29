// The dash on Space: a short leap forward that leaves fading afterimages. Kept free of Phaser so tests can read it.
import { TILE } from './map';
import type { Facing } from './sprites/lion';

/** How far one dash goes (tiles) and how long it takes (ms). */
export const DASH_TILES = 2;
export const DASH_MS = 150;
/** No new dash this long after one ends (ms). */
export const DASH_COOLDOWN_MS = 500;
/** World px one dash covers. */
export const DASH_DIST = DASH_TILES * TILE;
/** World px per second while dashing. */
export const DASH_SPEED = DASH_DIST / (DASH_MS / 1000);

/** Afterimages: one every GHOST_EVERY_MS along the path, starting at GHOST_ALPHA and fading out over GHOST_FADE_MS. */
export const GHOST_EVERY_MS = 30;
export const GHOST_FADE_MS = 220;
export const GHOST_ALPHA = 0.5;

const FACING_DIR: Record<Facing, { dx: number; dy: number }> = {
  down: { dx: 0, dy: 1 },
  up: { dx: 0, dy: -1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/** Which way a dash goes: the movement keys held (normalized, so diagonals aren't longer), else the way the lion faces. */
export function dashDir(vx: number, vy: number, facing: Facing): { dx: number; dy: number } {
  if (vx === 0 && vy === 0) return FACING_DIR[facing];
  const len = Math.hypot(vx, vy);
  return { dx: vx / len, dy: vy / len };
}

/** A dash may start once the cooldown of the last one is over. */
export const canDash = (now: number, readyAt: number): boolean => now >= readyAt;
