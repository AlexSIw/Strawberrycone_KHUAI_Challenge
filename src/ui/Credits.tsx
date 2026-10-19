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
      icon="🎵"
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
