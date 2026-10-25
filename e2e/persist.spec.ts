// Windows remember their state until the day restarts: each place's terminal keeps its own session
// (host after ssh, IOS mode, scrollback, ↑ history, half-typed line), and boards keep half-done work.
// Typing and clicking go through the real UI (xterm, buttons); the app's store (imported through Vite,
// like e2e/full.spec.ts) only starts stages, skips dialogue, runs the clock and uses map hotspots.
import { expect, test, type Page } from '@playwright/test';

type GameStore = (typeof import('../src/store/game'))['gameStore'];
/** The page's window with the app's store on it (see exposeStore). */
type Win = Window & { __store: GameStore };

/**
 * Puts the app's own store instance on window.__store. A dev server that hot-updated the store
 * serves it to the app as "game.ts?t=…", so import the exact URL App.tsx uses, not a second copy.
 */
async function exposeStore(page: Page) {
  await page.evaluate(async () => {
    const app = await (await fetch('/src/App.tsx')).text();
    const url = /["'](\/src\/store\/game\.ts[^"']*)["']/.exec(app)?.[1] ?? '/src/store/game.ts';
    const S = (await import(/* @vite-ignore */ url)) as typeof import('../src/store/game');
    (window as unknown as Win).__store = S.gameStore;
  });
}

/** Starts a day and skips its briefing, like a player clicking through. */
async function play(page: Page, stage: number) {
  await page.evaluate((n) => {
    const store = (window as unknown as Win).__store;
    store.getState().play(n as 0);
    for (let i = 0; i < 50 && store.getState().dialogue; i++) store.getState().nextDialogue();
  }, stage);
}

/** Uses a map hotspot (desk, rack1, board…), as walking up to it and pressing Space does. */
const interact = (page: Page, spot: string) => page.evaluate((s) => (window as unknown as Win).__store.getState().interact(s as never), spot);

const title = (page: Page) => page.locator('.modal-head h2');

/** Visible terminal rows, with xterm's non-breaking spaces made plain. */
async function rows(page: Page): Promise<string[]> {
  const text = await page.locator('.xterm-rows').innerText();
  return text.replace(/\u00a0/g, ' ').split('\n').map((l) => l.trimEnd());
}

/** The row the cursor is on (the last non-empty one). */
async function inputRow(page: Page): Promise<string> {
  const all = (await rows(page)).filter((l) => l.trim());
  return all[all.length - 1] ?? '';
}

async function focusTerminal(page: Page) {
  await page.locator('.term-screen').click();
}

async function typeLine(page: Page, line: string) {
  await focusTerminal(page);
  await page.keyboard.type(line, { delay: 15 });
  await page.keyboard.press('Enter');
}

async function closeWindow(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
}

/** Errors from the page, minus the hint Worker that isn't running in tests. */
function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/api\/hint|Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  return problems;
}

/** Opens a place's terminal (a rack console) the way its map spot does. */
const openConsole = (page: Page, host: string) =>
  page.evaluate((h) => (window as unknown as Win).__store.getState().openModal({ type: 'terminal', host: h }), host);

test('창 상태 기억: 장소별 터미널 세션 (ssh, 스크롤, ↑ 기록, 쓰다 만 줄)', async ({ page }) => {
  const problems = watchProblems(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('khu-dc-save-v2', JSON.stringify({ unlocked: 5, seed: 1, best: {}, cards: [] })));
  await exposeStore(page);

  // ---- D-4: the 관리 PC desk terminal remembers the ssh ----
  await play(page, 1);
  await interact(page, 'desk');
  await expect(title(page)).toHaveText(/터미널 — ops/);
  await expect.poll(() => inputRow(page)).toContain('ops@khu-dc:~$');
  await typeLine(page, 'ssh web');
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toContain('web 에 접속했어요');
  await expect.poll(() => inputRow(page)).toContain('web@khu-dc:~$');
  await expect(title(page)).toHaveText(/터미널 — web/);
  // Half-typed line, left for later.
  await page.keyboard.type('hostna', { delay: 15 });
  await closeWindow(page);

  await interact(page, 'desk');
  // Same session: still on web, scrollback and the half-typed line are back.
  await expect(title(page)).toHaveText(/터미널 — web/);
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toContain('ops@khu-dc:~$ ssh web');
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$ hostna');
  await focusTerminal(page);
  await page.keyboard.type('me', { delay: 15 });
  await page.keyboard.press('Enter');
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toContain('web@khu-dc:~$ hostname');

  // ↑ walks back through this session's history.
  await focusTerminal(page);
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$ hostname');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$ ssh web');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$');

  // `hint` opens the radio on top of the terminal; closing it comes back to the same session (still on web).
  await typeLine(page, 'hint');
  await expect(title(page)).toHaveText(/쿠사수 무전기/);
  await page.keyboard.press('Escape');
  await expect(title(page)).toHaveText(/터미널 — web/);
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toContain('web@khu-dc:~$ hint');
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$');
  await closeWindow(page);

  // ---- The web rack console is a session of its own ----
  await openConsole(page, 'web');
  await expect(title(page)).toHaveText(/터미널 — web/);
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toContain('에 접속했어요.');
  const consoleText = (await rows(page)).join('\n');
  expect(consoleText).not.toContain('ssh web');
  await focusTerminal(page);
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$');
  await typeLine(page, 'hostname');
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toContain('web@khu-dc:~$ hostname');
  await closeWindow(page);

  // ---- A switch's console keeps its IOS mode while the window is closed ----
  await openConsole(page, 'TOR-01');
  await expect.poll(() => inputRow(page)).toBe('TOR-01>');
  await typeLine(page, 'enable');
  await expect.poll(() => inputRow(page)).toBe('TOR-01#');
  await closeWindow(page);
  await openConsole(page, 'TOR-01');
  await expect.poll(() => inputRow(page)).toBe('TOR-01#');
  await closeWindow(page);

  // Back at the desk: its own session is untouched by the consoles'.
  await interact(page, 'desk');
  await expect(title(page)).toHaveText(/터미널 — web/);
  const deskText = (await rows(page)).join('\n');
  expect(deskText).toContain('ops@khu-dc:~$ ssh web');
  expect(deskText).not.toContain('TOR-01');
  await closeWindow(page);

  // ---- Restarting the day starts every session over ----
  await play(page, 1);
  await interact(page, 'desk');
  await expect(title(page)).toHaveText(/터미널 — ops/);
  await expect.poll(() => inputRow(page)).toBe('ops@khu-dc:~$');
  expect((await rows(page)).join('\n')).not.toContain('ssh web');
  await focusTerminal(page);
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => inputRow(page)).toBe('ops@khu-dc:~$');
  expect(await page.evaluate(() => Object.keys((window as unknown as Win).__store.getState().terminals))).toEqual([]);
  await closeWindow(page);

  expect(problems).toEqual([]);
});

// v1 boards, mini-games and incidents (Dockerfile board, quiz, rack, decompose and desired-state boards,
// cable tester, CRAC repair, a late 사수 answer after a restart): each needs its day's content.
test.fixme('창 상태 기억: 설계 보드 (Dockerfile) — needs day content (WP5–7)', async () => {});
test.fixme('창 상태 기억: 퀴즈, 랙, 설계 보드, 무전기 질문 — needs day content (WP5–7)', async () => {});
test.fixme('창 상태 기억: 케이블 테스터, 다시 시작하면 지난 판의 늦은 결과는 버림 — needs day content (WP5–7)', async () => {});
