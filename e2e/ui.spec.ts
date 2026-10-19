// UI behaviour around windows and the HUD:
//  - the terminal's side box shows the objectives while nothing is broken, and the incidents when something is;
//  - a window opened from another one (the radio from the terminal, the dashboard from the HUD) goes back to it
//    on close (Esc, ✕, backdrop, Tab for the dashboard), with the terminal session as it was;
//  - the 🏃 speed button cycles 1x → 1.5x → 2x, is remembered, and the lion really walks faster.
// Typing and clicking go through the real UI; the app's store (imported through Vite, like e2e/persist.spec.ts)
// only starts stages, skips dialogue, runs the clock and uses map hotspots.
import { expect, test, type Page } from '@playwright/test';

type GameStore = (typeof import('../src/store/game'))['gameStore'];
/** The page's window with the app's store on it (see exposeStore). */
type Win = Window & { __store: GameStore };
/** The DataCenter scene's lion, as far as these tests look at it (it is a private field of the scene). */
type Lion = { x: number; y: number; anims: { timeScale: number }; body: { reset(x: number, y: number): void } };
type GameWin = Window & { __khuGame?: { scene: { getScene(key: string): ({ player?: Lion } & { sys: { isActive(): boolean } }) | null } } };

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

/** Concept cards pop up when an objective or incident is done and take focus; click them away. */
async function dismissConcepts(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Win).__store;
    for (let i = 0; i < 20 && store.getState().concepts.length; i++) store.getState().dismissConcept();
  });
}

/** Runs the game clock until incident `id` is in `state` (concept cards, which stop the clock, are clicked away). */
const runUntil = (page: Page, id: string, state: 'active' | 'resolved') =>
  page.evaluate(
    ([sid, want]) => {
      const store = (window as unknown as Win).__store;
      const now = () => store.getState().run?.scenarios.find((x) => x.id === sid)?.state;
      for (let i = 0; i < 300 && now() !== want; i++) {
        for (let j = 0; j < 20 && store.getState().concepts.length; j++) store.getState().dismissConcept();
        store.getState().tick();
      }
      return now();
    },
    [id, state] as const,
  );

/** Uses a map hotspot (desk, rack1, board…), as walking up to it and pressing Space does. */
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
  await page.evaluate(() => localStorage.setItem('khu-dc-save-v1', JSON.stringify({ unlocked: 7, best: {}, cards: [] })));
  await exposeStore(page);
}

test('터미널 옆 상자: 조용할 땐 지금 목표, 장애가 나면 지금 장애', async ({ page }) => {
  const problems = watchProblems(page);
  await start(page);
  await play(page, 3);
  await interact(page, 'desk');
  await expect(title(page)).toHaveText(/터미널 — ops/);

  // Calm: the box lists the open objective (the objective panel is behind this window).
  await expect(sideBox(page, '지금 목표')).toContainText('web 서버에 원격 접속해 수강신청 앱 실행하기');
  await expect(sideBox(page, '지금 장애')).toHaveCount(0);

  await typeLine(page, 'ssh web');
  await expect.poll(() => inputRow(page)).toContain('web@khu-dc:~$');
  await typeLine(page, 'server start');
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toContain('수강신청 서버 시작!');
  await dismissConcepts(page);
  // Nothing to do until the next incident: it says so, and what opens the next objective.
  await expect(sideBox(page, '지금 목표')).toContainText('다음 상황을 기다리는 중');
  await expect(sideBox(page, '지금 목표')).toContainText('장애를 해결하면 열려요');
  await expect(sideBox(page, '지금 목표')).not.toContainText('목표 완료');

  // The incident fires: the box switches to it, with the 쿠사수 button.
  expect(await runUntil(page, 's3-port', 'active')).toBe('active');
  await expect(sideBox(page, '지금 장애')).toContainText('연결이 거부됨');
  await expect(sideBox(page, '지금 장애').getByRole('button', { name: '쿠사수 힌트' })).toBeVisible();
  await expect(sideBox(page, '지금 목표')).toHaveCount(0);

  // Fixed: back to the objectives, with the one the fix unlocked.
  await typeLine(page, 'server set port 80');
  expect(await runUntil(page, 's3-port', 'resolved')).toBe('resolved');
  await dismissConcepts(page);
  await expect(sideBox(page, '지금 목표')).toContainText('curl로 /enroll 페이지 직접 요청해보기');
  await expect(sideBox(page, '지금 장애')).toHaveCount(0);
  await expect(title(page)).toHaveText(/터미널 — web/);

  // Stage 5: the objectives are the steps that solve the first incident, so the incident box lists them too.
  await page.keyboard.press('Escape');
  await play(page, 5);
  await interact(page, 'desk');
  await expect(sideBox(page, '지금 목표')).toContainText('곧 상황이 시작돼요');
  expect(await runUntil(page, 's5-drift', 'active')).toBe('active');
  await dismissConcepts(page);
  await expect(sideBox(page, '지금 장애')).toContainText('아래 목표를 차례로 하면 해결돼요');
  await expect(sideBox(page, '지금 장애')).toContainText('새 서버(srv-new)의 배포 기록 확인하기');

  expect(problems).toEqual([]);
});

