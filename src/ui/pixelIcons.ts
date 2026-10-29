// 8 x 8 pixel icons for the few places where an icon carries meaning (sound on/off, alert source, status, HUD).
// '#' = currentColor, '+' = currentColor at half opacity, '.' = transparent. Kept free of React so tests can read it.

export const ICONS = {
  soundOn: [
    '...#....',
    '..##..#.',
    '####...#',
    '####.#.#',
    '####.#.#',
    '####...#',
    '..##..#.',
    '...#....',
  ],
  soundOff: [
    '...#....',
    '..##....',
    '####....',
    '####.#.#',
    '####..#.',
    '####.#.#',
    '..##....',
    '...#....',
  ],
  phone: [
    '.##.....',
    '###.....',
    '##......',
    '##......',
    '.##.....',
    '..##..##',
    '...#####',
    '....###.',
  ],
  siren: [
    '#..##..#',
    '.#.##.#.',
    '..####..',
    '.##+###.',
    '.##+###.',
    '.######.',
    '########',
    '########',
  ],
  warn: [
    '...##...',
    '..####..',
    '..#..#..',
    '.##..##.',
    '.##..##.',
    '########',
    '###..###',
    '########',
  ],
  check: [
    '........',
    '.......#',
    '......##',
    '#....##.',
    '##..##..',
    '.####...',
    '..##....',
    '........',
  ],
  lock: [
    '..####..',
    '.#....#.',
    '.#....#.',
    '########',
    '###..###',
    '###..###',
    '########',
    '########',
  ],
  monitor: [
    '########',
    '#++++++#',
    '#++++++#',
    '#++++++#',
    '########',
    '...##...',
    '..####..',
    '........',
  ],
  radio: [
    '.#......',
    '.#......',
    '.######.',
    '.#++++#.',
    '.######.',
    '.#.#.##.',
    '.######.',
    '.######.',
  ],
  book: [
    '........',
    '###..###',
    '#++##++#',
    '#++##++#',
    '#++##++#',
    '#++##++#',
    '########',
    '...##...',
  ],
  door: [
    '.######.',
    '.#++++#.',
    '.#++++#.',
    '.#++++#.',
    '.#+++##.',
    '.#++++#.',
    '.#++++#.',
    '########',
  ],
} satisfies Record<string, string[]>;

export type IconName = keyof typeof ICONS;

/** SVG path data for one ink ('#' or '+'): each horizontal run becomes one rectangle. */
export function iconPath(rows: string[], ink: '#' | '+'): string {
  const parts: string[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== ink) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x] === ink) x++;
      parts.push(`M${start} ${y}h${x - start}v1h${start - x}z`);
    }
  });
  return parts.join('');
}
