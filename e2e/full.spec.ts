// Full UI run: plays all six days (D-5 … D-Day) on seed 1 in the real app (Vite dev server), the way
// tests/autoplay.ts playDay does: each mission's AUTOPLAY steps, every alarm ACKed 2 s after it shows up
// and its incident's solution run 2 s after that. It drives the store the UI uses (window.__khuStore, plus
// the game's own modules imported through Vite), so React and Phaser render every state a player would see.
// Per day it screenshots the map (also when the first alarm shows), the NOC with that alarm open, an IOS
// session on the 관리 PC (`show interfaces status` on TOR-01, from D-4) and the daily report; D-Day's
// report then leads to the ending. Fails on any page error or console error.
import { expect, test, type Page } from '@playwright/test';

test.setTimeout(20 * 60 * 1000);
// A click that something covers (a concept card …) fails instead of waiting out the whole run.
test.use({ actionTimeout: 15_000 });

type GameStore = (typeof import('../src/store/game'))['gameStore'];
type StoreWin = Window & { __khuStore: GameStore };

/** What one driven game second reports back. */
interface Second {
  screen: string;
  day: number | null;
  t: number;
  /** The outro is up: the day is over */
  over: boolean;
  /** Alarms on the NMS that nobody has ACKed yet */
  openAlarms: number;
  /** Red output from solution steps */
  errors: string[];
}

type Driver = { play(day: number): void; second(): Second };
type DriverWin = Window & { __drive: Driver };

/** Installs window.__drive on the page: playDay's loop, one game second per call, against the app's store. */
async function installDriver(page: Page) {
  await page.evaluate(async () => {
    const imp = (p: string) => import(/* @vite-ignore */ p);
    const AP = (await imp('/tests/autoplay.ts')) as typeof import('../tests/autoplay');
    const E = (await imp('/src/sim/engine.ts')) as typeof import('../src/sim/engine');
    const C = (await imp('/src/content/stages/index.ts')) as typeof import('../src/content/stages');
    const store = (window as unknown as StoreWin).__khuStore;
    type Step = import('../tests/autoplay').Step | import('../src/sim/scenario').SolutionStep;

    const drain = () => {
      for (let i = 0; i < 50 && store.getState().concepts.length; i++) store.getState().dismissConcept();
    };
    /**
     * One step, like tests/autoplay.ts apply(). Commands run in a throwaway session on the step's host (IOS
     * lines from the device's `>` prompt), then the player's own session is put back: the terminal windows
     * this test opens show the desk's session, not the driver's. Returns the red lines.
     */
    const run = (step: Step): string[] => {
      const s = store.getState();
      if ('ios' in step || 'cmd' in step) {
        const saved = s.terminal;
        store.setState({ terminal: { host: step.host, log: [], mode: 'ios' in step ? { level: 'user' } : null } });
        const bad: string[] = [];
        for (const line of 'ios' in step ? step.ios : [step.cmd]) {
          const out = store.getState().command(line, false);
          bad.push(...out.lines.filter((l) => l.startsWith(AP.RED)).map((l) => `${step.host}: ${line} → ${l}`));
        }
        store.setState({ terminal: saved });
        return bad;
      }
      if ('action' in step) s.act(step.action, ...('events' in step ? (step.events ?? []) : []));
      else s.event(...step.events);
      return [];
    };

    /** Incidents whose solution already ran, in the run of `epoch` (every play() starts a new one). */
    const solved = new Set<string>();
    let epoch = -1;
    (window as unknown as DriverWin).__drive = {
      play(day) {
        store.getState().play(day as 0);
        for (let i = 0; i < 50 && store.getState().dialogue; i++) store.getState().nextDialogue();
      },
      second() {
        const errors: string[] = [];
        if (store.getState().stageEpoch !== epoch) {
          epoch = store.getState().stageEpoch;
          solved.clear();
        }
        const r0 = store.getState().run;
        if (store.getState().screen === 'playing' && r0 && !store.getState().dialogue) {
          const def = C.getStage(r0.stage);
          for (const o of E.visibleObjectives(def, r0)) {
            if (o.id in store.getState().run!.objectivesDone) continue;
            for (const st of AP.AUTOPLAY[r0.stage]?.[o.id] ?? []) run(st);
          }
          drain();
          store.getState().tick();
          drain();
          const now = () => store.getState().run!.ctx.stageTime;
          for (const a of store.getState().run!.alarms) {
            if (a.ackAt === null && a.clearedAt === null && now() >= a.raisedAt + 2) store.getState().ackAlarm(a.id);
          }
          for (const a of store.getState().run!.alarms) {
            const r = store.getState().run!.scenarios.find((x) => x.id === a.scenarioId);
            if (!r || r.state !== 'active' || a.ackAt === null || solved.has(r.id) || now() < a.ackAt + 2) continue;
            for (const st of E.scenarioOf(def, r.id).solutionSteps) errors.push(...run(st).map((e) => `${r.id} ${e}`));
            solved.add(r.id);
          }
          drain();
        }
        const s = store.getState();
        return {
          screen: s.screen,
          day: s.run?.stage ?? null,
          t: s.run?.ctx.stageTime ?? 0,
          over: s.dialogue?.then === 'results',
          openAlarms: s.run?.alarms.filter((a) => a.ackAt === null && a.clearedAt === null).length ?? 0,
          errors,
        };
      },
    };
  });
}

