// Camera zoom for a canvas size. Kept free of Phaser so tests and the title screen can use it.

/**
 * 1, 1.5 or 2: with 2 screen px per art px these give 2, 3 or 4 px per art px, so every art pixel is the
 * same size. Never below 1 (NEAREST sampling would drop pixel rows and the labels would break up).
 */
export function zoomFor(width: number, height: number): number {
  const steps = Math.floor(Math.min(width / 1600, height / 900) * 2) / 2;
  return Math.min(2, Math.max(1, steps));
}