test('창 위에 연 창은 닫으면 원래 창으로: 터미널 세션 그대로', async ({ page }) => {
  const problems = watchProblems(page);
  await start(page);
  await play(page, 3);
  await interact(page, 'desk');
  await typeLine(page, 'ssh web');
  await typeLine(page, 'server start');
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toContain('수강신청 서버 시작!');
  await dismissConcepts(page);
  expect(await runUntil(page, 's3-port', 'active')).toBe('active');

  // A half-typed line, then the radio from the box's button.
  await page.locator('.term-screen').click();
  await page.keyboard.type('hostna', { delay: 15 });
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$ hostna');
  await sideBox(page, '지금 장애').getByRole('button', { name: '쿠사수 힌트' }).click();
  await expect(title(page)).toHaveText(/쿠사수 무전기/);
  await expect(page.getByRole('tab', { name: /연결이 거부됨/ })).toHaveAttribute('aria-selected', 'true');

  // Esc: back to the same terminal session (host, scrollback, half-typed line).
  await page.keyboard.press('Escape');
  await expect(title(page)).toHaveText(/터미널 — web/);
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toContain('ops@khu-dc:~$ ssh web');
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$ hostna');
  // The cursor is back in the terminal: typing goes on where it stopped.
  await page.keyboard.type('me', { delay: 15 });
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$ hostname');

  // ✕ and the backdrop also go back to the terminal.
  await sideBox(page, '지금 장애').getByRole('button', { name: '쿠사수 힌트' }).click();
  await expect(title(page)).toHaveText(/쿠사수 무전기/);
  await page.locator('.modal-head').getByRole('button', { name: /닫기/ }).click();
  await expect(title(page)).toHaveText(/터미널 — web/);
  await sideBox(page, '지금 장애').getByRole('button', { name: '쿠사수 힌트' }).click();
  await expect(title(page)).toHaveText(/쿠사수 무전기/);
  await page.locator('.modal-backdrop').click({ position: { x: 8, y: 8 } });
  await expect(title(page)).toHaveText(/터미널 — web/);
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$ hostname');

  // The HUD stays usable over a window: the dashboard opens on top, and Tab (its toggle) goes back.
  await page.locator('.hud').getByRole('button', { name: /대시보드/ }).click();
  await expect(title(page)).toHaveText(/관제 대시보드/);
  await expect(page.locator('.modal-backdrop')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(title(page)).toHaveText(/터미널 — web/);
  // 도감 from the HUD, then the radio on top of it: Esc walks back one window at a time.
  await page.locator('.hud').getByRole('button', { name: /도감/ }).click();
  await expect(title(page)).toHaveText(/개념 도감/);
  await page.keyboard.press('h');
  await expect(title(page)).toHaveText(/쿠사수 무전기/);
  await page.keyboard.press('Escape');
  await expect(title(page)).toHaveText(/개념 도감/);
  await page.keyboard.press('Escape');
  await expect(title(page)).toHaveText(/터미널 — web/);
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$ hostname');

  // The HUD's exit question goes over the window; Esc or 계속하기 drops only the question.
  const exitQuestion = page.locator('.modal-head h2', { hasText: '스테이지에서 나갈까요?' });
  const terminalTitle = page.locator('.modal-head h2', { hasText: '터미널 — web' });
  await page.locator('.hud').getByRole('button', { name: /나가기/ }).click();
  await expect(exitQuestion).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(exitQuestion).toHaveCount(0);
  await expect(terminalTitle).toBeVisible();
  await page.locator('.hud').getByRole('button', { name: /나가기/ }).click();
  await page.getByRole('button', { name: '계속하기' }).click();
  await expect(exitQuestion).toHaveCount(0);
  await expect(terminalTitle).toBeVisible();
  await expect.poll(() => inputRow(page)).toBe('web@khu-dc:~$ hostname');

  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);

  // Restarting the stage closes every window, stacked ones included.
  await interact(page, 'desk');
  await sideBox(page, '지금 장애').getByRole('button', { name: '쿠사수 힌트' }).click();
  await expect(title(page)).toHaveText(/쿠사수 무전기/);
  await play(page, 3);
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Win).__store.getState().modalStack)).toEqual([]);

  expect(problems).toEqual([]);
});

