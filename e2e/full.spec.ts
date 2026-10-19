// Full UI run: plays stages 0–7 in the real app (Vite dev server), completing objectives and fixing
// each incident shortly after it fires, opening the stage's windows and taking screenshots.
// Drives the same store the UI uses (imported through Vite), so the React/Phaser layers render
// every state a player would see. Fails on any page error or console error.
import { expect, test, type Page } from '@playwright/test';

test.setTimeout(15 * 60 * 1000);

type Step = { cmd: string; host: string } | { act: string } | { events: string[] };

/** How each objective is completed (mirrors tests/playthrough.test.ts AUTOPLAY). Actions are named, see ACTIONS below. */
const AUTOPLAY: Record<number, Record<string, Step[]>> = {
  0: {
    visit: [{ events: ['room:server', 'room:network', 'room:power', 'room:cooling', 'room:noc'] }],
    dashboard: [{ events: ['open:dashboard'] }],
    mentor: [{ events: ['open:mentor'] }],
    quiz: [{ events: ['quiz:correct'] }],
  },
  1: { mount: [{ act: 'mountAll' }], power: [{ act: 'feedA' }], cable: [{ act: 'cableAll' }] },
  2: { terminal: [{ events: ['open:terminal'] }], dhcp: [{ cmd: 'dhcp on', host: 'ops' }], ping: [{ cmd: 'ping web', host: 'ops' }] },
  3: { start: [{ cmd: 'server start', host: 'web' }], curl: [{ cmd: 'curl http://web/enroll', host: 'ops' }] },
  4: { watch: [{ cmd: 'svc list', host: 'ops' }] },
  5: {
    log: [{ cmd: 'deploy log', host: 'srv-new' }],
    recipe: [{ act: 'dockerfile' }],
    image: [{ cmd: 'docker build -t enroll:1.0 .', host: 'ops' }, { cmd: 'docker push enroll:1.0', host: 'ops' }],
    run: [{ cmd: 'docker run -p 80:8000 enroll:1.0', host: 'srv-new' }],
  },
  6: { desired: [{ act: 'desired' }], observe: [{ cmd: 'pods', host: 'ops' }] },
  7: { postmortem: [{ events: ['board:postmortem'] }] },
};

/** Windows to open (and screenshot) once per stage, after the given stage second. */
const WINDOWS: Record<number, { at: number; modal: Record<string, unknown>; name: string }[]> = {
  0: [{ at: 2, modal: { type: 'quiz' }, name: 'quiz' }],
  1: [
    { at: 1, modal: { type: 'rack' }, name: 'rack' },
    { at: 3, modal: { type: 'power' }, name: 'power' },
    { at: 5, modal: { type: 'cable', mode: 'build' }, name: 'cable' },
  ],
  2: [{ at: 4, modal: { type: 'terminal', host: 'ops' }, name: 'terminal' }],
  3: [{ at: 6, modal: { type: 'terminal', host: 'ops' }, name: 'terminal' }],
  4: [{ at: 8, modal: { type: 'board', board: 'decompose' }, name: 'decompose' }],
  5: [{ at: 2, modal: { type: 'board', board: 'dockerfile' }, name: 'dockerfile' }],
  6: [
    { at: 1, modal: { type: 'board', board: 'desired' }, name: 'desired' },
    { at: 12, modal: { type: 'dashboard' }, name: 'dashboard-pods' },
  ],
  7: [
    { at: 25, modal: { type: 'cable', mode: 'repair' }, name: 'cable-repair' },
    { at: 45, modal: { type: 'repair', target: 'crac' }, name: 'crac' },
  ],
};

