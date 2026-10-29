// UI behaviour around windows, the terminal and the HUD:
//  - the terminal's side box shows the missions while nothing is broken, and the incident when something is;
//  - a window opened from another one (the radio over the terminal) goes back to it on close (Esc, ✕,
//    backdrop), with the terminal session as it was;
//  - IOS sessions: ssh into gear shows its prompt, `?` is answered on the keystroke, Ctrl+Z, exit, and a
//    switch's own console stays on the switch;
//  - the lion walks at one speed, and Space dashes a short way forward;
//  - the quiz: a wrong answer shows ✕ and the explanation, then starts over; once every answer is right it
//    stays so while the concept book or the radio is opened on top of it;
//  - the HUD fits narrow screens.
// Typing and clicking go through the real UI; the app's store (imported through Vite, like e2e/persist.spec.ts)
// only starts days, skips dialogue, runs the clock, clicks concept cards away and uses map hotspots.
import { expect, test, type Page } from '@playwright/test';
import { PLAYER_SPAWN_PX, TILE } from '../src/game/map';

type GameStore = (typeof import('../src/store/game'))['gameStore'];
/** The page's window with the app's store on it (see exposeStore). */
type Win = Window & { __store: GameStore };
/** The DataCenter scene's lion, as far as these tests look at it (it is a private field of the scene). */
type Lion = { x: number; y: number; anims: { timeScale: number }; body: { reset(x: number, y: number): void } };
type FrameFn = (t: number, dt: number) => void;
type Scene = { player?: Lion; sys: { isActive(): boolean }; events: { on(e: 'update', f: FrameFn): void; off(e: 'update', f: FrameFn): void } };
type GameWin = Window & { __khuGame?: { scene: { getScene(key: string): Scene | null } } };

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

/** Runs the game clock (clicking concept cards away) until some incident is active, or none is. Returns whether one is. */
const runUntilIncident = (page: Page, want: boolean) =>
  page.evaluate((active) => {
    const store = (window as unknown as Win).__store;
    const now = () => !!store.getState().run?.scenarios.some((x) => x.state === 'active');
    for (let i = 0; i < 300 && now() !== active; i++) {
      for (let j = 0; j < 20 && store.getState().concepts.length; j++) store.getState().dismissConcept();
      store.getState().tick();
    }
    return now();
  }, want);

/** Uses a map hotspot (desk, rack1, board…), as walking up to it and pressing E does. */
const interact = (page: Page, spot: string) => page.evaluate((s) => (window as unknown as Win).__store.getState().interact(s as never), spot);

const title = (page: Page) => page.locator('.modal-head h2');
const sideBox = (page: Page, name: '지금 목표' | '지금 장애') => page.locator('.term-side').getByRole('region', { name });

/** Visible terminal rows, with xterm's non-breaking spaces made plain. */
async function rows(page: Page): Promise<string[]> {
  const text = await page.locator('.xterm-rows').innerText();
  return text.replace(/ /g, ' ').split('\n').map((l) => l.trimEnd());
}

/** The row the cursor is on (the last non-empty one). */
async function inputRow(page: Page): Promise<string> {
  const all = (await rows(page)).filter((l) => l.trim());
  return all[all.length - 1] ?? '';
}

async function typeLine(page: Page, line: string) {
  await page.locator('.term-screen').click();
  await page.keyboard.type(line, { delay: 15 });
  await page.keyboard.press('Enter');
}

/** Types a line, waits for its output (the store has run it by then), then clicks away a mission's card. */
async function run(page: Page, line: string) {
  const count = () => page.evaluate(() => (window as unknown as Win).__store.getState().terminal.history?.length ?? 0);
  const before = await count();
  await typeLine(page, line);
  await expect.poll(count).toBeGreaterThan(before);
  await dismissConcepts(page);
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

async function start(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('khu-dc-save-v2', JSON.stringify({ unlocked: 5, seed: 1, best: {}, cards: [] })));
  await exposeStore(page);
}

