// Map markers: the mentor's question bubble, the warning triangle, the objective arrow and the ground shadow.
// Drawn in art px of U screen px each; layout constants are screen px relative to the texture's top-left.
import { ARROW, ARROW_PALETTE, BUBBLE_PALETTE, BUBBLE_QUESTION, PX, WARN_PALETTE, WARN_TRIANGLE } from '../pixelArt';
import type { TextureSpec } from './painter';

/** Screen px per art px for this module's art. */
const U = PX;

export function markerSpecs(): TextureSpec[] {
  return [
    { key: 'bubble-question', w: 10, h: 12, unit: U, draw: (p) => p.art(BUBBLE_QUESTION, BUBBLE_PALETTE) },
    { key: 'warn', w: 11, h: 10, unit: U, draw: (p) => p.art(WARN_TRIANGLE, WARN_PALETTE) },
    // blue arrow for the "go here" objective marker
    { key: 'arrow-blue', w: 7, h: 7, unit: U, draw: (p) => p.art(ARROW, { ...ARROW_PALETTE, r: 0x3987e5 }) },
    // soft shadow under characters (screen px)
    { key: 'shadow', w: 36, h: 12, unit: 1, draw: (p) => p.ellipse(1, 1, 34, 10, 0x000000, 0.28) },
  ];
}
