// The game draws no color emoji (pixel icons and plain marks only). The AI 사수 is told not to use any, and
// whatever it sends anyway is stripped: on the Worker (worker/src/hint.ts) and again in the client.

/**
 * One color emoji, or a piece of one: the presentation selector, the keycap mark, the joiner that glues emoji
 * together, a skin-tone modifier, a flag letter or a tag character. The typographic marks the UI uses
 * (↔ ↩ ▶ ◀ ✔) stay.
 */
export const EMOJI = /(?![↔↩▶◀✔])\p{Extended_Pictographic}|[\u{FE0F}\u{20E3}\u{200D}\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}\u{E0020}-\u{E007F}]/u;

/** Emoji arrows keep their meaning as plain arrows (an arrow between two steps stays a step). */
const ARROWS: [RegExp, string][] = [
  [/\u27A1\uFE0F?/gu, '→'],
  [/\u2B05\uFE0F?/gu, '←'],
  [/\u2B06\uFE0F?/gu, '↑'],
  [/\u2B07\uFE0F?/gu, '↓'],
];

// A run of emoji standing as a word takes one space after it along; one stuck to a word (a keycap digit) goes alone.
const EMOJI_RUN = new RegExp(`(?<!\\S)(?:${EMOJI.source})+[ \\t]?|(?:${EMOJI.source})+`, 'gu');

/** The text without emoji, and without the space one leaves behind (at the end of a line, or after one that starts it). */
export function stripEmoji(text: string): string {
  const arrows = ARROWS.reduce((t, [re, plain]) => t.replace(re, plain), text);
  return arrows.replace(EMOJI_RUN, '').replace(/[ \t]+$/gm, '').trim();
}