async function focusTerminal(page: Page) {
  await page.locator('.term-screen').click();
}

test('터미널 옆 상자: 조용할 땐 지금 목표, 장애가 나면 지금 장애', async ({ page }) => {
  const problems = watchProblems(page);
  await start(page);
  // D-3: open the enrollment site; once students get through, the L4 health-check incident fires.
  await play(page, 2);
  await interact(page, 'desk');
  await expect(title(page)).toHaveText(/터미널 — ops/);

  // Calm: the box lists the open mission (the mission panel is behind this window).
  await expect(sideBox(page, '지금 목표')).toContainText('web 서버에 원격 접속해 수강신청 앱 실행하기');
  await expect(sideBox(page, '지금 장애')).toHaveCount(0);

  await run(page, 'ssh web');
  await expect.poll(() => inputRow(page)).toContain('web@khu-dc:~$');
  await run(page, 'server start');
  // The next mission takes its place.
  await expect(sideBox(page, '지금 목표')).toContainText('80번 포트');
  await run(page, 'server set port 80');
  await run(page, 'exit');
  await run(page, 'ssh L4-01');
  await run(page, 'lb pool add web 80');
  await run(page, 'lb health set path /health');
  await run(page, 'exit');
  await run(page, 'curl http://sugang/enroll');
  await expect(sideBox(page, '지금 목표')).toContainText('SMS');

  // The incident fires: the box switches to it, with the 쿠사수 button.
  expect(await runUntilIncident(page, true)).toBe(true);
  await expect(sideBox(page, '지금 장애')).toContainText('수강신청 사이트 접속 불가');
  await expect(sideBox(page, '지금 장애').getByRole('button', { name: '쿠사수 힌트' })).toBeVisible();
  await expect(sideBox(page, '지금 목표')).toHaveCount(0);

  // `hint` answers in the terminal (no window opens), about that incident, with the fix's values blank.
  await run(page, 'hint');
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__store.getState().hintPending)).toBe(false);
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toContain('쿠사수> 상황: 수강신청 사이트 접속 불가');
  const log = await page.evaluate(() => (window as unknown as Win).__store.getState().terminal.log.join('\n'));
  expect(log).toContain('lb health set');
  // No Worker in the tests: 쿠사수 says the answer is the game's own.
  expect(log).toContain('ChatKHU API랑 연결이 안 돼 있어서 기본 힌트만 제공드려요.');
  await expect(title(page)).toHaveText(/터미널 — ops/);
  await expect.poll(() => inputRow(page)).toBe('ops@khu-dc:~$');
  // The radio has the same answer as a 상황·할 일·명령 card, and 정답 보기 is there without any hint ladder.
  await sideBox(page, '지금 장애').getByRole('button', { name: '쿠사수 힌트' }).click();
  await expect(title(page)).toHaveText(/쿠사수 무전기/);
  await expect(page.locator('.hc-guide dt').first()).toHaveText('상황');
  await expect(page.locator('.hc-guide dt')).toHaveText(['상황', '할 일', '명령']);
  await expect(page.locator('.hc-notice').first()).toHaveText('ChatKHU API랑 연결이 안 돼 있어서 기본 힌트만 제공드려요.');
  await page.getByRole('button', { name: '정답 보기' }).click();
  await expect(page.getByRole('alertdialog', { name: '정답 보기 확인' })).toContainText('15점');
  await page.getByRole('button', { name: '아니요' }).click();
  await page.keyboard.press('Escape');
  await expect(title(page)).toHaveText(/터미널 — ops/);

  // Fixed (the check's path and port both put right): back to the missions.
  await run(page, 'ssh L4-01');
  await run(page, 'lb health set path /health');
  await run(page, 'lb health set port 80');
  expect(await runUntilIncident(page, false)).toBe(false);
  await dismissConcepts(page);
  await expect(sideBox(page, '지금 목표')).toContainText('SMS');
  await expect(sideBox(page, '지금 장애')).toHaveCount(0);
  await expect(title(page)).toHaveText(/터미널 — L4-01/);

  expect(problems).toEqual([]);
});

