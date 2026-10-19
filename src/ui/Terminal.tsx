import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm, type ITheme } from '@xterm/xterm';
import { useEffect, useRef } from 'react';
import { available, promptFor } from '../sim/commands';
import { activeScenarios } from '../sim/engine';
import type { StageId } from '../sim/types';
import { gameStore, useGame } from '../store/game';
import { ModalFrame } from './ModalFrame';
import './Terminal.css';

// Dark palette that matches theme.css (warm ops-room colors).
const THEME: ITheme = {
  background: '#100d13',
  foreground: '#f4ece4',
  cursor: '#ff5a5f',
  cursorAccent: '#100d13',
  selectionBackground: 'rgba(233, 183, 124, 0.35)',
  black: '#221c28',
  red: '#ff5a5f',
  green: '#4fd17a',
  yellow: '#ffb547',
  blue: '#6ab7ff',
  magenta: '#e87ba4',
  cyan: '#5fd4d0',
  white: '#f4ece4',
  brightBlack: '#9a8c95',
  brightRed: '#ff7b7f',
  brightGreen: '#7be39c',
  brightYellow: '#ffd166',
  brightBlue: '#9ccfff',
  brightMagenta: '#f2a3c1',
  brightCyan: '#8ee6e2',
  brightWhite: '#ffffff',
};

const DIM = (s: string) => `\x1b[90m${s}\x1b[0m`;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
const ESC_SEQ_RE = /^\x1b(?:\[[0-9;?]*[A-Za-z~]|O[A-Za-z]|.)?/;
/** Hangul syllables and jamo (what "help" becomes when the keyboard is in 한글 mode). */
const HANGUL_RE = /[ᄀ-ᇿ㄰-㆏가-힣]/;

/** Characters that take two terminal cells (Hangul, CJK, emoji…). */
function isWide(c: number): boolean {
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1faff)
  );
}

function cellWidth(s: string): number {
  let n = 0;
  for (const ch of s.replace(ANSI_RE, '')) n += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1;
  return n;
}

const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n');
/** Home + erase screen + erase scrollback, sent through the write queue so it lands after earlier output. */
const CLEAR_ALL = '\x1b[H\x1b[2J\x1b[3J';

function commonPrefix(words: string[]): string {
  if (!words.length) return '';
  let p = words[0];
  for (const w of words) while (!w.startsWith(p)) p = p.slice(0, -1);
  return p;
}

