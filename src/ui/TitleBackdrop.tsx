// The title screen's data-center backdrop, painted from the map's own pixel textures at the zoom the game
// would use on this screen, so the title and the map share one pixel size. LEDs blink on a second canvas.
import { useEffect, useRef } from 'react';
import { textureSpecs } from '../game/art';
import { canvasTarget, Painter } from '../game/art/painter';
import { RACK_TEX } from '../game/art/racks';
import { TILE } from '../game/map';
import { PX } from '../game/pixelArt';
import { zoomFor } from '../game/view';
import { ledLook, type LedState } from '../game/worldView';

const SPECS = new Map(textureSpecs().map((s) => [s.key, s]));

/** Width the menu's own column needs in the middle (logo, pitch line, buttons): racks stay outside it. */
const CENTER_W = 720;

/** How many racks fit on each side of the menu column at zoom z (at most two). */
function racksPerSide(width: number, z: number): number {
  const T = TILE * z;
  const side = (width - CENTER_W) / 2 - Math.max(T / 2, width * 0.03);
  return Math.max(0, Math.min(2, Math.floor((side + T / 4) / (RACK_TEX.w * z + T / 4))));
}

/**
 * The backdrop is drawn half a zoom step bigger than the map would be on this screen (3 screen px per art px at
 * 1080p) so the racks fill the empty sides of the menu; half steps keep every art pixel a whole number of screen
 * px. Where not even one rack would fit at that size, it keeps the map's size.
 */
export function backdropZoom(width: number, height: number): number {
  const base = zoomFor(width, height);
  return racksPerSide(width, base + 0.5) > 0 ? base + 0.5 : base;
}
const BLINK_MS = 400;
const BG = '#120f17';

/** Paint one texture with its top-left at (x, y), each art pixel `zoom` times its map size. */
function paint(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, zoom: number): void {
  const spec = SPECS.get(key);
  if (!spec) return;
  ctx.save();
  ctx.translate(x, y);
  spec.draw(new Painter(canvasTarget(ctx), spec.unit * zoom));
  ctx.restore();
}

interface Led {
  x: number;
  y: number;
  w: number;
  h: number;
  state: LedState;
  phase: number;
}


/** Draws the static scene and returns where its LEDs are. */
function drawScene(ctx: CanvasRenderingContext2D, width: number, height: number, z: number): Led[] {
  const T = TILE * z;
  const snap = (v: number) => Math.round(v / (PX * z)) * PX * z;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  // floor strip along the bottom, the back wall's painted face above it
  const floorTop = snap(height - T);
  for (let x = 0, i = 0; x < width; x += T, i++) {
    paint(ctx, `floor-server-${i % 2}`, x, floorTop, z);
    paint(ctx, 'wall-face-1', x, floorTop - T, z);
  }

  // racks standing on the floor at both sides, half full of servers
  const leds: Led[] = [];
  const n = racksPerSide(width, z);
  const rw = RACK_TEX.w * z;
  const rh = RACK_TEX.h * z;
  const gap = snap(T / 4);
  const margin = snap(Math.max(T / 2, width * 0.03));
  const bottom = floorTop + snap(T / 2);
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    xs.push(margin + i * (rw + gap));
    xs.push(width - margin - rw - i * (rw + gap));
  }
  xs.forEach((rx, r) => {
    const ry = bottom - rh;
    paint(ctx, `rack-${(r % 4) + 1}`, rx, ry, z);
    for (let slot = 0; slot < RACK_TEX.slots; slot++) {
      if ((r * 3 + slot * 5) % 7 === 0) continue;
      const ux = rx + RACK_TEX.slotX * z;
      const uy = ry + (RACK_TEX.slotY0 + slot * RACK_TEX.slotH + RACK_TEX.unitDy) * z;
      paint(ctx, 'server-unit', ux, uy, z);
      const k = (r * 7 + slot * 3) % 9;
      leds.push({
        x: ux + RACK_TEX.ledX * z,
        y: uy + RACK_TEX.ledY * z,
        w: RACK_TEX.ledW * z,
        h: RACK_TEX.ledH * z,
        state: k === 4 ? 'amber' : 'green',
        phase: k % 3,
      });
    }
  });

  // keep the scene quiet behind the title
  ctx.fillStyle = BG;
  ctx.globalAlpha = 0.45;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 1;
  return leds;
}

/** Repaint just the LEDs: each blink touches only their few rects (resizing the canvas already clears it whole). */
function drawLeds(ctx: CanvasRenderingContext2D, leds: Led[], blink: number): void {
  for (const l of leds) {
    const look = ledLook(l.state, blink, l.phase);
    ctx.clearRect(l.x, l.y, l.w, l.h);
    ctx.globalAlpha = look.alpha;
    ctx.fillStyle = `#${look.color.toString(16).padStart(6, '0')}`;
    ctx.fillRect(l.x, l.y, l.w, l.h);
  }
  ctx.globalAlpha = 1;
}

export function TitleBackdrop() {
  const box = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLCanvasElement>(null);
  const lights = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = box.current;
    const a = scene.current?.getContext('2d');
    const b = lights.current?.getContext('2d');
    if (!el || !a || !b) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let leds: Led[] = [];
    let blink = 0;
    let size = { w: 0, h: 0 };

    const layout = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === size.w && h === size.h) return;
      size = { w, h };
      for (const c of [a.canvas, b.canvas]) {
        c.width = w;
        c.height = h;
      }
      a.imageSmoothingEnabled = false;
      const z = backdropZoom(window.innerWidth, window.innerHeight);
      // the menu keeps its buttons above the painted wall + floor (two tiles)
      el.closest<HTMLElement>('.title-screen')?.style.setProperty('--title-floor-h', `${2 * TILE * z}px`);
      leds = drawScene(a, w, h, z);
      drawLeds(b, leds, blink);
    };
    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(el);
    const timer = still
      ? undefined
      : window.setInterval(() => {
          blink++;
          drawLeds(b, leds, blink);
        }, BLINK_MS);
    return () => {
      ro.disconnect();
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, []);

  return (
    <div ref={box} className="title-backdrop">
      <canvas ref={scene} />
      <canvas ref={lights} />
    </div>
  );
}
