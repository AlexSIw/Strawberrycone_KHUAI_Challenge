import Phaser from 'phaser';
import { useEffect, useRef } from 'react';
import './PhaserGame.css';
import { Boot } from './scenes/Boot';
import { DataCenter } from './scenes/DataCenter';

type DebugWindow = Window & { __khuGame?: Phaser.Game };

/**
 * The Phaser world behind the React UI. App remounts it per stage (key={stage}).
 * The game is created on the next task so React StrictMode's mount → unmount → mount
 * never builds two games: the first timer is cancelled before it fires.
 */
export function PhaserGame() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = ref.current;
    if (!parent) return;
    let game: Phaser.Game | null = null;
    const timer = window.setTimeout(() => {
      const g = new Phaser.Game({
        type: Phaser.AUTO,
        parent,
        backgroundColor: '#120f16',
        pixelArt: true,
        roundPixels: true,
        banner: false,
        audio: { noAudio: true },
        scale: {
          mode: Phaser.Scale.RESIZE,
          width: parent.clientWidth || window.innerWidth,
          height: parent.clientHeight || window.innerHeight,
        },
        physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
        scene: [Boot, DataCenter],
      });
      // A new game (and WebGL context) is made per stage. Phaser doesn't release the context itself,
      // so after many stages the browser would start dropping "too many WebGL contexts" warnings.
      g.events.once(Phaser.Core.Events.DESTROY, () => {
        const r = g.renderer;
        const gl = r instanceof Phaser.Renderer.WebGL.WebGLRenderer ? r.gl : null;
        // runDestroy tears the renderer down synchronously right after this event
        if (gl) queueMicrotask(() => gl.getExtension('WEBGL_lose_context')?.loseContext());
      });
      game = g;
      if (import.meta.env.DEV) (window as DebugWindow).__khuGame = g;
    }, 0);

    return () => {
      window.clearTimeout(timer);
      if (!game) return;
      const w = window as DebugWindow;
      if (w.__khuGame === game) delete w.__khuGame;
      game.destroy(true);
      game = null;
    };
  }, []);

  return <div ref={ref} className="pg-root" role="region" aria-label="데이터센터 맵: WASD/방향키로 이동, 장비 앞에서 E 또는 스페이스로 사용" />;
}
