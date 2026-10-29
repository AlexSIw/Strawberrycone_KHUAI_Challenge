// The game draws no color emoji (pixel icons and plain marks only). The AI 사수 is told not to use any, and
// whatever it sends anyway is stripped: on the Worker (worker/src/hint.ts) and again in the client.

/** One color emoji, or the emoji presentation selector / keycap mark. The typographic marks the UI uses (↔ ↩ ▶ ◀ ✔) stay. */
export const EMOJI = /(?![↔↩▶◀✔])\p{Extended_Pictographic}|[\u{FE0F}\u{20E3}]/u;

// A run of emoji standing as a word takes one space after it along; one stuck to a word (a keycap digit) goes alone.
const EMOJI_RUN = new RegExp(`(?<!\\S)(?:${EMOJI.source})+[ \\t]?|(?:${EMOJI.source})+`, 'gu');

/** The text without emoji, and without the space one leaves behind (at the end of a line, or after one that starts it). */
export function stripEmoji(text: string): string {
  return text.replace(EMOJI_RUN, '').replace(/[ \t]+$/gm, '').trim();
}