/** "ping <이름 또는 IP>" → "ping ", "dhcp status | dhcp on" → "dhcp status". */
function usageStub(usage: string): string {
  const first = usage.split(' | ')[0];
  const cut = first.search(/[<[]/);
  if (cut < 0) return first.trim();
  return first.slice(0, cut).trimEnd() + ' ';
}

const currentStage = (): StageId => gameStore.getState().run?.stage ?? 0;

/** Commands whose last argument is a device / DNS name. */
const NAME_ARG_COMMANDS = ['ssh', 'ping'];

interface LineEditor {
  /** Replace the line being typed (used by the help list) */
  setLine(text: string): void;
  handleData(data: string): void;
}

/**
 * A tiny readline: keeps the current input line, history, and redraws the line
 * (even when it wraps) whenever the cursor isn't simply at the end.
 */
function createLineEditor(term: XTerm, isAlive: () => boolean): LineEditor {
  const store = () => gameStore.getState();
  let chars: string[] = [];
  let cur = 0;
  let prompt = promptFor(store().terminal.host);
  /** Rows between the prompt's first row and the row the cursor sits on */
  let row = 0;
  // Earlier commands this stage (also from previous visits), without repeats in a row.
  const history: string[] = (store().run?.ctx.commands ?? []).filter((c, i, all) => c !== all[i - 1]);
  let hIndex = history.length;
  let draft = '';

  const promptW = () => cellWidth(prompt);
  const widthOf = (arr: string[]) => cellWidth(arr.join(''));
  // After writing exactly up to the right edge, xterm keeps the cursor on that row ("pending wrap").
  const endRow = (pos: number) => {
    const cols = Math.max(1, term.cols);
    return pos > 0 && pos % cols === 0 ? pos / cols - 1 : Math.floor(pos / cols);
  };

  const render = () => {
    const cols = Math.max(1, term.cols);
    let s = row > 0 ? `\x1b[${row}A` : '';
    s += '\r\x1b[J' + prompt + chars.join('');
    const end = promptW() + widthOf(chars);
    const target = promptW() + widthOf(chars.slice(0, cur));
    const eRow = endRow(end);
    if (target === end) {
      row = eRow;
    } else {
      const tRow = Math.floor(target / cols);
      if (eRow > tRow) s += `\x1b[${eRow - tRow}A`;
      s += `\x1b[${(target % cols) + 1}G`;
      row = tRow;
    }
    term.write(s);
  };

  const setLine = (text: string) => {
    chars = [...text];
    cur = chars.length;
    render();
  };

  const insert = (text: string) => {
    const add = [...text];
    if (!add.length) return;
    if (cur === chars.length) {
      chars.push(...add);
      cur = chars.length;
      term.write(text);
      row = endRow(promptW() + widthOf(chars));
    } else {
      chars.splice(cur, 0, ...add);
      cur += add.length;
      render();
    }
  };

  const toEnd = () => {
    if (cur !== chars.length) {
      cur = chars.length;
      render();
    }
  };

  const newPrompt = () => {
    chars = [];
    cur = 0;
    row = 0;
    prompt = promptFor(store().terminal.host);
    term.write(prompt);
  };

  /** Writes lines and keeps them in the store so they come back next time. */
  const print = (lines: string[]) => {
    if (!lines.length) return;
    store().appendTerminal(lines);
    term.write(lines.map((l) => crlf(l) + '\r\n').join(''));
  };

  /** Returns false when the terminal went away (e.g. `hint` opened the radio). */
  const enter = (): boolean => {
    toEnd();
    const line = chars.join('');
    term.write('\r\n');
    store().appendTerminal([prompt + line]);
    const trimmed = line.trim();
    if (trimmed && history[history.length - 1] !== trimmed) history.push(trimmed);
    hIndex = history.length;
    draft = '';
    const res = store().command(line);
    // `hint` swaps the radio in without openModal(), so "open:mentor" (an objective) isn't recorded
    // and the lion keeps the fix pose. Open it again the normal way.
    const opened = store().modal;
    if (opened && opened.type !== 'terminal') store().openModal(opened);
    // Typing in 한글 mode turns "help" into "ㅗ디ㅔ": tell beginners how to switch.
    const lines = HANGUL_RE.test(trimmed.split(/\s+/)[0] ?? '')
      ? [...res.lines, DIM('팁: 한글로 입력됐어요. 한/영 키를 눌러 영어로 바꾼 뒤 다시 입력해보세요.')]
      : res.lines;
    if (res.clear) {
      store().clearTerminal();
      if (isAlive()) term.write(CLEAR_ALL);
    }
    if (!isAlive()) {
      // Still keep the output for the next time the terminal opens.
      if (lines.length) store().appendTerminal(lines);
      return false;
    }
    print(lines);
    newPrompt();
    // A command may have opened another window (the hint radio); stop handling pasted lines then.
    return store().modal?.type === 'terminal';
  };

  const cancel = () => {
    toEnd();
    term.write('^C\r\n');
    store().appendTerminal([prompt + chars.join('') + '^C']);
    hIndex = history.length;
    newPrompt();
  };

  const clearScreen = () => {
    term.write(CLEAR_ALL);
    store().clearTerminal();
    row = 0;
    render();
  };

  const showOptions = (options: string[]) => {
    toEnd();
    term.write('\r\n');
    const line = options.join('   ');
    store().appendTerminal([prompt + chars.join(''), line]);
    term.write(crlf(line) + '\r\n');
    row = 0;
    render();
  };

  const complete = () => {
    const text = chars.join('');
    const m = /^(\s*(?:sudo\s+)?(?:(?:kubectl|k)\s+)?)(.*)$/s.exec(text);
    const lead = m?.[1] ?? '';
    const rest = (m?.[2] ?? '').replace(/\s+/g, ' ');
    // One candidate per command: its real name when that matches, otherwise the first matching alias.
    const cands = [
      ...new Set(
        available(currentStage()).flatMap((c) => {
          const hit = [c.name, ...(c.aliases ?? [])].find((n) => n.startsWith(rest));
          return hit ? [hit] : [];
        }),
      ),
    ];
    if (cands.length === 1) return setLine(lead + cands[0] + ' ');
    if (cands.length > 1) {
      const common = commonPrefix(cands);
      if (common.length > rest.length) return setLine(lead + common);
      // Show the next word of each candidate: "docker " → "docker run", "docker ps", …
      const nextWord = (n: string) => {
        const sp = n.indexOf(' ', rest.length + (rest.endsWith(' ') || !rest ? 0 : 1));
        return sp < 0 ? n : n.slice(0, sp);
      };
      return showOptions([...new Set(cands.map(nextWord))]);
    }
    // Argument completion for "ssh we" / "ping d" → device or DNS names.
    const words = rest.split(' ');
    if (words.length >= 2 && NAME_ARG_COMMANDS.includes(words[0])) {
      const last = words[words.length - 1];
      const w = store().run?.world;
      if (!w) return;
      const known = [...new Set([...Object.keys(w.devices).filter((id) => id !== 'internet'), ...Object.keys(w.net?.dns ?? {})])];
      const hits = known.filter((n) => n.startsWith(last));
      const head = lead + words.slice(0, -1).join(' ') + ' ';
      if (hits.length === 1) return setLine(head + hits[0] + ' ');
      if (hits.length > 1) {
        const common = commonPrefix(hits);
        if (common.length > last.length) return setLine(head + common);
        showOptions(hits);
      }
    }
  };

  const historyUp = () => {
    if (hIndex === 0) return;
    if (hIndex === history.length) draft = chars.join('');
    hIndex -= 1;
    setLine(history[hIndex]);
  };

  const historyDown = () => {
    if (hIndex >= history.length) return;
    hIndex += 1;
    setLine(hIndex === history.length ? draft : history[hIndex]);
  };

  const escape = (seq: string) => {
    switch (seq) {
      case '\x1b[A':
      case '\x1bOA':
        return historyUp();
      case '\x1b[B':
      case '\x1bOB':
        return historyDown();
      case '\x1b[C':
      case '\x1bOC':
        if (cur < chars.length) {
          cur += 1;
          render();
        }
        return;
      case '\x1b[D':
      case '\x1bOD':
        if (cur > 0) {
          cur -= 1;
          render();
        }
        return;
      case '\x1b[H':
      case '\x1bOH':
      case '\x1b[1~':
        cur = 0;
        return render();
      case '\x1b[F':
      case '\x1bOF':
      case '\x1b[4~':
        return toEnd();
      case '\x1b[3~':
        if (cur < chars.length) {
          chars.splice(cur, 1);
          render();
        }
        return;
      default:
        return; // other keys (F1…, Alt+x) are ignored
    }
  };

  const handleData = (data: string) => {
    let i = 0;
    let pending = '';
    const flush = () => {
      if (pending) insert(pending);
      pending = '';
    };
    while (i < data.length) {
      if (!isAlive()) return;
      const ch = data[i];
      if (ch === '\x1b') {
        flush();
        const m = ESC_SEQ_RE.exec(data.slice(i));
        const seq = m?.[0] ?? ch;
        escape(seq);
        i += seq.length;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code >= 0x20 && code !== 0x7f) {
        pending += ch;
        i += 1;
        continue;
      }
      flush();
      i += 1;
      switch (ch) {
        case '\r':
        case '\n':
          // "\r\n" from a paste is one Enter.
          if (ch === '\r' && data[i] === '\n') i += 1;
          if (!enter()) return;
          break;
        case '\x7f':
        case '\b':
          if (cur > 0) {
            chars.splice(cur - 1, 1);
            cur -= 1;
            render();
          }
          break;
        case '\t':
          complete();
          break;
        case '\x03':
          cancel();
          break;
        case '\x0c':
          clearScreen();
          break;
        case '\x01':
          cur = 0;
          render();
          break;
        case '\x05':
          toEnd();
          break;
        case '\x15':
          chars = chars.slice(cur);
          cur = 0;
          render();
          break;
        case '\x17': {
          // Ctrl+W: delete the word before the cursor
          let j = cur;
          while (j > 0 && chars[j - 1] === ' ') j -= 1;
          while (j > 0 && chars[j - 1] !== ' ') j -= 1;
          chars.splice(j, cur - j);
          cur = j;
          render();
          break;
        }
        default:
          break; // other control characters do nothing
      }
    }
    flush();
  };

  return { setLine, handleData };
}

/**
 * The bundled Korean coding font comes first so every machine gets the same cells (Hangul exactly two
 * cells wide); D2Coding is only a fallback for players who have it installed.
 */
const TERM_FONT = "'Nanum Gothic Coding', D2Coding, Menlo, monospace";
/** Commands every stage has: listed after the ones this stage is about. */
const BASIC_COMMANDS = new Set(['help', 'clear', 'hint']);

/** Host the welcome message was last printed for (to note when the player plugs into another server). */
let lastSessionHost: string | null = null;

export function Terminal({ host }: { host: string }) {
  const storeHost = useGame((s) => s.terminal.host);
  const run = useGame((s) => s.run);
  const screenRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const editorRef = useRef<LineEditor | null>(null);

  useEffect(() => {
    const el = screenRef.current;
    if (!el) return;
    let alive = true;
    const term = new XTerm({
      fontFamily: TERM_FONT,
      fontSize: 14,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 2000,
      theme: THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;

    const refit = () => {
      if (!alive) return;
      try {
        fit.fit();
      } catch {
        /* container not laid out yet */
      }
    };
    refit();

    // xterm measures its cell size once, on open. The web font loads lazily (per unicode-range subset),
    // so on a first open it measured a fallback font and Hangul sat in over-wide cells with gaps.
    // Once the font is in, switch the family away and back: each change makes xterm measure again.
    void document.fonts
      ?.load("14px 'Nanum Gothic Coding'", 'ops 관리 접속 help W')
      .then(() => {
        if (!alive) return;
        term.options.fontFamily = 'monospace';
        term.options.fontFamily = TERM_FONT;
        refit();
      })
      .catch(() => {
        /* font blocked: keep the fallback measurement */
      });

    // Escape belongs to the window (closes it); Ctrl+V / Ctrl+C-with-selection go to the browser clipboard.
    term.attachCustomKeyEventHandler((e) => {
      if (e.key === 'Escape') return false;
      if (e.type === 'keydown' && e.ctrlKey && !e.altKey && !e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'v') return false;
        if (k === 'c' && term.hasSelection()) return false;
      }
      return true;
    });

    // Restore scrollback, or say hello on the first visit.
    const s = gameStore.getState();
    const cur = s.terminal.host;
    const label = s.run?.world.devices[cur]?.label;
    if (s.terminal.log.length === 0) {
      const welcome = [
        `\x1b[1;33m${cur}\x1b[0m${label ? `(${label})` : ''}에 접속했어요.`,
        'help를 입력하면 쓸 수 있는 명령어가 나와요.',
        DIM('Tab 자동완성 · ↑↓ 이전 명령 · Ctrl+C 취소 · Ctrl+L 화면 지우기 · Esc 닫기'),
        '',
      ];
      s.appendTerminal(welcome);
      term.write(welcome.map((l) => l + '\r\n').join(''));
    } else {
      term.write(s.terminal.log.map((l) => crlf(l) + '\r\n').join(''));
      if (lastSessionHost !== null && lastSessionHost !== cur) {
        const note = DIM(`── ${cur}${label ? `(${label})` : ''}에 연결했어요 ──`);
        s.appendTerminal([note]);
        term.write(note + '\r\n');
      }
    }
    lastSessionHost = cur;
    term.write(promptFor(cur));

    const editor = createLineEditor(term, () => alive);
    editorRef.current = editor;
    const sub = term.onData((d) => editor.handleData(d));

    const ro = new ResizeObserver(() => requestAnimationFrame(refit));
    ro.observe(el);
    const raf = requestAnimationFrame(() => {
      refit();
      if (alive) term.focus();
    });

    return () => {
      alive = false;
      lastSessionHost = gameStore.getState().terminal.host;
      cancelAnimationFrame(raf);
      ro.disconnect();
      sub.dispose();
      editorRef.current = null;
      termRef.current = null;
      // open() queues a setTimeout that syncs the scroll area; disposing before it runs makes it throw
      // ("reading 'dimensions'") — always under StrictMode's mount → unmount → mount, or on a quick close.
      // Timers run in order, so disposing from a later one is safe. The element is already detached.
      window.setTimeout(() => term.dispose(), 0);
    };
  }, []);

  const stage = run?.stage ?? 0;
  // This stage's new commands first (what the objectives ask for), the always-there basics last.
  const rank = (c: { name: string; minStage: number }) => (c.minStage === stage ? 0 : BASIC_COMMANDS.has(c.name) ? 2 : 1);
  const commands = [...available(stage)].sort((a, b) => rank(a) - rank(b));
  const incidents = run ? activeScenarios(run) : [];

  const typeUsage = (usage: string) => {
    editorRef.current?.setLine(usageStub(usage));
    termRef.current?.focus();
  };

  return (
    <ModalFrame title={`터미널 — ${storeHost || host}`} icon="💻" size="wide">
      <p className="term-next muted">명령어를 입력하고 Enter. 모르겠으면 "명령어 도움말"에서 골라보세요.</p>
      <div className="term-wrap">
        <div className="term-screen" onMouseDown={() => requestAnimationFrame(() => termRef.current?.focus())}>
          <div ref={screenRef} className="term-xterm" />
        </div>
        <aside className="term-side">
          <section className="term-help">
            <h3>명령어 도움말</h3>
            <p className="term-tip muted">누르면 입력줄에 들어가요.</p>
            <ul>
              {commands.map((c) => (
                <li key={c.name}>
                  <button type="button" className="term-cmd" onClick={() => typeUsage(c.usage)} title={c.usage}>
                    <code>
                      {c.usage}
                      {c.minStage === stage && stage > 0 && <em className="term-new">NEW</em>}
                    </code>
                    <span>{c.summary}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className={`term-incidents ${incidents.length ? 'has' : ''}`}>
            <h3>지금 장애</h3>
            {incidents.length === 0 ? (
              <p className="muted term-calm">지금은 조용해요 ✨</p>
            ) : (
              <ul>
                {incidents.map(({ rt, def }) => (
                  <li key={rt.id}>
                    <span className="term-inc-title">
                      {def.severity === 'critical' ? '🚨' : '⚠️'} {def.title}
                    </span>
                    <button
                      type="button"
                      className="btn term-hint-btn"
                      onClick={() => gameStore.getState().openModal({ type: 'hint', scenarioId: rt.id })}
                    >
                      쿠사수 힌트
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </ModalFrame>
  );
}
