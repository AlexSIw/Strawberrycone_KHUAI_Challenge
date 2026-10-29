// Bakes every world texture from the specs in ./art into Phaser canvas textures: no image files.
import Phaser from 'phaser';
import { textureSpecs } from './art';
import { canvasTarget, Painter, type TextureSpec } from './art/painter';

export { CABINET_TEX, PATCH_LED, PDU_LEDS, ROUTER_LEDS, switchLed, UPS_LCD, UPS_LED } from './art/cabinets';
export { CRAC_TEX } from './art/cooling';
export { BOARD_TEX, DESK_TEX, MONITOR_SCREENS, MONITOR_TEX } from './art/noc';
export { RACK_TEX } from './art/racks';

function bake(scene: Phaser.Scene, spec: TextureSpec): void {
  if (scene.textures.exists(spec.key)) scene.textures.remove(spec.key);
  const w = Math.round(spec.w * spec.unit);
  const h = Math.round(spec.h * spec.unit);
  const tex = scene.textures.createCanvas(spec.key, w, h);
  if (!tex) return;
  spec.draw(new Painter(canvasTarget(tex.context), spec.unit));
  tex.refresh();
  if (spec.frames) {
    const fw = w / spec.frames;
    for (let i = 0; i < spec.frames; i++) tex.add(i, 0, i * fw, 0, fw, h);
  }
}

/** Paint every world texture. Call once from Boot. */
export function generateWorldTextures(scene: Phaser.Scene): void {
  for (const spec of textureSpecs()) bake(scene, spec);
}
