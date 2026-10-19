// Converts the hand-made lion sheets in art/ into game-ready sprites in public/assets/.
// Source layout (1024x1024, transparent):
//   art/lion_walk.png, art/lion_angry.png : 4x4 cells of 256px, rows = down, left, right, up
//   art/lion_extras.png                    : portraits + idle(2) + fix(2), boxes below
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const FRAME = 96;          // output frame size
const CELL = 256;          // source cell size
const SCALE = FRAME / CELL;
const BASELINE = 240;      // feet line inside a source walk cell
const WALK_HEIGHT = 210;   // typical figure height inside a source walk cell
const ALPHA_CUTOFF = 40;   // clears the soft dark fringe around the AI-generated art

const EXTRAS = {
  portraitHappy: [40, 60, 472, 504],
  portraitWorried: [556, 60, 984, 504],
  idle: [[16, 612, 252, 920], [276, 612, 504, 920]],
  fix: [[532, 632, 780, 920], [800, 632, 1012, 920]],
};

mkdirSync('public/assets/sprites', { recursive: true });
mkdirSync('public/assets/portraits', { recursive: true });

async function cleanAlpha(buf, width, height) {
  const { data } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) if (data[i] < ALPHA_CUTOFF) data[i] = 0;
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function sheet(src, out) {
  const size = FRAME * 4;
  const resized = await sharp(src).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
  await sharp(await cleanAlpha(resized, size, size)).toFile(out);
  console.log('wrote', out);
}

// Crop a figure from the extras sheet, rescale it to the walk figure's size and
// place it on a FRAME x FRAME canvas with the feet on the same baseline as the walk frames.
async function figure(box) {
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0, h = y1 - y0;
  const targetH = Math.round(WALK_HEIGHT * SCALE);
  const k = targetH / h;
  const tw = Math.round(w * k), th = targetH;
  const img = await sharp('art/lion_extras.png')
    .extract({ left: x0, top: y0, width: w, height: h })
    .resize(tw, th, { kernel: 'lanczos3' })
    .png().toBuffer();
  const left = Math.round((FRAME - tw) / 2);
  const top = Math.round(BASELINE * SCALE) - th;
  return { input: await cleanAlpha(img, tw, th), left: Math.max(0, left), top: Math.max(0, top) };
}

async function strip(boxes, out) {
  const parts = await Promise.all(boxes.map(figure));
  await sharp({ create: { width: FRAME * boxes.length, height: FRAME, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(parts.map((p, i) => ({ ...p, left: p.left + i * FRAME })))
    .png().toFile(out);
  console.log('wrote', out);
}

async function portrait(box, out) {
  const [x0, y0, x1, y1] = box;
  const img = await sharp('art/lion_extras.png')
    .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
    .resize(192, 192, { kernel: 'lanczos3', fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  await sharp(await cleanAlpha(img, 192, 192)).toFile(out);
  console.log('wrote', out);
}

await sheet('art/lion_walk.png', 'public/assets/sprites/lion_walk.png');
await sheet('art/lion_angry.png', 'public/assets/sprites/lion_angry.png');
await strip(EXTRAS.idle, 'public/assets/sprites/lion_idle.png');
await strip(EXTRAS.fix, 'public/assets/sprites/lion_fix.png');
await portrait(EXTRAS.portraitHappy, 'public/assets/portraits/lion_happy.png');
await portrait(EXTRAS.portraitWorried, 'public/assets/portraits/lion_worried.png');
