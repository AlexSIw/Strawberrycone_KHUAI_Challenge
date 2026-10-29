// Where the game keeps a player's own ChatKHU key: this tab only (sessionStorage), or this browser when they tick
// "이 브라우저에 기억하기" (localStorage). It is only read to put on an /api/hint request (ai/client.ts).
import { cleanKey, isKeyShape } from '../ai/key';

const ITEM = 'khu-dc-chatkhu-key';
const listeners = new Set<() => void>();

/** Storage can be missing (tests, a blocked browser): then there is simply no key. */
function storage(kind: 'session' | 'local'): Storage | null {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function read(kind: 'session' | 'local'): string {
  try {
    return storage(kind)?.getItem(ITEM) ?? '';
  } catch {
    return '';
  }
}

function remove(kind: 'session' | 'local'): void {
  try {
    storage(kind)?.removeItem(ITEM);
  } catch {
    /* nothing to remove */
  }
}

const notify = () => listeners.forEach((fn) => fn());

/** The key in use: this tab's, else the remembered one. '' when there is none. */
export function ownKey(): string {
  const key = read('session') || read('local');
  return isKeyShape(key) ? key : '';
}

/** Is the key kept in this browser (not just this tab)? */
export const keyRemembered = (): boolean => isKeyShape(read('local'));

/** Keeps a pasted key, for this tab or (remember) this browser. False when it doesn't look like a key. */
export function saveKey(raw: string, remember: boolean): boolean {
  const key = cleanKey(raw);
  if (!isKeyShape(key)) return false;
  try {
    const target = storage(remember ? 'local' : 'session');
    if (!target) return false;
    remove(remember ? 'session' : 'local');
    target.setItem(ITEM, key);
  } catch {
    return false;
  }
  notify();
  return true;
}

/** Forgets the key everywhere: the game goes back to the server's key, or its own answers. */
export function clearKey(): void {
  remove('session');
  remove('local');
  notify();
}

/** Calls `fn` whenever the key is saved or cleared (for useSyncExternalStore). */
export function subscribeKey(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