const title = (page: Page) => page.locator('.modal-head h2');

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

/** Closes every open window and clicks concept cards away. */
async function closeWindows(page: Page) {
  await page.evaluate(() => {
    const s = (window as unknown as StoreWin).__khuStore;
    for (let i = 0; i < 10 && s.getState().modal; i++) s.getState().closeModal();
    for (let i = 0; i < 20 && s.getState().concepts.length; i++) s.getState().dismissConcept();
  });
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
}

/**
 * Holds the game clock (the app's own 1 s timer too) while `fn` looks around, so no mission finishes and no
 * concept card pops up over a window the test is typing into or taking a picture of.
 */
async function holdClock(page: Page, fn: () => Promise<void>) {
  const setPaused = (p: boolean) =>
    page.evaluate((v) => {
      const s = (window as unknown as StoreWin).__khuStore;
      for (let i = 0; i < 20 && s.getState().concepts.length; i++) s.getState().dismissConcept();
      s.getState().setPaused(v);
    }, p);
  await setPaused(true);
  try {
    await fn();
  } finally {
    await setPaused(false);
  }
}

/**
 * At the 관리 PC desk: ssh to TOR-01 and look at its ports (`show interfaces status`), typed through the
 * real terminal, then a screenshot.
 */
async function iosSession(page: Page, shot: (name: string) => Promise<unknown>, name: string) {
  await page.evaluate(() => (window as unknown as StoreWin).__khuStore.getState().interact('desk'));
  await expect(title(page)).toHaveText(/터미널 — ops/);
  const type = async (line: string, prompt: string) => {
    await page.locator('.term-screen').click();
    await page.keyboard.type(line, { delay: 10 });
    await page.keyboard.press('Enter');
    await expect.poll(() => inputRow(page)).toBe(prompt);
    // A mission this finishes (D-4's ssh) pops its card: click it away so the next line goes to the terminal.
    await page.evaluate(() => {
      const s = (window as unknown as StoreWin).__khuStore;
      for (let i = 0; i < 20 && s.getState().concepts.length; i++) s.getState().dismissConcept();
    });
  };
  await type('ssh TOR-01', 'TOR-01>');
  await type('enable', 'TOR-01#');
  await type('show interfaces status', 'TOR-01#');
  await expect.poll(() => rows(page).then((r) => r.join('\n'))).toContain('Gi1/0/1');
  await page.waitForTimeout(300);
  await shot(name);
  // Back to the shell, so the desk's session is as the driver expects to find it.
  await type('end', 'TOR-01#');
  await type('exit', 'ops@khu-dc:~$');
  await closeWindows(page);
}

