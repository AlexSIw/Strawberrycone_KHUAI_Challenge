// Pixel painter shared by the world textures, the title backdrop and the portraits. No Phaser import, so it runs in tests too.
// Coordinates are in art pixels ("ap"); `unit` is how many screen px one art pixel covers.

/** Anything that can fill a screen-px rectangle (a canvas, or a recorder in tests). */
export interface PixelTarget {
  fill(x: number, y: number, w: number, h: number, color: number, alpha: number): void;
}

export function canvasTarget(ctx: CanvasRenderingContext2D): PixelTarget {
  return {
    fill(x, y, w, h, color, alpha) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
    },
  };
}

const GLYPHS: Record<string, string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '-': ['...', '...', '###', '...', '...'],
  ' ': ['...', '...', '...', '...', '...'],
};

export class Painter {
  constructor(
    readonly target: PixelTarget,
    readonly unit: number,
  ) {}

  rect(x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
    if (w <= 0 || h <= 0) return;
    const u = this.unit;
    this.target.fill(x * u, y * u, w * u, h * u, color, alpha);
  }

  dot(x: number, y: number, color: number, alpha = 1): void {
    this.rect(x, y, 1, 1, color, alpha);
  }

  /** Filled rect with a 1-pixel border. */
  box(x: number, y: number, w: number, h: number, fill: number, outline: number): void {
    this.rect(x, y, w, h, outline);
    this.rect(x + 1, y + 1, w - 2, h - 2, fill);
  }

  /** Pixel circle centred on pixel (cx, cy). */
  circle(cx: number, cy: number, r: number, color: number, alpha = 1): void {
    for (let dy = -r; dy <= r; dy++) {
      const half = Math.floor(Math.sqrt(r * r - dy * dy) + 0.35);
      this.rect(cx - half, cy + dy, half * 2 + 1, 1, color, alpha);
    }
  }

  /** Pixel ellipse filling the box (x, y, w, h), one horizontal run per row. */
  ellipse(x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
    const rx = w / 2;
    const ry = h / 2;
    for (let row = 0; row < h; row++) {
      const dy = (row + 0.5 - ry) / ry;
      const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - dy * dy)));
      this.rect(x + Math.round(rx) - half, y + row, half * 2, 1, color, alpha);
    }
  }

  /** Text grid: one char per art pixel, '.' transparent, other chars looked up in the palette. Runs merge into one rect. */
  art(rows: string[], pal: Record<string, number>, ox = 0, oy = 0): void {
    rows.forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        const ch = row[x];
        const c = ch === '.' ? undefined : pal[ch];
        let end = x + 1;
        while (end < row.length && row[end] === ch) end++;
        if (c !== undefined) this.rect(ox + x, oy + y, end - x, 1, c);
        x = end;
      }
    });
  }

  /** Tiny 3x5 pixel font (capital letters only). */
  text(s: string, x: number, y: number, color: number): void {
    let cx = x;
    for (const ch of s.toUpperCase()) {
      const g = GLYPHS[ch];
      if (g) g.forEach((row, gy) => [...row].forEach((v, gx) => v === '#' && this.dot(cx + gx, y + gy, color)));
      cx += 4;
    }
  }
}

/** Small deterministic random so floors look the same every time. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** One baked texture: size in art px of `unit` screen px each, optional equal-width frames laid out left to right. */
export interface TextureSpec {
  key: string;
  w: number;
  h: number;
  unit: number;
  frames?: number;
  draw: (p: Painter) => void;
}