/** The lion, once the stage's Phaser scene is up. */
async function waitForLion(page: Page) {
  await expect
    .poll(() => page.evaluate(() => !!(window as GameWin).__khuGame?.scene.getScene('DataCenter')?.player), { timeout: 20_000 })
    .toBe(true);
}

/**
 * Walking speed in px/s: from the spawn point, hold → and time the distance covered
 * (measured after a short run-up, between two readings of the game's own clock).
 */
async function walkSpeed(page: Page): Promise<{ speed: number; timeScale: number }> {
  await page.evaluate(() => {
    const lion = (window as GameWin).__khuGame!.scene.getScene('DataCenter')!.player!;
    // The spawn tile (19, 13): corridor, with open floor to the right.
    lion.body.reset(19.5 * 48, 13.5 * 48 + 10);
  });
  await page.keyboard.down('ArrowRight');
  try {
    await page.waitForTimeout(200);
    const read = () =>
      page.evaluate(() => {
        const lion = (window as GameWin).__khuGame!.scene.getScene('DataCenter')!.player!;
        return { x: lion.x, t: performance.now(), timeScale: lion.anims.timeScale };
      });
    const a = await read();
    await page.waitForTimeout(400);
    const b = await read();
    return { speed: (b.x - a.x) / ((b.t - a.t) / 1000), timeScale: b.timeScale };
  } finally {
    await page.keyboard.up('ArrowRight');
  }
}

