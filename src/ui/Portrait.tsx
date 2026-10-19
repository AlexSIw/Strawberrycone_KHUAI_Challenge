import type { CSSProperties, ReactElement } from 'react';
import type { Mood, Speaker } from '../content/types';

// Pixel portraits for the people around the lion. Each row is 16 chars; '.' is transparent.
const PALETTE: Record<string, string> = {
  k: '#2a1410', // outline
  h: '#3b2a24', // hair
  g: '#9aa0a8', // gray hair
  s: '#f2c9a0', // skin
  S: '#d9a77c', // skin shade
  w: '#ffffff',
  e: '#1d1d1d', // eyes
  r: '#d7262b', // KHU red
  n: '#22305e', // navy
  b: '#4a6fa5', // blue
  m: '#c0392b', // mouth
  p: '#f4a6a6', // cheeks
  y: '#ffd166', // headset light
  t: '#6b7280', // tie / glasses frame
};

const MENTOR = [
  '................',
  '.....kkkkkk.....',
  '....khhhhhhk....',
  '...khhhhhhhhk...',
  '..kyhsssssshyk..',
  '..kthssssssskt..',
  '..ktteesseettk..',
  '..kksssssssskk..',
  '...kspssssspk...',
  '...ksssmmsssk...',
  '....kssssssk....',
  '...knnnnnnnnk...',
  '..knnbnnnnbnnk..',
  '.knnnbnrrnbnnnk.',
  '.knnnnnrrnnnnnk.',
  '.kkkkkkkkkkkkkk.',
];

const BOSS = [
  '................',
  '.....kkkkkk.....',
  '....kggggggk....',
  '...kggggggggk...',
  '...kgssssssgk...',
  '...ksssssssSk...',
  '...kseesseesk...',
  '...kssssssssk...',
  '...ksSssssSsk...',
  '...kssmmmmssk...',
  '....kssssssk....',
  '...kwwwwwwwwk...',
  '..knwwwrrwwwnk..',
  '.knnnwwrrwwnnnk.',
  '.knnnnwrrwnnnnk.',
  '.kkkkkkkkkkkkkk.',
];

function PixelFace({ rows, size }: { rows: string[]; size: number }) {
  const cells: ReactElement[] = [];
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      const fill = PALETTE[c];
      if (fill) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={fill} />);
    }),
  );
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" aria-hidden>
      {cells}
    </svg>
  );
}

const NAMES: Record<Speaker, string> = { lion: '나 (신입)', mentor: '쿠사수 (사수)', boss: '팀장님', system: '안내' };

export const speakerName = (who: Speaker) => NAMES[who];

export function Portrait({ who, mood = 'neutral', size = 96 }: { who: Speaker; mood?: Mood; size?: number }) {
  const frame: CSSProperties = {
    width: size,
    height: size,
    borderRadius: 12,
    background: 'linear-gradient(180deg, #3a2f43, #241d2b)',
    border: '2px solid var(--line)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  };
  if (who === 'lion') {
    const src = mood === 'worried' ? '/assets/portraits/lion_worried.png' : '/assets/portraits/lion_happy.png';
    return (
      <div style={frame}>
        <img src={src} alt="" width={size} height={size} style={{ objectFit: 'contain' }} />
      </div>
    );
  }
  if (who === 'system') {
    return (
      <div style={{ ...frame, fontSize: size * 0.45 }} aria-hidden>
        💡
      </div>
    );
  }
  return (
    <div style={frame}>
      <PixelFace rows={who === 'mentor' ? MENTOR : BOSS} size={size * 0.9} />
    </div>
  );
}