test('창 위에 연 창은 닫으면 원래 창으로: 터미널 세션 그대로', async ({ page }) => {
  const problems = watchProblems(page);
  await start(page);
  // D-3: the 관리 PC reaches WEB-01 by name (D-4 put it in the DNS).
  await play(page, 2);
  await interact(page, 'desk');
  await expect(title(page)).toHaveText(/터미널 — ops/);
  await typeLine(page, 'ssh web');
  await expect.poll(() => inputRow(page)).toContain('web@khu-dc:~$');

  // A half-typed line, then the radio over the terminal (as the H key or an alarm's 쿠사수 button opens it).
  await page.locator('.term-screen').click();
  await page.keyboard.type('hostna', { delay: 15 });
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$ hostna');
  await page.evaluate(() => (window as unknown as Win).__store.getState().openModal({ type: 'hint' }));
  await expect(title(page)).toHaveText(/쿠사수 무전기/);

  // Esc: back to the same terminal session (host, scrollback, half-typed line).
  await page.keyboard.press('Escape');
  await expect(title(page)).toHaveText(/터미널 — web/);
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toContain('ops@khu-dc:~$ ssh web');
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$ hostna');
  // The cursor is back in the terminal: typing goes on where it stopped.
  await page.keyboard.type('me', { delay: 15 });
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$ hostname');

  // ✕ and the backdrop also go back to the terminal.
  await page.evaluate(() => (window as unknown as Win).__store.getState().openModal({ type: 'hint' }));
  await expect(title(page)).toHaveText(/쿠사수 무전기/);
  await page.locator('.modal-head').getByRole('button', { name: /닫기/ }).click();
  await expect(title(page)).toHaveText(/터미널 — web/);
  await page.evaluate(() => (window as unknown as Win).__store.getState().openModal({ type: 'hint' }));
  await expect(title(page)).toHaveText(/쿠사수 무전기/);
  await page.locator('.modal-backdrop').click({ position: { x: 8, y: 8 } });
  await expect(title(page)).toHaveText(/터미널 — web/);
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$ hostname');

  // The `hint` command answers in the terminal itself: no window on top, the prompt back as it was. With ChatKHU
  // answering (here a stand-in for the Worker), there is no notice line.
  await page.route('**/api/hint', (route) =>
    route.fulfill({ json: { reply: '상황: 신청 앱을 띄우는 중이야.\n할 일: 앱 켜기\n명령: server start', kind: 'guide', concept: '' } }),
  );
  await focusTerminal(page);
  await page.keyboard.press('Control+U');
  await typeLine(page, 'hint');
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toContain('web@khu-dc:~$ hint');
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__store.getState().hintPending)).toBe(false);
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toContain('쿠사수> 상황: 신청 앱을 띄우는 중이야.');
  expect((await rows(page)).join('\n')).not.toContain('ChatKHU');
  await page.unroute('**/api/hint');
  await expect(title(page)).toHaveText(/터미널 — web/);
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$');

  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);

  // Restarting the day closes every window, stacked ones included.
  await interact(page, 'desk');
  await page.evaluate(() => (window as unknown as Win).__store.getState().openModal({ type: 'hint' }));
  await expect(title(page)).toHaveText(/쿠사수 무전기/);
  await play(page, 2);
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Win).__store.getState().modalStack)).toEqual([]);

  expect(problems).toEqual([]);
});

