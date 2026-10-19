import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../audio/engine';
import { blipLetter, VOICE_PITCH } from '../audio/logic';
import type { DialogueLine } from '../content/types';
import { gameStore, useGame } from '../store/game';
import { Portrait, speakerName } from './Portrait';
import './DialogueBox.css';

const CHARS_PER_SEC = 35;

/** Skip through every remaining line (same as pressing Enter until the end). */
function skipAll() {
  const d = gameStore.getState().dialogue;
  if (!d) return;
  for (let i = d.index; i < d.lines.length; i++) gameStore.getState().nextDialogue();
}

function Line({ line, index, total }: { line: DialogueLine; index: number; total: number }) {
  const chars = useMemo(() => Array.from(line.text), [line.text]);
  const [shown, setShown] = useState(0);
  const complete = shown >= chars.length;
  const mountedAt = useRef(performance.now());
  const pitch = VOICE_PITCH[line.who];
  const lastShown = useRef(0);
  const skipped = useRef(false);

  useEffect(() => {
    if (complete) return;
    const id = window.setInterval(() => setShown((n) => n + 1), 1000 / CHARS_PER_SEC);
    return () => window.clearInterval(id);
  }, [complete]);

  // Blabber: one animalese blip per revealed letter, in step with the typewriter. A skip shows the
  // rest at once, so it stops the voice instead of blipping the whole line.
  useEffect(() => {
    const prev = lastShown.current;
    lastShown.current = shown;
    if (pitch === null || shown <= prev) return;
    if (skipped.current) {
      audio.stopBlip();
      return;
    }
    // Usually one new character per tick. If a late timer revealed several in one render, voice the
    // newest letter among them (they appeared together, and only one blip sounds at a time anyway).
    for (let i = shown - 1; i >= prev; i--) {
      const letter = blipLetter(chars[i] ?? '');
      if (letter) {
        audio.blip(letter, pitch);
        break;
      }
    }
  }, [shown, pitch, chars]);
  useEffect(() => () => audio.stopBlip(), []);

  const advance = useCallback(() => {
    // Ignore the very first moment so a double press doesn't skip a line unseen.
    if (performance.now() - mountedAt.current < 120) return;
    if (!complete) {
      skipped.current = true;
      setShown(chars.length);
    } else gameStore.getState().nextDialogue();
  }, [complete, chars.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      advance();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [advance]);

  const who = line.who;
  const isTip = who === 'system';
  const isLast = index === total - 1;

  return (
    <div className="dlg-backdrop" onClick={advance}>
      <div className={`dlg-box dlg-${who} ${isTip ? 'dlg-tip' : ''}`} role="dialog" aria-live="polite" aria-label={isTip ? '도움말' : speakerName(who)}>
        <div className="dlg-portrait">
          <Portrait who={who} mood={line.mood ?? (who === 'lion' ? 'happy' : 'neutral')} size={96} />
        </div>
        <div className="dlg-main">
          <div className="dlg-name">
            {isTip ? '💡 도움말' : speakerName(who)}
            <span className="dlg-count">
              {index + 1}/{total}
            </span>
          </div>
          <p className="dlg-text">
            <span aria-hidden>{chars.slice(0, shown).join('')}</span>
            <span className="dlg-ghost" aria-hidden>
              {chars.slice(shown).join('')}
            </span>
            {/* Screen readers get the whole line once instead of one letter at a time */}
            <span className="dlg-sr">{line.text}</span>
          </p>
          <div className="dlg-foot">
            <span className="dlg-help">{complete ? (isLast ? '클릭하거나 Enter로 닫기' : '클릭하거나 Enter로 계속') : '클릭하면 바로 다 보여요'}</span>
            {complete && (
              <span className="dlg-next" aria-hidden>
                ▼
              </span>
            )}
          </div>
        </div>
        {total - index > 1 && (
          <button
            className="btn ghost dlg-skip"
            onClick={(e) => {
              e.stopPropagation();
              skipAll();
            }}
            title="남은 대화를 모두 건너뛰어요"
          >
            건너뛰기 ⏭
          </button>
        )}
      </div>
    </div>
  );
}

/** Story dialogue at the bottom of the screen. Pauses the game while open. */
export function DialogueBox() {
  const dialogue = useGame((s) => s.dialogue);
  // Fixing the last incident clears the stage in the same tick. Show its concept card first
  // (ConceptCardPopup), then the outro, so the "방금 일어난 일" lesson isn't skipped.
  const cardsFirst = useGame((s) => s.dialogue?.then === 'results' && s.concepts.length > 0);
  if (!dialogue || cardsFirst) return null;
  const line = dialogue.lines[dialogue.index];
  if (!line) return null;
  return <Line key={`${dialogue.then}:${dialogue.index}:${line.text}`} line={line} index={dialogue.index} total={dialogue.lines.length} />;
}
