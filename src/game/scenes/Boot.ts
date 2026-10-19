import Phaser from 'phaser';
import { addLionSheets, loadLionSheets, setupLion } from '../sprites/lion';
import { generateWorldTextures } from '../textures';

/** Wait for the pixel font so canvas text doesn't render in a fallback face (gives up after a moment). */
function waitForFonts(ms: number): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts?.load) return Promise.resolve();
  const loads = Promise.all([fonts.load('11px Galmuri11'), fonts.load('bold 11px Galmuri11')]).then(() => undefined);
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  return Promise.race([loads, timeout]).catch(() => undefined);
}

/** Loads the lion sheets, paints every world texture, then starts the data center. */
export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2, '데이터센터 불러오는 중…', { fontFamily: 'Galmuri11, sans-serif', fontSize: '16px', color: '#b3a5ae' })
      .setOrigin(0.5);
    generateWorldTextures(this);
    let alive = true;
    this.events.once(Phaser.Scenes.Events.DESTROY, () => (alive = false));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => (alive = false));
    void Promise.all([loadLionSheets(), waitForFonts(1500)]).then(([sheets]) => {
      if (!alive) return;
      addLionSheets(this, sheets);
      setupLion(this);
      this.scene.start('DataCenter');
    });
  }
}
