// The mentor NPC 쿠사수 on the map: a strip of idle frames.
// Drawn in art px of U screen px each; layout constants are screen px relative to the texture's top-left.
import { MENTOR_FRAMES, MENTOR_PALETTE, PX } from '../pixelArt';
import type { TextureSpec } from './painter';

/** Screen px per art px for this module's art. */
const U = PX;

export const MENTOR_FRAME = { w: 16, h: 20, count: MENTOR_FRAMES.length };

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