test('이동 속도 버튼: 1x → 1.5x → 2x, 기억, 실제로 빨라짐', async ({ page }) => {
  const problems = watchProblems(page);
  await start(page);
  await page.evaluate(() => localStorage.removeItem('khu-dc-speed'));
  await page.reload();
  await exposeStore(page);
  await play(page, 3);
  await waitForLion(page);

  const button = page.getByRole('button', { name: /이동 속도/ });
  await expect(button).toHaveText(/🏃\s*1x/);
  await expect(button).toHaveAttribute('title', '이동 속도');

  // 1x: the normal walk.
  const slow = await walkSpeed(page);
  expect(slow.speed).toBeGreaterThan(150);
  expect(slow.speed).toBeLessThan(270);
  expect(slow.timeScale).toBe(1);

  await button.click();
  await expect(button).toHaveText(/1\.5x/);
  expect(await page.evaluate(() => localStorage.getItem('khu-dc-speed'))).toBe('1.5');
  await button.click();
  await expect(button).toHaveText(/2x/);
  expect(await page.evaluate(() => localStorage.getItem('khu-dc-speed'))).toBe('2');

  // 2x: twice as far in the same time, and the walk cycle plays twice as fast (no sliding).
  const fast = await walkSpeed(page);
  expect(fast.speed / slow.speed).toBeGreaterThan(1.6);
  expect(fast.speed / slow.speed).toBeLessThan(2.4);
  expect(fast.timeScale).toBe(2);

  // Remembered after a reload.
  await page.reload();
  await exposeStore(page);
  await play(page, 3);
  await waitForLion(page);
  await expect(page.getByRole('button', { name: /이동 속도/ })).toHaveText(/2x/);

  // A change applies at once, also mid-walk: 2x → 1x while → is held.
  await page.evaluate(() => {
    const lion = (window as GameWin).__khuGame!.scene.getScene('DataCenter')!.player!;
    lion.body.reset(19.5 * 48, 13.5 * 48 + 10);
  });
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: /이동 속도/ }).click(); // → 1x
  await expect(page.getByRole('button', { name: /이동 속도/ })).toHaveText(/1x/);
  const read = () =>
    page.evaluate(() => {
      const lion = (window as GameWin).__khuGame!.scene.getScene('DataCenter')!.player!;
      return { x: lion.x, t: performance.now(), timeScale: lion.anims.timeScale };
    });
  const a = await read();
  await page.waitForTimeout(300);
  const b = await read();
  await page.keyboard.up('ArrowRight');
  const midSpeed = (b.x - a.x) / ((b.t - a.t) / 1000);
  expect(midSpeed).toBeGreaterThan(150);
  expect(midSpeed).toBeLessThan(270);
  expect(b.timeScale).toBe(1);

  expect(problems).toEqual([]);
});

test('퀴즈 정답은 위에 연 창(도감·무전기)을 닫아도 그대로', async ({ page }) => {
  const problems = watchProblems(page);
  await start(page);
  await play(page, 0);
  // Everything but the quiz is done, so the right answer is recorded when the quiz window closes.
  await page.evaluate(() =>
    (window as unknown as Win).__store.getState().event('room:server', 'room:network', 'room:power', 'room:cooling', 'room:noc', 'open:dashboard', 'open:mentor'),
  );
  await dismissConcepts(page);
  await interact(page, 'board');
  await expect(title(page)).toHaveText(/퀴즈/);
  const answer = await page.evaluate(async () => {
    const url = '/src/content/stages/index.ts';
    const stages = (await import(/* @vite-ignore */ url)) as typeof import('../src/content/stages');
    return stages.getStage(0).quiz!.answer;
  });
  await page.locator('.qz-choice').nth(answer).click();
  await expect(page.locator('.qz-todo')).toContainText('🎉 정답');

  // The quiz says "C 키 = 개념 도감": the 도감 opens on top, and closing it comes back to the explanation.
  await page.keyboard.press('c');
  await expect(title(page)).toHaveText(/개념 도감/);
  await page.keyboard.press('Escape');
  await expect(title(page)).toHaveText(/퀴즈/);
  await expect(page.locator('.qz-todo')).toContainText('🎉 정답');
  await page.keyboard.press('h');
  await expect(title(page)).toHaveText(/쿠사수 무전기/);
  await page.keyboard.press('Escape');
  await expect(title(page)).toHaveText(/퀴즈/);

  // 알겠어요! records it: the stage is cleared.
  await page.getByRole('button', { name: '알겠어요!' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__store.getState().dialogue?.then)).toBe('results');
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);

  expect(problems).toEqual([]);
});

test('HUD: 좁은 화면에서도 버튼이 잘리지 않음 (버티기 시계가 있는 7단계 포함)', async ({ page }) => {
  await start(page);
  for (const stage of [3, 7]) {
    await play(page, stage);
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
      expect(fit, `stage ${stage} at ${width}px`).toEqual({ cut: [], chipCut: false });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
});
