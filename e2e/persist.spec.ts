// Windows remember their state until the day restarts: each place's terminal keeps its own session
// (host after ssh, IOS mode, scrollback, ↑ history, half-typed line), and boards keep half-done work.
// Typing and clicking go through the real UI (xterm, buttons); the app's store (imported through Vite,
// like e2e/ui.spec.ts) only starts days, skips dialogue, runs the clock, does the missions a test isn't about
// and uses map hotspots.
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

/** Starts a day and skips its briefing (and the first missions' 미션 브리핑), like a player clicking through. */
async function play(page: Page, day: number) {
  await page.evaluate((n) => {
    const store = (window as unknown as Win).__store;
    store.getState().play(n as 0);
    for (let i = 0; i < 50 && store.getState().dialogue; i++) store.getState().nextDialogue();
    for (let i = 0; i < 20 && store.getState().concepts.length; i++) store.getState().dismissConcept();
  }, day);
}

/** A finished mission pops up its concept card, which takes the focus and stops the clock: click it away. */
async function dismissConcepts(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Win).__store;
    for (let i = 0; i < 20 && store.getState().concepts.length; i++) store.getState().dismissConcept();
  });
}

/** Runs the game clock (clicking concept cards away) until some incident is active. Returns its id. */
const fire = (page: Page) =>
  page.evaluate(() => {
    const store = (window as unknown as Win).__store;
    const active = () => store.getState().run?.scenarios.find((x) => x.state === 'active')?.id ?? null;
    for (let i = 0; i < 300 && !active(); i++) {
      for (let j = 0; j < 20 && store.getState().concepts.length; j++) store.getState().dismissConcept();
      store.getState().tick();
    }
    return active();
  });

/**
 * D-5's missions up to the port LEDs (tour, quiz, rack, PDU A/B, cables), as tests/autoplay.ts does them:
 * after that the day's damaged-cable incident is on its way.
 */
const buildD5 = (page: Page) =>
  page.evaluate(async () => {
    const A = (await import(/* @vite-ignore */ '/src/sim/actions.ts' as string)) as typeof import('../src/sim/actions');
    const T = (await import(/* @vite-ignore */ '/src/content/topology.ts' as string)) as typeof import('../src/content/topology');
    const s = () => (window as unknown as Win).__store.getState();
    const ids = ['web', 'web2', 'db'];
    s().event('room:server', 'room:network', 'room:power', 'room:cooling', 'room:noc');
    s().event('quiz:correct');
    s().act((w) => ids.forEach((id) => A.mount(w, id)), 'rack:mount');
    s().act((w) => ids.forEach((id) => A.setFeeds(w, id, ['A', 'B'])));
    s().act((w) => ids.forEach((id) => A.connectCable(w, `${id}:eth0`, `TOR-01:${T.SERVERS[id][5]}`)), 'cable:connect');
    s().event('noc:device:TOR-01');
    for (let i = 0; i < 20 && s().concepts.length; i++) s().dismissConcept();
    return ids.every((id) => s().run!.world.devices[id].installed);
  });

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

  // ---- D-3: the 관리 PC desk terminal remembers the ssh (WEB-01 is in the DNS since D-4) ----
  await play(page, 2);
  await interact(page, 'desk');
  await expect(title(page)).toHaveText(/터미널 — ops/);
  await expect.poll(() => inputRow(page)).toContain('ops@khu-dc:~$');
  await typeLine(page, 'ssh web');
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toContain('WEB-01 에 접속했어요');
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
  await play(page, 2);
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

test('창 상태 기억: 설계 보드 (Dockerfile)', async ({ page }) => {
  const problems = watchProblems(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('khu-dc-save-v2', JSON.stringify({ unlocked: 5, seed: 1, best: {}, cards: [] })));
  await exposeStore(page);

  // ---- D-2: the recipe card opens once APP-01's failed install has been read ----
  await play(page, 3);
  await openConsole(page, 'srv-new');
  await expect(title(page)).toHaveText(/터미널 — srv-new/);
  await typeLine(page, 'deploy log');
  await expect.poll(() => page.evaluate(() => 'log' in ((window as unknown as Win).__store.getState().run?.objectivesDone ?? {}))).toBe(true);
  await dismissConcepts(page);
  await closeWindow(page);

  // The line order being worked on stays while the board is closed.
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
  await play(page, 3);
  expect(await page.evaluate(() => Object.keys((window as unknown as Win).__store.getState().windowState))).toEqual([]);

  expect(problems).toEqual([]);
});

