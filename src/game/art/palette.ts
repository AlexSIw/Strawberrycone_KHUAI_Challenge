// Shared colour ramps for the 32-px-per-tile world art, so every redrawn texture matches the lion sprite
// (art/lion_sprite/source/lion_sprite.py). Each ramp runs light → dark: [highlight, base, shade, deep].
// Style rule: no black outlines. A shape reads by its own ramp: highlight on the top/left edge, shade on the
// bottom/right edge, `deep` only where it meets the floor.

/** The lion's own colours (mane, fur, shirt, pants) — reuse them for KHU accents so the map and lion agree. */
export const LION = {
  mane: [0xe8563e, 0xcc342b, 0x9c241e, 0x781a16],
  fur: [0xf6dcae, 0xecc88d, 0xd0a46c, 0x4a2618],
  shirt: [0xffffff, 0xf8f5f0, 0xd2cecc, 0xa8a4a2],
  navy: [0x3a4a96, 0x243270, 0x18204e, 0x10163a],
} as const;

/** KHU red for stripes, tags and labels (same as the lion's mane). */
export const KHU_RED = LION.mane;

/** Cool steel for racks, cabinets and frames: shadows lean purple, highlights lean warm. */
export const STEEL = [0xb8bcc8, 0x8d93a3, 0x5d6272, 0x3a3d4c] as const;
/** Dark equipment fronts (rack doors, switch faces, bezels). */
export const IRON = [0x4b4f5e, 0x33363f, 0x23252d, 0x16171d] as const;
/** Light painted metal (PDU, CRAC housing). */
export const ENAMEL = [0xf2f3f6, 0xdfe2e8, 0xc3c7d0, 0x9ea3ad] as const;

/** Floors and walls stay desaturated mid-tones so the red lion is the most saturated large shape on screen. */
export const FLOOR = {
  server: [0x9aa0b0, 0x878d9d, 0x727888, 0x5f6474],
  network: [0x95a2bd, 0x7f8dab, 0x6a7895, 0x58647e],
  cooling: [0x92b7b5, 0x7ea5a5, 0x6a8f8e, 0x587776],
  corridor: [0xb4aebd, 0x9f99aa, 0x8a8496, 0x767082],
  power: [0xaea898, 0x9a9484, 0x857f70, 0x706b5e],
  noc: [0x4b5688, 0x3d4776, 0x323b63, 0x272f51],
} as const;
export const WALL = [0x5e4f66, 0x4a3d52, 0x3b3042, 0x2a2230] as const;
export const WALL_PANEL = [0xc9c2cf, 0xb6aebd, 0xa29aab, 0x8c8496] as const;

/** Status lights keep the map's LED colours (worldView.ts LED_COLOR). */
export const LED = { green: 0x4fd17a, amber: 0xffb547, red: 0xff4a4f, blue: 0x6ab7ff, off: 0x2c2e36 } as const;
/** Screen glass and cable colours. */
export const SCREEN = [0x2a3a5c, 0x16203a, 0x0f1626] as const;
export const CABLE = { blue: 0x6ab7ff, yellow: 0xf3c63f, teal: 0x4fd1c5, red: 0xcc342b, violet: 0x9b7bff, green: 0x4fd17a } as const;
export const PLANT = [0x8ad47e, 0x5fb05a, 0x3f8a45, 0x2c6332] as const;
export const WOOD = [0xe9c08a, 0xc9955c, 0xa5743f, 0x7c5530] as const;
