// A player's own ChatKHU key: kept in the browser (tab or remembered), sent with each hint request, used by the
// Worker instead of its own, checked with /api/key-check, and never logged.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkKey, requestMissionText } from '../src/ai/client';
import { cleanKey, isKeyShape, KEY_HEADER } from '../src/ai/key';
import { startStage } from '../src/sim/engine';
import { clearKey, keyRemembered, ownKey, saveKey, subscribeKey } from '../src/ui/keyStorage';
import { handleHint, handleKeyCheck } from '../worker/src/hint';

const KEY = 'sk-test-PLAYER-KEY-1234567890';

/** A Storage good enough for keyStorage.ts. */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

let session: Storage;
let local: Storage;
beforeEach(() => {
  session = memoryStorage();
  local = memoryStorage();
  vi.stubGlobal('window', { sessionStorage: session, localStorage: local });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('keeping the key in the browser', () => {
  it('a pasted key is cleaned; anything with spaces or too short is no key', () => {
    expect(cleanKey('  "sk-abc-12345678"\n')).toBe('sk-abc-12345678');
    expect(isKeyShape('sk-abc-12345678')).toBe(true);
    expect(isKeyShape('sk abc 12345678')).toBe(false);
    expect(isKeyShape('short')).toBe(false);
    expect(saveKey('not a key', false)).toBe(false);
    expect(ownKey()).toBe('');
  });

  it('this tab only by default; remembered in the browser when asked; cleared from both', () => {
    const changes = vi.fn();
    const off = subscribeKey(changes);
    expect(saveKey(` ${KEY} `, false)).toBe(true);
    expect(session.getItem('khu-dc-chatkhu-key')).toBe(KEY);
    expect(local.getItem('khu-dc-chatkhu-key')).toBeNull();
    expect(ownKey()).toBe(KEY);
    expect(keyRemembered()).toBe(false);

    expect(saveKey(KEY, true)).toBe(true);
    expect(local.getItem('khu-dc-chatkhu-key')).toBe(KEY);
    // Not left behind in the tab's storage either.
    expect(session.getItem('khu-dc-chatkhu-key')).toBeNull();
    expect(keyRemembered()).toBe(true);

    clearKey();
    expect(ownKey()).toBe('');
    expect(local.getItem('khu-dc-chatkhu-key')).toBeNull();
    expect(changes).toHaveBeenCalledTimes(3);
    off();
  });

  it('no storage at all (blocked): simply no key', () => {
    vi.stubGlobal('window', undefined);
    expect(ownKey()).toBe('');
    expect(saveKey(KEY, false)).toBe(false);
  });
});

describe('the game sends it, and checks it', () => {
  it('a saved key goes with every hint request; without one, no header', async () => {
    const seen: (string | undefined)[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { headers: Record<string, string> }) => {
      seen.push(init.headers[KEY_HEADER]);
      return new Response(JSON.stringify({ reply: '좋아', kind: 'explain' }), { status: 200 });
    });
    const run = startStage(1);
    await requestMissionText({ run, history: [], host: 'ops' });
    saveKey(KEY, false);
    await requestMissionText({ run, history: [], host: 'ops' });
    expect(seen).toEqual([undefined, KEY]);
  });

  it('연결 확인: ok, a refused key, no Worker', async () => {
    const bodies: { url: string; key?: string }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string> }) => {
      bodies.push({ url, key: init.headers[KEY_HEADER] });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    expect(await checkKey(KEY)).toEqual({ ok: true });
    expect(bodies).toEqual([{ url: '/api/key-check', key: KEY }]);
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: false, reason: 'badkey' }), { status: 200 }));
    expect(await checkKey(KEY)).toEqual({ ok: false, reason: 'badkey' });
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    expect(await checkKey(KEY)).toEqual({ ok: false, reason: 'offline' });
  });
});