test('창 상태 기억: 퀴즈, 랙, 설계 보드, 무전기 질문', async ({ page }) => {
  const problems = watchProblems(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('khu-dc-save-v2', JSON.stringify({ unlocked: 5, seed: 1, best: {}, cards: [] })));
  await exposeStore(page);

  // ---- D-5 quiz: a wrong answer stays marked with its explanation; a fresh attempt keeps its choice order ----
  await play(page, 0);
  await interact(page, 'board');
  const right = await page.evaluate(async () => {
    const C = (await import(/* @vite-ignore */ '/src/content/stages/index.ts' as string)) as typeof import('../src/content/stages');
    const q = Number(document.querySelector('.qz-q')!.getAttribute('data-q'));
    return C.getStage(0).quiz!.pool[q].answer;
  });
  const shown = () => page.locator('.qz-choice').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-choice'))));
  const wrongIdx = (await shown()).find((c) => c !== right)!;
  await page.locator(`.qz-choice[data-choice="${wrongIdx}"]`).click();
  await expect(page.locator('.qz-choice.wrong')).toHaveCount(1);
  await closeWindow(page);
  await interact(page, 'board');
  await expect(page.locator(`.qz-choice[data-choice="${wrongIdx}"]`)).toHaveClass(/wrong/);
  await expect(page.locator('.qz-mentor.is-warn')).toBeVisible();
  await page.getByRole('button', { name: '처음부터 다시 ▶' }).click();
  const order = await shown();
  await closeWindow(page);
  await interact(page, 'board');
  expect(await shown()).toEqual(order);
  await expect(page.locator('.qz-mentor')).toHaveCount(0);
  await closeWindow(page);

  // ---- D-5 rack: a server stays in the U it was put in ----
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

  // ---- D-3 decompose board: placed cards stay in their shop ----
  await play(page, 2);
  await interact(page, 'board');
  const shop1 = page.getByRole('group', { name: '매장 1' });
  await page.locator('.dcb-pool .dcb-card', { hasText: '로그인' }).click();
  await shop1.click();
  await expect(shop1.locator('.dcb-card', { hasText: '로그인' })).toBeVisible();
  await closeWindow(page);
  await interact(page, 'board');
  await expect(page.getByRole('group', { name: '매장 1' }).locator('.dcb-card', { hasText: '로그인' })).toBeVisible();
  await closeWindow(page);

  // ---- D-1 desired-state card: the count and version being filled in stay ----
  await play(page, 4);
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

  // ---- Hint radio: an unsent question stays in the box (D-Day's first incident comes on the clock) ----
  await play(page, 5);
  expect(await fire(page)).not.toBeNull();
  await interact(page, 'mentor');
  await page.getByLabel('쿠사수에게 질문').fill('L4가 뭐예요');
  await closeWindow(page);
  await interact(page, 'mentor');
  await expect(page.getByLabel('쿠사수에게 질문')).toHaveValue('L4가 뭐예요');
  await closeWindow(page);

  expect(problems).toEqual([]);
});

test('창 상태 기억: 케이블 테스터, 다시 시작하면 지난 판의 늦은 결과는 버림', async ({ page }) => {
  const problems = watchProblems(page);
  // A slow 사수 answer, so the day can restart while one is on its way.
  await page.route('**/api/hint', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ status: 503, body: '' });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('khu-dc-save-v2', JSON.stringify({ unlocked: 5, seed: 1, best: {}, cards: [] })));
  await exposeStore(page);

  /** The server whose cable the D-5 incident damaged. */
  const damaged = () =>
    page.evaluate(() => {
      const w = (window as unknown as Win).__store.getState().run!.world;
      const c = Object.values(w.cables).find((x) => x.degraded)!;
      const id = [c.a, c.b].map((ep) => ep.split(':')[0]).find((d) => w.devices[d]?.kind === 'server')!;
      return { label: w.devices[id].label, cable: c.id };
    });
  const cableOf = (id: string) =>
    page.evaluate((cid) => {
      const c = (window as unknown as Win).__store.getState().run!.world.cables[cid];
      return { broken: !!c?.broken, degraded: !!c?.degraded };
    }, id);

  // ---- D-5 cable tester: a reading stays; a replacement cut short by closing still counts ----
  await play(page, 0);
  expect(await buildD5(page)).toBe(true);
  expect(await fire(page)).not.toBeNull();
  const bad = await damaged();
  const row = () => page.locator('.cb-row', { hasText: bad.label });
  await interact(page, 'switch');
  await row().getByRole('button', { name: /테스트/ }).click();
  await expect(row().locator('.cb-result.warn')).toContainText('에러가 섞여요');
  await closeWindow(page);
  await interact(page, 'switch');
  await expect(row().locator('.cb-result.warn')).toBeVisible();
  await row().getByRole('button', { name: /교체/ }).click();
  await closeWindow(page);
  expect(await cableOf(bad.cable)).toEqual({ broken: false, degraded: false });
  await dismissConcepts(page);
  await interact(page, 'switch');
  await expect(row().locator('.cb-result')).toHaveCount(0);
  await expect(page.locator('.mg-task')).toContainText('완료');
  await closeWindow(page);

  // ---- Restart while the 사수's answer is on its way: it must not land in the new run ----
  await play(page, 0);
  expect(await buildD5(page)).toBe(true);
  expect(await fire(page)).not.toBeNull();
  await interact(page, 'mentor');
  await page.getByRole('button', { name: /힌트 받기/ }).click();
  expect(await page.evaluate(() => (window as unknown as Win).__store.getState().hintPending)).toBe(true);
  await play(page, 0);
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => (window as unknown as Win).__store.getState().hints)).toEqual({});
  expect(await page.evaluate(() => (window as unknown as Win).__store.getState().hintPending)).toBe(false);

  // ---- …nor a window that the restart closed (a cable replacement still animating) ----
  expect(await buildD5(page)).toBe(true);
  expect(await fire(page)).not.toBeNull();
  const again = await damaged();
  await interact(page, 'switch');
  await page.locator('.cb-row', { hasText: again.label }).getByRole('button', { name: /교체/ }).click();
  await play(page, 0);
  await page.waitForTimeout(300);
  const fresh = await page.evaluate(() => {
    const s = (window as unknown as Win).__store.getState();
    return { windowState: s.windowState, cableEvents: s.run!.ctx.events.filter((e) => e.startsWith('cable')) };
  });
  expect(fresh).toEqual({ windowState: {}, cableEvents: [] });

  expect(problems).toEqual([]);
});
