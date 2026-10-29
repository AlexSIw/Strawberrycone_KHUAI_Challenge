// Server racks and the server units mounted in them.
// Drawn in art px of U screen px each; layout constants are screen px relative to the texture's top-left.
import { COLORS as C, OLD_UNIT } from '../pixelArt';
import type { Painter, TextureSpec } from './painter';

/** Screen px per art px for this module's art (old 16-px-per-tile art until it is redrawn). */
const U = OLD_UNIT;

export const RACK_TEX = {
  w: 32 * U,
  h: 56 * U,
  /** Height of the 3/4-view top that sticks out above the footprint */
  top: 8 * U,
  slotX: 4 * U,
  slotY0: 14 * U,
  slotH: 8 * U,
  slots: 5,
  unitW: 24 * U,
  unitH: 6 * U,
  /** A mounted unit sits this far below the top of its slot */
  unitDy: 1 * U,
  /** LED inside a server unit */
  ledX: 19 * U,
  ledY: 2 * U,
  ledW: 2 * U,
  ledH: 2 * U,
  /** Host-name label on the unit's label strip */
  labelX: 1.5 * U,
  labelY: 1 * U,
};

function drawRack(p: Painter, n: number): void {
  // body + outline
  p.rect(0, 0, 32, 56, C.outline);
  // 3/4 top surface
  p.rect(1, 1, 30, 7, 0x4b4f5c);
  for (const y of [3, 5]) p.rect(4, y, 24, 1, 0x3a3d48);
  p.rect(1, 7, 30, 1, 0x6a6f7d);
  // front frame
  p.rect(1, 8, 30, 47, C.rack);
  p.rect(1, 8, 1, 47, 0x40434f);
  p.rect(30, 8, 1, 47, 0x22242b);
  // header plate with KHU red tag
  p.rect(3, 9, 26, 5, 0x3c404c);
  p.rect(4, 10, 2, 3, C.red);
  p.text(`RACK${n}`, 8, 9, 0xc9ccd6);
  // rails + empty slots
  for (let i = 0; i < RACK_TEX.slots; i++) {
    const y = 14 + i * 8;
    p.rect(4, y, 24, 8, 0x17181d);
    p.rect(4, y, 24, 1, 0x23252c);
    p.rect(4, y + 7, 24, 1, 0x101115);
  }
  p.rect(2, 14, 2, 40, 0x5d6270);
  p.rect(28, 14, 2, 40, 0x5d6270);
  for (let y = 15; y < 54; y += 4) {
    p.dot(2, y, 0x2a2c33);
    p.dot(29, y, 0x2a2c33);
  }
  // base / feet
  p.rect(1, 54, 30, 1, 0x22242b);
  p.rect(2, 55, 4, 1, C.outline);
  p.rect(26, 55, 4, 1, C.outline);
}

function drawServerUnit(p: Painter): void {
  p.rect(0, 0, 24, 6, C.outline);
  p.rect(1, 1, 22, 4, 0xc9ccd6);
  p.rect(1, 1, 22, 1, 0xe4e6ec);
  p.rect(1, 4, 22, 1, 0x9da1ad);
  // label strip (scene writes the host name here)
  p.rect(1, 1, 15, 4, 0x2b2e38);
  // vents
  p.rect(16, 2, 1, 2, 0x7d818d);
  // LED socket
  p.rect(18, 1, 4, 4, 0x6f7380);
  p.rect(19, 2, 2, 2, 0x202228);
}

export function rackSpecs(): TextureSpec[] {
  return [
    ...[1, 2, 3, 4].map((n) => ({ key: `rack-${n}`, w: 32, h: 56, unit: U, draw: (p: Painter) => drawRack(p, n) })),
    { key: 'server-unit', w: 24, h: 6, unit: U, draw: drawServerUnit },
  ];
}