test('Esc는 맨 위 창만 닫음: 창 위에 뜬 나가기 확인창을 닫아도 아래 창은 그대로', async ({ page }) => {
  const problems = watchProblems(page);
  await start(page);
  await play(page, 2);
  await page.evaluate(() => (window as unknown as Win).__store.getState().openModal({ type: 'noc', tab: 'nms' }));
  await expect(title(page)).toHaveText(/관제 화면/);

  // The HUD's exit confirm over the NOC, then Esc: only the confirm goes away.
  await page.getByRole('button', { name: '나가기' }).click();
  await expect(title(page).filter({ hasText: '나갈까요' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(title(page).filter({ hasText: '나갈까요' })).toHaveCount(0);
  await expect(title(page)).toHaveText(/관제 화면/);

  // A second Esc closes the NOC itself.
  await page.keyboard.press('Escape');
  await expect(title(page)).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('IOS 터미널: ssh로 장비 프롬프트, ?는 바로 도움말, Ctrl+Z, exit로 관리 PC', async ({ page }) => {
  const problems = watchProblems(page);
  await start(page);
  await play(page, 1);
  await interact(page, 'desk');
  await typeLine(page, 'ssh TOR-01');
  await expect.poll(() => inputRow(page)).toBe('TOR-01>');
  // That was D-4's first mission: its card pops up.
  await dismissConcepts(page);
  // The side panel is the IOS cheat sheet now.
  await expect(page.locator('.term-help h3')).toHaveText('장비 명령 (IOS)');

  await typeLine(page, 'enable');
  await expect.poll(() => inputRow(page)).toBe('TOR-01#');
  // `?` is answered on the keystroke: it never goes into the line, and the line comes back as it was.
  await page.keyboard.type('sh', { delay: 15 });
  await page.keyboard.press('?');
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toMatch(/TOR-01# ?sh\?/);
  await expect.poll(() => inputRow(page)).toMatch(/^TOR-01# ?sh$/);
  // Ctrl+Z outside config mode does nothing, as on a real switch.
  await page.keyboard.press('Control+U');
  await page.keyboard.press('Control+Z');
  await expect.poll(() => inputRow(page)).toBe('TOR-01#');

  // exit leaves the switch: back on the 관리 PC's shell, with its own command list.
  await typeLine(page, 'exit');
  await expect.poll(() => inputRow(page)).toBe('ops@khu-dc:~$');
  await expect(page.locator('.term-help h3')).toHaveText('명령어 도움말');
  expect(await page.evaluate(() => (window as unknown as Win).__store.getState().terminal.mode ?? null)).toBeNull();

  // A switch's own console place starts at its `>` prompt, and exit there keeps the console on the switch.
  await page.keyboard.press('Escape');
  // A card earned while typing (ssh → 'oob') waits until the terminal closes, then shows up: take it.
  await dismissConcepts(page);
  await page.evaluate(() => (window as unknown as Win).__store.getState().openModal({ type: 'terminal', host: 'TOR-01' }));
  await expect(title(page)).toHaveText(/터미널 — TOR-01/);
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toContain('콘솔에 연결했어요');
  await expect.poll(() => inputRow(page)).toBe('TOR-01>');
  await typeLine(page, 'exit');
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toContain('Press RETURN to get started.');
  await expect.poll(() => inputRow(page)).toBe('TOR-01>');

  expect(problems).toEqual([]);
});

/** The lion, once the day's Phaser scene is up. */
async function waitForLion(page: Page) {
  await expect
    .poll(() => page.evaluate(() => !!(window as GameWin).__khuGame?.scene.getScene('DataCenter')?.player), { timeout: 20_000 })
    .toBe(true);
}

/**
 * Walking speed in px per game second: from the spawn point, hold → and, after a short run-up, measure the
 * distance covered against the frame times the scene itself was given. The scene's own clock keeps the number
 * right on a busy machine, where frames come late and the game falls behind the wall clock.
 */
async function walkSpeed(page: Page): Promise<{ speed: number; timeScale: number }> {
  await page.evaluate((spawn) => {
    const lion = (window as GameWin).__khuGame!.scene.getScene('DataCenter')!.player!;
    // The spawn tile (19, 13): corridor, with open floor to the right.
    lion.body.reset(spawn.x, spawn.y);
  }, PLAYER_SPAWN_PX);
  await page.keyboard.down('ArrowRight');
  try {
    await page.waitForTimeout(200);
    await startClock(page);
    await page.waitForTimeout(400);
    return await readClock(page);
  } finally {
    await page.keyboard.up('ArrowRight');
  }
}

type ClockWin = GameWin & { __walk?: { x0: number; ms: number; tick: FrameFn } };

/** Starts summing the scene's frame times, from where the lion is now. */
const startClock = (page: Page) =>
  page.evaluate(() => {
    const w = window as ClockWin;
    const scene = w.__khuGame!.scene.getScene('DataCenter')!;
    if (w.__walk) scene.events.off('update', w.__walk.tick);
    const walk = { x0: scene.player!.x, ms: 0, tick: (_t: number, dt: number) => void (walk.ms += dt) };
    scene.events.on('update', walk.tick);
    w.__walk = walk;
  });

/** px per game second since startClock, and the walk cycle's speed. */
const readClock = (page: Page) =>
  page.evaluate(() => {
    const w = window as ClockWin;
    const scene = w.__khuGame!.scene.getScene('DataCenter')!;
    const walk = w.__walk!;
    scene.events.off('update', walk.tick);
    const lion = scene.player!;
    return { speed: (lion.x - walk.x0) / (walk.ms / 1000), timeScale: lion.anims.timeScale };
  });

test('걷기 속도: 한 가지 속도, 걷기 동작은 기본 속도로', async ({ page }) => {
  const problems = watchProblems(page);
  await start(page);
  await play(page, 3);
  await waitForLion(page);
  // No speed button any more.
  await expect(page.getByRole('button', { name: /이동 속도/ })).toHaveCount(0);

  const walk = await walkSpeed(page);
  expect(walk.speed).toBeGreaterThan(200);
  expect(walk.speed).toBeLessThan(360);
  expect(walk.timeScale).toBe(1);

  expect(problems).toEqual([]);
});

type DashScene = {
  player: Lion;
  facing: string;
  modal?: unknown;
  ghosts: { getChildren(): { visible: boolean }[] };
};
const dashScene = (page: Page) =>
  page.evaluate(() => {
    const sc = (window as GameWin).__khuGame!.scene.getScene('DataCenter') as unknown as DashScene;
    return { x: sc.player.x, y: sc.player.y, ghosts: sc.ghosts.getChildren().filter((g) => g.visible).length };
  });

test('Space 대시: 앞으로 2칸 도약, 잔상, 0.5초 쿨다운, Space로는 상호작용 안 함', async ({ page }) => {
  const problems = watchProblems(page);
  await start(page);
  await play(page, 3);
  await waitForLion(page);
  // Standing still in the corridor, facing right: a dash goes the way the lion faces.
  await page.evaluate((spawn) => {
    const sc = (window as GameWin).__khuGame!.scene.getScene('DataCenter') as unknown as DashScene;
    sc.player.body.reset(spawn.x, spawn.y);
    sc.facing = 'right';
  }, PLAYER_SPAWN_PX);
  await page.waitForTimeout(300);
  const a = await dashScene(page);
  await page.keyboard.press('Space');
  // afterimages while it leaps
  await expect.poll(async () => (await dashScene(page)).ghosts).toBeGreaterThan(0);
  await page.waitForTimeout(250);
  const b = await dashScene(page);
  expect(b.x - a.x).toBeGreaterThan(1.6 * TILE);
  expect(b.x - a.x).toBeLessThan(2.4 * TILE);
  expect(b.y).toBeCloseTo(a.y, 0);

  // Still cooling down: a second press does nothing.
  await page.keyboard.press('Space');
  await page.waitForTimeout(250);
  const c = await dashScene(page);
  expect(Math.abs(c.x - b.x)).toBeLessThan(4);
  // The afterimages have faded.
  expect(c.ghosts).toBe(0);

  // Once cooled down it dashes again.
  await page.waitForTimeout(400);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  expect((await dashScene(page)).x - c.x).toBeGreaterThan(1.6 * TILE);

  // Next to the 관리 PC desk: Space doesn't open it, E does.
  const nearDesk = async () => {
    await page.evaluate((t) => {
      const sc = (window as GameWin).__khuGame!.scene.getScene('DataCenter') as unknown as DashScene;
      sc.player.body.reset(26 * t, 19.4 * t);
      sc.facing = 'down';
    }, TILE);
    await page.waitForTimeout(700);
  };
  await nearDesk();
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as Win).__store.getState().modal)).toBeNull();
  await nearDesk();
  await page.keyboard.press('e');
  await expect(title(page)).toHaveText(/터미널/);

  expect(problems).toEqual([]);
});

/** The right choice (its authored index) of the quiz question on the board now. */
const rightChoice = (page: Page) =>
  page.evaluate(async () => {
    const url = '/src/content/stages/index.ts';
    const days = (await import(/* @vite-ignore */ url)) as typeof import('../src/content/stages');
    const run = (window as unknown as Win).__store.getState().run!;
    const q = Number(document.querySelector('.qz-q')!.getAttribute('data-q'));
    return days.getStage(run.stage).quiz!.pool[q].answer;
  });

/** The choices on the board, by authored index, in the order they are shown. */
const shownChoices = (page: Page) => page.locator('.qz-choice').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-choice'))));

/** Every mission of the day but the 퇴근 퀴즈 done and no incident left: the quiz is up (its 미션 브리핑 clicked away). */
const toFinale = (page: Page) =>
  page.evaluate(async () => {
    const url = '/src/content/stages/index.ts';
    const days = (await import(/* @vite-ignore */ url)) as typeof import('../src/content/stages');
    const store = (window as unknown as Win).__store;
    const run = store.getState().run!;
    const done = Object.fromEntries(days.getStage(run.stage).objectives.filter((o) => !o.finale).map((o) => [o.id, 0]));
    store.setState({ run: { ...run, scenarios: [], objectivesDone: done } });
    store.getState().event('e2e:ready');
    for (let i = 0; i < 20 && store.getState().concepts.length; i++) store.getState().dismissConcept();
  });

test('퀴즈: 틀리면 해설 뒤 처음부터, 다 맞힌 뒤엔 위에 연 창(도감·무전기)을 닫아도 그대로', async ({ page }) => {
  const problems = watchProblems(page);
  await start(page);
  // D-5: until the day's work is done the 설계 보드 only says the quiz comes at the end.
  await play(page, 0);
  await interact(page, 'board');
  await expect(title(page)).not.toHaveText(/퀴즈/);
  await expect(page.locator('.modal-body')).toContainText('복습 퀴즈');
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
  await toFinale(page);
  await expect(page.locator('.obj-panel')).toContainText('퇴근 전 복습 퀴즈');
  await interact(page, 'board');
  await expect(title(page)).toHaveText(/퀴즈/);
  const total = Number(/\/(\d+)/.exec(await page.locator('.qz-progress').innerText())![1]);
  await expect(page.locator('.qz-progress')).toContainText(`문제 1/${total}`);

  // A wrong answer: ✕ on it and the 사수's explanation, but the right choice is not marked.
  const right = await rightChoice(page);
  const wrong = (await shownChoices(page)).find((c) => c !== right)!;
  await page.locator(`.qz-choice[data-choice="${wrong}"]`).click();
  await expect(page.locator(`.qz-choice[data-choice="${wrong}"]`)).toHaveClass(/wrong/);
  await expect(page.locator('.qz-mentor.is-warn')).toContainText('아깝다.');
  await expect(page.locator('.qz-mentor.is-warn')).toContainText('처음부터 다시 풀어 보자.');
  await expect(page.locator('.qz-choice.right')).toHaveCount(0);
  await expect(page.locator('.qz-choice:not(:disabled)')).toHaveCount(0);
  await page.getByRole('button', { name: '처음부터 다시 ▶' }).click();
  await expect(page.locator('.qz-progress')).toContainText(`문제 1/${total}`);
  await expect(page.locator('.qz-mentor')).toHaveCount(0);

  // Every question right in one go.
  for (let i = 0; i < total; i++) {
    await expect(page.locator('.qz-progress')).toContainText(`문제 ${i + 1}/${total}`);
    const c = await rightChoice(page);
    await page.locator(`.qz-choice[data-choice="${c}"]`).click();
    await expect(page.locator(`.qz-choice[data-choice="${c}"]`)).toHaveClass(/right/);
    await expect(page.locator('.qz-mentor.is-ok')).toContainText('맞았어!');
    if (i < total - 1) await page.getByRole('button', { name: '다음 문제 ▶' }).click();
  }
  /** The last explanation is up, with 알겠어요! under it. */
  const cleared = async () => {
    await expect(page.locator('.qz-mentor.is-ok')).toContainText('맞았어!');
    await expect(page.getByRole('button', { name: '알겠어요!' })).toBeVisible();
  };
  await cleared();
  // The mission (and its card) only completes on 알겠어요!, so nothing pops over the explanation now.
  await expect(page.locator('.ccard-backdrop')).toHaveCount(0);

  // The 도감 (C) and the radio (H) open on top, and closing them comes back to the explanation.
  await page.keyboard.press('c');
  await expect(title(page)).toHaveText(/개념 도감/);
  await page.keyboard.press('Escape');
  await expect(title(page)).toHaveText(/퀴즈/);
  await cleared();
  await page.keyboard.press('h');
  await expect(title(page)).toHaveText(/쿠사수 무전기/);
  await page.keyboard.press('Escape');
  await expect(title(page)).toHaveText(/퀴즈/);
  await cleared();

  // 알겠어요! closes it and records the quiz: the day's work is done and the 퇴근 briefing (the outro) starts.
  await page.getByRole('button', { name: '알겠어요!' }).click();
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => 'quiz' in ((window as unknown as Win).__store.getState().run?.objectivesDone ?? {}))).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__store.getState().dialogue?.then)).toBe('results');

  expect(problems).toEqual([]);
});

