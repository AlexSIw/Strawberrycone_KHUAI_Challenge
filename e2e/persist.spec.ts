// Windows remember their state until the stage restarts: each place's terminal keeps its own session
// (host after ssh, scrollback, ↑ history, half-typed line), and boards keep half-done work.
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

/** Starts a stage and skips its intro, like a player clicking through. */
async function play(page: Page, stage: number) {
  await page.evaluate((n) => {
    const store = (window as unknown as Win).__store;
    store.getState().play(n as 0);
    for (let i = 0; i < 50 && store.getState().dialogue; i++) store.getState().nextDialogue();
  }, stage);
}

/** Concept cards pop up when an objective completes and take focus; click them away. */
async function dismissConcepts(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Win).__store;
    for (let i = 0; i < 20 && store.getState().concepts.length; i++) store.getState().dismissConcept();
  });
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

test('창 상태 기억: 장소별 터미널 세션, 설계 보드', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/api\/hint|Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('khu-dc-save-v1', JSON.stringify({ unlocked: 7, best: {}, cards: [] })));
  await exposeStore(page);

  // ---- Stage 3: the 관리 PC desk terminal remembers the ssh ----
  await play(page, 3);
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
  // Clear the line (Ctrl+U) and start the server without ssh-ing again.
  await focusTerminal(page);
  await page.keyboard.press('Control+U');
  await page.keyboard.press('Enter');
  await typeLine(page, 'server start');
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toContain('수강신청 서버 시작!');
  expect(await page.evaluate(() => !!(window as unknown as Win).__store.getState().run?.world.web?.running)).toBe(true);
  await dismissConcepts(page);

  // ↑ walks back through this session's history.
  await focusTerminal(page);
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$ server start');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$ ssh web');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$');

  // `hint` swaps in the radio; the session (still on web) is there when the desk terminal opens again.
  await typeLine(page, 'hint');
  await expect(title(page)).toHaveText(/쿠사수 무전기/);
  await closeWindow(page);
  await interact(page, 'desk');
  await expect(title(page)).toHaveText(/터미널 — web/);
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toContain('web@khu-dc:~$ hint');
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$');
  await closeWindow(page);

  // ---- The web rack console is a session of its own ----
  await interact(page, 'rack1');
  await page.getByRole('button', { name: 'web', exact: true }).click();
  await expect(title(page)).toHaveText(/터미널 — web/);
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toContain('에 접속했어요.');
  const consoleText = (await rows(page)).join('\n');
  expect(consoleText).not.toContain('ssh web');
  expect(consoleText).not.toContain('server start');
  await focusTerminal(page);
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$');
  await typeLine(page, 'hostname');
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toContain('web@khu-dc:~$ hostname');
  await closeWindow(page);

  // Back at the desk: its own session is untouched by the console's.
  await interact(page, 'desk');
  await expect(title(page)).toHaveText(/터미널 — web/);
  const deskText = (await rows(page)).join('\n');
  expect(deskText).toContain('ops@khu-dc:~$ ssh web');
  expect(deskText).not.toContain('web@khu-dc:~$ hostname');
  await closeWindow(page);

  // ---- Restarting the stage starts every session over ----
  await play(page, 3);
  await interact(page, 'desk');
  await expect(title(page)).toHaveText(/터미널 — ops/);
  await expect.poll(() => inputRow(page)).toBe('ops@khu-dc:~$');
  expect((await rows(page)).join('\n')).not.toContain('ssh web');
  await focusTerminal(page);
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => inputRow(page)).toBe('ops@khu-dc:~$');
  expect(await page.evaluate(() => Object.keys((window as unknown as Win).__store.getState().terminals))).toEqual([]);
  await closeWindow(page);

  // ---- Stage 5: the Dockerfile board keeps the line order ----
  await play(page, 5);
  // The board opens once the new server's failed deploy has been seen. The failed deploy comes with the
  // stage's first incident: run the game clock until it fires, then read it on srv-new's rack console.
  await page.evaluate(() => {
    const store = (window as unknown as Win).__store;
    const fired = () => store.getState().run?.scenarios.find((x) => x.id === 's5-drift')?.state !== 'waiting';
    for (let i = 0; i < 300 && !fired(); i++) store.getState().tick();
  });
  await dismissConcepts(page);
  await interact(page, 'rack2');
  await expect(title(page)).toHaveText(/터미널 — srv-new/);
  await typeLine(page, 'deploy log');
  await expect.poll(() => page.evaluate(() => 'log' in ((window as unknown as Win).__store.getState().run?.objectivesDone ?? {}))).toBe(true);
  await dismissConcepts(page);
  await closeWindow(page);

  const order = () => page.locator('.dfb-lines .dfb-code').allInnerTexts();
  await interact(page, 'board');
  await expect(page.locator('.dfb-lines .dfb-row')).toHaveCount(6);
  const shuffled = await order();
  await page.locator('.dfb-lines .dfb-row').first().getByRole('button', { name: /아래로/ }).click();
  const moved = await order();
  expect(moved).toEqual([shuffled[1], shuffled[0], ...shuffled.slice(2)]);
  await closeWindow(page);

  await interact(page, 'board');
  await expect(page.locator('.dfb-lines .dfb-row')).toHaveCount(6);
  expect(await order()).toEqual(moved);
  await closeWindow(page);

  // A restart shuffles a fresh card.
  await play(page, 5);
  expect(await page.evaluate(() => Object.keys((window as unknown as Win).__store.getState().windowState))).toEqual([]);

  expect(problems).toEqual([]);
});