test('D-5 … D-Day를 끝까지 플레이 (seed 1, UI)', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // Without the hint Worker /api/hint is missing; nothing here asks for a hint, but don't count it if it happens.
    if (m.type() === 'error' && !/api\/hint/.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  // Seed 1, every day open, no cards yet.
  await page.evaluate(() => localStorage.setItem('khu-dc-save-v2', JSON.stringify({ unlocked: 5, seed: 1, best: {}, cards: [] })));
  await page.reload();
  await installDriver(page);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`) });
  const drive = () => page.evaluate(() => (window as unknown as DriverWin).__drive.second());

  await page.evaluate(() => (window as unknown as DriverWin).__drive.play(0));
  for (let day = 0; day <= 5; day++) {
    const tag = `d${day}`;
    await expect(page.locator('.hud')).toContainText(day === 5 ? 'D-Day' : `D-${5 - day}`);
    await page.waitForTimeout(800);
    await shot(`${tag}-00-map`);

    let r: Second = await drive();
    let nocShot = false;
    let iosShot = day === 0; // D-5 has no terminal at the desk yet
    let mapShot = false;
    for (let i = 0; i < 1200 && r.screen === 'playing' && !r.over; i++) {
      problems.push(...r.errors.map((e) => `${tag} solution: ${e}`));
      if (!iosShot && r.t >= 3) {
        iosShot = true;
        await holdClock(page, () => iosSession(page, shot, `${tag}-02-ios`));
      }
      // The NOC while an alarm is up and not ACKed yet (the driver ACKs it 2 s after it shows).
      if (!nocShot && r.openAlarms > 0) {
        nocShot = true;
        await holdClock(page, async () => {
          // The map first: the call (📞) and the alarm (🚨) as toasts, the HUD gone red.
          await page.waitForTimeout(400);
          await shot(`${tag}-01-map-alarm`);
          await page.evaluate(() => (window as unknown as StoreWin).__khuStore.getState().openModal({ type: 'noc', tab: 'nms' }));
          await expect(page.locator('.nms-map')).toBeVisible();
          await page.waitForTimeout(500);
          await shot(`${tag}-01-noc-alarm`);
          await closeWindows(page);
        });
      }
      if (!mapShot && r.t >= 40) {
        mapShot = true;
        await page.waitForTimeout(300);
        await shot(`${tag}-03-map-later`);
      }
      r = await drive();
    }
    problems.push(...r.errors.map((e) => `${tag} solution: ${e}`));
    if (!r.over && r.screen !== 'results') {
      // What is still going on, for the failure message.
      const left = await page.evaluate(() => {
        const run = (window as unknown as StoreWin).__khuStore.getState().run!;
        return JSON.stringify({
          alarms: run.alarms.filter((a) => a.clearedAt === null),
          scenarios: run.scenarios.filter((x) => x.state !== 'resolved').map((x) => ({ id: x.id, state: x.state })),
        });
      });
      expect(r.over, `${tag} did not end (t=${r.t}): ${left}`).toBe(true);
    }
    expect(nocShot, `${tag}: no alarm showed up`).toBe(true);

    // The sign-off lines, with Enter as a player would, then the daily report.
    const report = page.getByRole('dialog', { name: /일일 리포트/ });
    for (let i = 0; i < 30 && !(await report.isVisible()); i++) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(250);
    }
    await expect(report).toBeVisible();
    await expect(page.locator('.res-sub')).toContainText('일일 리포트');
    await expect(page.locator('.res-stats')).toContainText('MTTD');
    await page.waitForTimeout(1200);
    await shot(`${tag}-04-report`);

    // 다음 날 출근 ▶ (D-Day: 엔딩 보기).
    await page.locator('.res-primary').click();
    if (day < 5) {
      await expect(page.locator('.hud')).toContainText(day + 1 === 5 ? 'D-Day' : `D-${4 - day}`);
      await page.evaluate(() => {
        const s = (window as unknown as StoreWin).__khuStore;
        for (let i = 0; i < 50 && s.getState().dialogue; i++) s.getState().nextDialogue();
      });
    }
  }

  // The ending certificate.
  await expect(page.getByRole('heading', { name: '수료증' })).toBeVisible();
  await page.waitForTimeout(800);
  await shot('ending');
  expect(problems, problems.join('\n')).toEqual([]);
});