describe('the Worker uses it instead of its own, and never logs it', () => {
  const MANUALS = ['', '', '', '', '', ''];
  const mission = { objectiveId: 'dns', stage: 1, question: 'DNS가 뭐야?', history: [], snapshot: { day: 'D-4' } };
  const req = (path: string, body: unknown, key?: string) =>
    new Request(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body), headers: key === undefined ? {} : { [KEY_HEADER]: key } });
  let apiKeys: string[] = [];
  let status = 200;
  const logged: string[] = [];
  beforeEach(() => {
    apiKeys = [];
    status = 200;
    logged.length = 0;
    vi.spyOn(console, 'log').mockImplementation((line: string) => void logged.push(line));
    vi.stubGlobal('fetch', async (_url: string, init: { headers: Record<string, string> }) => {
      apiKeys.push(init.headers['x-api-key']);
      if (status !== 200) return new Response('no', { status });
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ kind: 'explain', answer: 'DNS는 전화번호부야.' }) }], usage: {} }), { status: 200 });
    });
  });

  it("the player's key goes to ChatKHU, even with none on the server; the log says so, without the key", async () => {
    const res = await handleHint(req('/api/hint', mission, KEY), {}, {}, MANUALS);
    expect(await res.json()).toMatchObject({ kind: 'explain' });
    expect(apiKeys).toEqual([KEY]);
    const line = JSON.parse(logged.at(-1)!) as Record<string, unknown>;
    expect(line).toMatchObject({ event: 'hint', ownKey: true, outcome: 'ok' });
    expect(logged.join('\n')).not.toContain(KEY);
  });

  it("no player key: the server's; neither: nokey", async () => {
    await handleHint(req('/api/hint', mission), { CHATKHU_API_KEY: 'server-key-123456' }, {}, MANUALS);
    expect(apiKeys).toEqual(['server-key-123456']);
    expect(await (await handleHint(req('/api/hint', mission), {}, {}, MANUALS)).json()).toEqual({ fallback: true, reason: 'nokey' });
  });

  it('a refused key is badkey when it was the player’s, upstream when it was the server’s; a malformed one never goes out', async () => {
    status = 401;
    expect(await (await handleHint(req('/api/hint', mission, KEY), {}, {}, MANUALS)).json()).toEqual({ fallback: true, reason: 'badkey' });
    expect(await (await handleHint(req('/api/hint', mission), { CHATKHU_API_KEY: 'server-key-123456' }, {}, MANUALS)).json()).toEqual({
      fallback: true,
      reason: 'upstream',
    });
    apiKeys = [];
    expect(await (await handleHint(req('/api/hint', mission, 'has spaces in it'), {}, {}, MANUALS)).json()).toEqual({ fallback: true, reason: 'badkey' });
    expect(apiKeys).toEqual([]);
  });

  it('every call to the gateway says who it is (its Cloudflare blocks an empty User-Agent); a refusal is logged in its own words', async () => {
    const agents: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { headers: Record<string, string> }) => {
      agents.push(init.headers['user-agent']);
      return new Response('error code: 1010', { status: 403 });
    });
    expect(await (await handleHint(req('/api/hint', mission), { CHATKHU_API_KEY: 'server-key-123456' }, {}, MANUALS)).json()).toEqual({
      fallback: true,
      reason: 'upstream',
    });
    expect(agents[0]).toMatch(/^khu-dc-game-hint\//);
    expect(JSON.parse(logged.at(-1)!)).toMatchObject({ outcome: 'error', error: 'upstream 403: error code: 1010' });
    expect(logged.join('\n')).not.toContain('server-key-123456');
  });

  it('/api/key-check: one tiny call with the player’s key; ok, or why not', async () => {
    expect(await (await handleKeyCheck(req('/api/key-check', {}, KEY), {}, {})).json()).toEqual({ ok: true });
    expect(apiKeys).toEqual([KEY]);
    expect(await (await handleKeyCheck(req('/api/key-check', {}), { CHATKHU_API_KEY: 'server-key-123456' }, {})).json()).toEqual({ ok: false, reason: 'badkey' });
    status = 403;
    expect(await (await handleKeyCheck(req('/api/key-check', {}, KEY), {}, {})).json()).toEqual({ ok: false, reason: 'badkey' });
    expect(logged.some((l) => l.includes('"event":"key-check"'))).toBe(true);
    expect(logged.join('\n')).not.toContain(KEY);
  });
});
