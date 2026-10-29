import type { ReactNode } from 'react';
import { ModalFrame } from './ModalFrame';
import './Credits.css';

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** Third-party music, sounds and fonts (see docs/ASSETS.md). */
export function Credits({ onClose }: { onClose: () => void }) {
  return (
    <ModalFrame
      title="크레딧"
      size="narrow"
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose} autoFocus>
          닫기
        </button>
      }
    >
      <dl className="credits">
        <dt>음악</dt>
        <dd>
          <ul>
            <li>
              “Snowland Town” — Music by Matthew Pablo — <Ext href="https://www.matthewpablo.com">www.matthewpablo.com</Ext> (
              <Ext href="https://opengameart.org/content/snowland-town">OpenGameArt.org</Ext>,{' '}
              <Ext href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</Ext>) · 타이틀·다시 하기·엔딩
            </li>
            <li>
              “Bouncing Around in Pixel Town” by Eric Matyas (<Ext href="https://soundimage.org">www.soundimage.org</Ext>)
            </li>
            <li>“ピンチ - 8bit” by Hupple (OpenTracks)</li>
          </ul>
        </dd>
        <dt>효과음</dt>
        <dd>
          <ul>
            <li>“Short alarm” by yd (OpenGameArt.org, CC0)</li>
            <li>“Win Jingle” by Fupi (OpenGameArt.org, CC0)</li>
            <li>
              “Coin Bling - Sound Effect” by Tung Lee Media (<Ext href="https://www.youtube.com/watch?v=3D_Wl3e7ddE">YouTube</Ext>) — used with
              permission (허락받아 사용)
            </li>
          </ul>
        </dd>
        <dt>대화 소리</dt>
        <dd>
          <ul>
            <li>
              “animalese.wav” by Josh Simmons (<Ext href="https://github.com/Acedio/animalese.js">github.com/Acedio/animalese.js</Ext>),{' '}
              <Ext href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</Ext> · 글자별로 잘라 음높이를 바꿔 재생
            </li>
          </ul>
        </dd>
        <dt>폰트</dt>
        <dd>
          <ul>
            <li>Galmuri (quiple), Noto Sans KR (Google), Nanum Gothic Coding (Naver) — SIL Open Font License</li>
          </ul>
        </dd>
      </dl>
    </ModalFrame>
  );
}