test('창 상태 기억: 퀴즈, 랙, 설계 보드, 무전기 질문', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/api\/hint|Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('khu-dc-save-v1', JSON.stringify({ unlocked: 7, best: {}, cards: [] })));
  await exposeStore(page);

  /** Runs the game clock until `id` fires. */
  const fire = (id: string) =>
    page.evaluate((sid) => {
      const store = (window as unknown as Win).__store;
      const fired = () => store.getState().run?.scenarios.find((x) => x.id === sid)?.state !== 'waiting';
      for (let i = 0; i < 300 && !fired(); i++) {
        store.getState().tick();
        for (let j = 0; j < 20 && store.getState().concepts.length; j++) store.getState().dismissConcept();
      }
      return fired();
    }, id);

  // ---- Stage 0 quiz: a wrong guess stays crossed out (with the nudge) ----
  await play(page, 0);
  await interact(page, 'board');
  const answer = await page.evaluate(async () => {
    const C = (await import(/* @vite-ignore */ '/src/content/stages/index.ts' as string)) as typeof import('../src/content/stages');
    return C.getStage(0).quiz!.answer;
  });
  const wrongIdx = answer === 0 ? 1 : 0;
  await page.locator('.qz-choice').nth(wrongIdx).click();
  await expect(page.locator('.qz-choice.wrong')).toHaveCount(1);
  await closeWindow(page);
  await interact(page, 'board');
  await expect(page.locator('.qz-choice.wrong')).toHaveCount(1);
  await expect(page.locator('.qz-choice').nth(wrongIdx)).toBeDisabled();
  await expect(page.locator('.qz-mentor.is-warn')).toBeVisible();
  await closeWindow(page);

  // ---- Stage 1 rack: a server stays in the U it was put in ----
  await play(page, 1);
  const server = await page.evaluate(() => {
    const w = (window as unknown as Win).__store.getState().run!.world;
    const d = Object.values(w.devices).find((x) => x.kind === 'server' && x.rack && !x.installed)!;
    return { label: d.label, rack: d.rack! };
  });
  await interact(page, 'rack1');
  await page.locator('.rk-box-btn', { hasText: server.label }).click();
  // The top U (index 0) is never where a server lands by default.
  const slot = page.locator(`[data-drop="slot:${server.rack}:0"]`);
  await slot.click();
  await expect(slot).toContainText(server.label);
  await closeWindow(page);
  await interact(page, 'rack1');
  await expect(page.locator(`[data-drop="slot:${server.rack}:0"]`)).toContainText(server.label);
  await closeWindow(page);

  // ---- Stage 4 decompose board: placed cards stay in their shop ----
  await play(page, 4);
  await page.evaluate(() => {
    const store = (window as unknown as Win).__store;
    store.setState({ terminal: { host: 'ops', log: [] } });
    store.getState().command('svc list');
  });
  expect(await fire('s4-monolith')).toBe(true);
  await interact(page, 'board');
  const shop1 = page.getByRole('group', { name: '매장 1' });
  await page.locator('.dcb-pool .dcb-card', { hasText: '로그인' }).click();
  await shop1.click();
  await expect(shop1.locator('.dcb-card', { hasText: '로그인' })).toBeVisible();
  await closeWindow(page);
  await interact(page, 'board');
  await expect(page.getByRole('group', { name: '매장 1' }).locator('.dcb-card', { hasText: '로그인' })).toBeVisible();
  await closeWindow(page);

  // ---- Stage 6 desired-state card: the count and version being filled in stay ----
  await play(page, 6);
  await interact(page, 'board');
  await page.getByRole('button', { name: '하나 늘리기' }).click();
  await page.getByRole('button', { name: '하나 늘리기' }).click();
  await page.getByLabel('이미지 버전').selectOption('enroll:v1');
  await expect(page.locator('.dsb-num')).toHaveText('3');
  await closeWindow(page);
  await interact(page, 'board');
  await expect(page.locator('.dsb-num')).toHaveText('3');
  await expect(page.getByLabel('이미지 버전')).toHaveValue('enroll:v1');
  await closeWindow(page);

  // ---- Hint radio: an unsent question stays in the box ----
  await play(page, 5);
  expect(await fire('s5-drift')).toBe(true);
  await interact(page, 'mentor');
  await page.getByLabel('쿠사수에게 질문').fill('도커가 뭐예요');
  await closeWindow(page);
  await interact(page, 'mentor');
  await expect(page.getByLabel('쿠사수에게 질문')).toHaveValue('도커가 뭐예요');
  await closeWindow(page);

  expect(problems).toEqual([]);
});

