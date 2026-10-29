import type { CSSProperties } from 'react';
import type { Mood, Speaker } from '../content/types';
import { PORTRAIT_SIZE, portraitDataUrl, portraitKey } from '../game/art/portraits';

const NAMES: Record<Speaker, string> = { lion: '나 (신입)', mentor: '쿠사수 (사수)', boss: '팀장님', system: '안내' };

export const speakerName = (who: Speaker) => NAMES[who];

// No frame of its own: the face sits straight on whatever panel holds it.
const FRAME: CSSProperties = { display: 'flex', flexShrink: 0, background: 'transparent' };
const IMG: CSSProperties = { display: 'block', imageRendering: 'pixelated' };

/**
 * A 32 x 32 pixel portrait drawn at a whole-number scale, so every art pixel stays square.
 * Pass `size` as a multiple of 32 (anything else rounds down). The size is set as img attributes,
 * so a stylesheet can still resize `.portrait` (keep that a multiple of 32 too).
 */
export function Portrait({ who, mood = 'neutral', size = 96 }: { who: Speaker; mood?: Mood; size?: number }) {
  const px = PORTRAIT_SIZE * Math.max(1, Math.floor(size / PORTRAIT_SIZE));
  return (
    <div style={FRAME}>
      <img
        className="portrait"
        src={portraitDataUrl(portraitKey(who, mood))}
        alt=""
        width={px}
        height={px}
        draggable={false}
        style={IMG}
      />
    </div>
  );
}
