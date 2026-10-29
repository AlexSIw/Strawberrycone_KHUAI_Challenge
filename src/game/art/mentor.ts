// The mentor NPC 쿠사수 on the map: a strip of idle frames.
// Drawn in art px of U screen px each; layout constants are screen px relative to the texture's top-left.
import { MENTOR_FRAMES, MENTOR_PALETTE, OLD_UNIT } from '../pixelArt';
import type { TextureSpec } from './painter';

/** Screen px per art px for this module's art (old 16-px-per-tile art until it is redrawn). */
const U = OLD_UNIT;

export const MENTOR_FRAME = { w: 16, h: 20, count: MENTOR_FRAMES.length };
/** Idle loop: frame index and how long it shows (ms) */
export const MENTOR_ANIM = [
  { frame: 0, duration: 900 },
  { frame: 1, duration: 650 },
];

export function mentorSpecs(): TextureSpec[] {
  return [
    {
      key: 'mentor',
      w: MENTOR_FRAME.w * MENTOR_FRAME.count,
      h: MENTOR_FRAME.h,
      unit: U,
      frames: MENTOR_FRAME.count,
      draw: (p) => MENTOR_FRAMES.forEach((f, i) => p.art(f, MENTOR_PALETTE, i * MENTOR_FRAME.w, 0)),
    },
  ];
}