async function setup(page: Page) {
  await page.evaluate(async () => {
    // Same module URLs the app uses, so this is the app's own store instance.
    const imp = (p: string) => import(/* @vite-ignore */ p);
    const S = (await imp('/src/store/game.ts')) as typeof import('../src/store/game');
    const A = (await imp('/src/sim/actions.ts')) as typeof import('../src/sim/actions');
    const E = (await imp('/src/sim/engine.ts')) as typeof import('../src/sim/engine');
    const C = (await imp('/src/content/stages/index.ts')) as typeof import('../src/content/stages');
    const store = S.gameStore;
    type W = Parameters<typeof A.mount>[0];
    const ACTIONS: Record<string, (w: W) => void> = {
      mountAll: (w) => ['web', 'db', 'spare'].forEach((id) => A.mount(w, id)),
      feedA: (w) => ['web', 'db', 'spare'].forEach((id) => A.setFeeds(w, id, ['A'])),
      cableAll: (w) => ['web', 'db', 'spare'].forEach((id, i) => A.connectCable(w, `${id}:eth0`, `sw1:p${i + 1}`)),
      dockerfile: (w) => A.writeDockerfile(w, 'enroll'),
      desired: (w) => A.applyDesired(w, 'enroll', 3, 'enroll:v1'),
    };
    const drain = () => {
      for (let i = 0; i < 50 && store.getState().dialogue; i++) store.getState().nextDialogue();
      for (let i = 0; i < 50 && store.getState().concepts.length; i++) store.getState().dismissConcept();
    };
    const run = (step: { cmd?: string; host?: string; act?: string; events?: string[] } | { label: string; action: (w: W) => void }) => {
      const s = store.getState();
      if ('action' in step) return s.act(step.action);
      if (step.cmd) {
        store.setState({ terminal: { host: step.host!, log: [] } });
        const out = store.getState().command(step.cmd);
        return out.lines.filter((l) => l.startsWith('\x1b[31m'));
      }
      if (step.act) return s.act(ACTIONS[step.act]);
      if (step.events) return s.event(...step.events);
    };
    const fixed = new Set<string>();
    const reported = new Set<string>();
    (window as unknown as Record<string, unknown>).__drive = {
      play(stage: number) {
        try {
          localStorage.setItem('khu-dc-save-v1', JSON.stringify({ unlocked: 7, best: {}, cards: [] }));
        } catch {
          /* ignore */
        }
        store.getState().play(stage as 0);
        fixed.clear();
        reported.clear();
        drain();
      },
      /** One game second: objectives → tick → incident fixes. Returns what happened. */
      second(autoplay: Record<string, unknown[]>) {
        const s = store.getState();
        const r = s.run;
        if (!r) return { screen: s.screen, activated: [], errors: [] };
        const def = C.getStage(r.stage);
        const errors: string[] = [];
        for (const o of E.visibleObjectives(def, r)) {
          if (o.id in store.getState().run!.objectivesDone) continue;
          for (const st of (autoplay[o.id] ?? []) as Parameters<typeof run>[0][]) run(st);
        }
        store.getState().tick();
        drain();
        const now = store.getState().run;
        // Report every incident that fired since the last report, including ones the app's own
        // 1-second timer fired between our calls.
        const activated = now ? now.scenarios.filter((x) => x.state !== 'waiting' && !reported.has(x.id)).map((x) => x.id) : [];
        activated.forEach((id) => reported.add(id));
        if (now) {
          for (const rt of now.scenarios) {
            if (rt.state !== 'active' || fixed.has(rt.id) || now.ctx.stageTime < (rt.activatedAt ?? 0) + 3) continue;
            const sc = def.scenarios.find((x) => x.id === rt.id)!;
            for (const step of sc.solutionSteps) {
              const bad = run(step as Parameters<typeof run>[0]);
              if (Array.isArray(bad) && bad.length) errors.push(`${rt.id}: ${bad.join(' | ')}`);
            }
            fixed.add(rt.id);
          }
        }
        drain();
        const st = store.getState();
        return { screen: st.screen, stage: st.run?.stage, t: st.run?.ctx.stageTime, activated, errors };
      },
      open(modal: Record<string, unknown>) {
        store.getState().openModal(modal as never);
      },
      close() {
        store.getState().closeModal();
      },
      async hint(id: string) {
        store.getState().openModal({ type: 'hint', scenarioId: id });
        await store.getState().askHint(id);
      },
      resultsNext() {
        drain();
        return store.getState().screen;
      },
    };
  });
}

test('모든 스테이지를 끝까지 플레이 (UI)', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // /api/hint is expected to be missing without the Worker → canned hints.
    if (m.type() === 'error' && !/api\/hint|Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await setup(page);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`) });

  for (let stage = 0; stage <= 7; stage++) {
    await page.evaluate((s) => (window as never as { __drive: { play(n: number): void } }).__drive.play(s), stage);
    await page.waitForTimeout(700);
    await shot(`s${stage}-00-start`);
    const windows = [...(WINDOWS[stage] ?? [])];
    const seen = new Set<string>();
    let screen = 'playing';
    for (let i = 0; i < 600 && screen === 'playing'; i++) {
      const r = await page.evaluate(
        (a) => (window as never as { __drive: { second(x: unknown): { screen: string; t: number; activated: string[]; errors: string[] } } }).__drive.second(a),
        AUTOPLAY[stage],
      );
      screen = r.screen;
      problems.push(...r.errors.map((e) => `stage ${stage} solution error: ${e}`));
      for (const id of r.activated) {
        if (seen.has(id)) continue;
        seen.add(id);
        await page.waitForTimeout(250);
        await shot(`s${stage}-${id}-alert`);
        await page.evaluate((x) => (window as never as { __drive: { hint(id: string): Promise<void> } }).__drive.hint(x), id);
        await page.waitForTimeout(250);
        await shot(`s${stage}-${id}-hint`);
        await page.evaluate(() => (window as never as { __drive: { close(): void } }).__drive.close());
      }
      while (windows.length && r.t >= windows[0].at && screen === 'playing') {
        const w = windows.shift()!;
        await page.evaluate((m) => (window as never as { __drive: { open(m: unknown): void } }).__drive.open(m), w.modal);
        await page.waitForTimeout(400);
        await shot(`s${stage}-w-${w.name}`);
        await page.evaluate(() => (window as never as { __drive: { close(): void } }).__drive.close());
      }
    }
    expect(screen, `stage ${stage} did not reach results`).toBe('results');
    await page.waitForTimeout(500);
    await shot(`s${stage}-99-results`);
  }
  // Ending screen
  await page.evaluate(async () => {
    const S = (await import(/* @vite-ignore */ '/src/store/game.ts' as string)) as typeof import('../src/store/game');
    S.gameStore.getState().finishResults('next');
  });
  await page.waitForTimeout(600);
  await shot('ending');
  expect(problems).toEqual([]);
});