test('창 상태 기억: 케이블 테스터, 항온항습기 수리, 다시 시작하면 지난 판의 늦은 결과는 버림', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/api\/hint|Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  // A slow 사수 answer, so the stage can restart while one is on its way.
  await page.route('**/api/hint', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ status: 503, body: '' });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('khu-dc-save-v1', JSON.stringify({ unlocked: 7, best: {}, cards: [] })));
  await exposeStore(page);

  /** Runs the game clock until `id` fires, clicking concept cards away. */
  const fire = (id: string) =>
    page.evaluate((sid) => {
      const store = (window as unknown as Win).__store;
      const fired = () => store.getState().run?.scenarios.find((x) => x.id === sid)?.state !== 'waiting';
      for (let i = 0; i < 300 && !fired(); i++) {
        store.getState().tick();
        for (let j = 0; j < 20 && store.getState().concepts.length; j++) store.getState().dismissConcept();
      }
      return fired();
    }, id);
  const n3 = () => page.locator('.cb-row', { hasText: '노드 n3' });

  // ---- Stage 7 cable tester: a reading stays; a replacement cut short by closing still counts ----
  await play(page, 7);
  expect(await fire('s7-cable')).toBe(true);
  await interact(page, 'switch');
  await n3().getByRole('button', { name: /테스트/ }).click();
  await expect(n3().locator('.cb-result.bad')).toBeVisible();
  await closeWindow(page);
  await interact(page, 'switch');
  await expect(n3().locator('.cb-result.bad')).toBeVisible();
  await n3().getByRole('button', { name: /교체/ }).click();
  await closeWindow(page);
  expect(await page.evaluate(() => (window as unknown as Win).__store.getState().run!.world.cables.c_n3.broken)).toBe(false);
  await dismissConcepts(page);
  await interact(page, 'switch');
  await expect(n3().locator('.cb-result')).toHaveCount(0);
  await expect(page.locator('.mg-task')).toContainText('완료');
  await closeWindow(page);

  // ---- CRAC repair: the steps done so far stay done ----
  expect(await fire('s7-cooling')).toBe(true);
  await interact(page, 'crac');
  await page.getByRole('button', { name: /전원 레버: 켜짐/ }).click();
  await page.getByRole('button', { name: '막힌 필터 빼기' }).click();
  await closeWindow(page);
  await interact(page, 'crac');
  await expect(page.getByRole('button', { name: /전원 레버: 차단됨/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '막힌 필터 빼기' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '새 필터 끼우기' })).toBeVisible();
  await closeWindow(page);

  // ---- Restart while the 사수's answer is on its way: it must not land in the new run ----
  await interact(page, 'mentor');
  await page.getByRole('button', { name: /힌트 받기/ }).click();
  expect(await page.evaluate(() => (window as unknown as Win).__store.getState().hintPending)).toBe(true);
  await play(page, 7);
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => (window as unknown as Win).__store.getState().hints)).toEqual({});
  expect(await page.evaluate(() => (window as unknown as Win).__store.getState().hintPending)).toBe(false);

  // ---- …nor a window that the restart closed (a cable replacement still animating) ----
  expect(await fire('s7-cable')).toBe(true);
  await interact(page, 'switch');
  await n3().getByRole('button', { name: /교체/ }).click();
  await play(page, 7);
  await page.waitForTimeout(300);
  const fresh = await page.evaluate(() => {
    const s = (window as unknown as Win).__store.getState();
    return { windowState: s.windowState, cableEvents: s.run!.ctx.events.filter((e) => e.startsWith('cable')) };
  });
  expect(fresh).toEqual({ windowState: {}, cableEvents: [] });

  expect(problems).toEqual([]);
});
