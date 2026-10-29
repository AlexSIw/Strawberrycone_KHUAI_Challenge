import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMOJI, stripEmoji } from '../src/ai/emoji';

/** Every source file a player can end up seeing text from (UI, content, the AI 사수's manuals and prompts). */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx|css|md)$/.test(name) ? [p] : [];
  });
}

describe('no color emoji', () => {
  it('the game and the hint worker use pixel icons and plain marks, never color emoji', () => {
    const hits: string[] = [];
    for (const file of [...sources('src'), ...sources('worker/src')]) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (EMOJI.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it('the guard catches the emoji that used to be there and lets the typographic marks through', () => {
    for (const e of ['🎯', '🚨', '📞', '✨', '🖥️', '⚠️', '⏭', '🗺', '1️⃣']) expect(EMOJI.test(e), e).toBe(true);
    for (const mark of ['★', '●', '▲', '✕', '▶', '◀', '✓', '✔', '▾', '▸', '→', '↔', '↩', '»']) expect(EMOJI.test(mark), mark).toBe(false);
  });

  it('AI replies lose flags, skin tones and joined emoji too, and emoji arrows become plain arrows', () => {
    expect(stripEmoji('한국 🇰🇷 서버')).toBe('한국 서버');
    expect(stripEmoji('좋아 👍🏽 해봐')).toBe('좋아 해봐');
    expect(stripEmoji('개발자 👨‍💻 출동')).toBe('개발자 출동');
    expect(stripEmoji('관리 PC ➡️ TOR-01 ➡ CORE-01')).toBe('관리 PC → TOR-01 → CORE-01');
  });
});