test('HUD: 좁은 화면에서도 버튼이 잘리지 않음 (시계가 초 단위인 D-Day 포함)', async ({ page }) => {
  await start(page);
  for (const day of [1, 5]) {
    await play(page, day);
    await expect(page.locator('.hud')).toBeVisible();
    for (const width of [1440, 1280, 1110, 960, 861, 700, 640, 610, 480, 390, 375]) {
      await page.setViewportSize({ width, height: 720 });
      const fit = await page.evaluate(() => {
        const hud = document.querySelector('.hud')!.getBoundingClientRect();
        const cut = [...document.querySelectorAll<HTMLElement>('.hud-buttons > *, .hud-stage-no')]
          .filter((el) => el.getClientRects().length > 0)
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.left < hud.left - 0.5 || r.right > hud.right + 0.5;
          })
          .map((el) => el.className);
        // The stage chip (when shown) is not clipped by the title area shrinking.
        const chip = document.querySelector<HTMLElement>('.hud-stage-no');
        const stageBox = document.querySelector<HTMLElement>('.hud-stage');
        const chipShown = !!chip && chip.getClientRects().length > 0;
        const chipCut = chipShown && stageBox!.getBoundingClientRect().width + 0.5 < chip!.getBoundingClientRect().width;
        return { cut, chipCut };
      });
      expect(fit, `day ${day} at ${width}px`).toEqual({ cut: [], chipCut: false });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
});
