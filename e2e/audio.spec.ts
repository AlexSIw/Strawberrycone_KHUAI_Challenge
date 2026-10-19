// Sound: credits window, mute toggle (button, M, saved setting), and the audio engine following the
// game — lobby tune out of the stages, long equal-power crossfades into and out of a stage, a short one
// into an incident, the alarm, the coin and the win jingle (incident card, clear popup, certificate).
// Reads the engine through its dev hook.
import { expect, test, type Page } from '@playwright/test';

type Track = 'lobby' | 'normal' | 'incident';
type AudioState = {
  context: string;
  time: number;
  music: Track | null;
  want: Track | null;
  muted: boolean;
  loaded: string[];
  failed: string[];
  gains: Record<Track, number>;
  duck: number;
  voices: { track: Track; gain: number; leaving: boolean; pos: number }[];
  fades: { from: Track | null; to: Track | null; fadeIn: number; fadeOut: number; at: number }[];
  sfx: { id: 'alarm' | 'win' | 'coin'; at: number; cutAt?: number }[];
  alarm: number;
  win: number;
  coin: number;
  blip: number;
};

type GameStore = (typeof import('../src/store/game'))['gameStore'];
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

const audioState = (page: Page) => page.evaluate(() => (window as never as { __khuAudio: { debugState(): AudioState } }).__khuAudio.debugState());
const lastFade = async (page: Page) => (await audioState(page)).fades.at(-1);
const voice = (s: AudioState, track: Track) => s.voices.find((v) => v.track === track);
const ALL_CLIPS = ['alarm', 'coin', 'incident', 'lobby', 'normal', 'voice', 'win'];

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

test('크레딧 · 소리 켜기/끄기 · 로비 음악 → 스테이지 → 장애 → 복귀 크로스페이드, 경보/코인/징글, 콘솔 에러 없음', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);

  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('khu-dc-audio'));
  await page.reload();

  // Nothing starts before the player does something.
  expect((await audioState(page)).context).toBe('none');

  // Credits window: opens from the corner, Esc closes it.
  await page.getByRole('button', { name: '크레딧' }).click();
  const credits = page.locator('.modal').filter({ hasText: '크레딧' });
  await expect(credits).toBeVisible();
  for (const text of [
    'Snowland Town',
    'Music by Matthew Pablo',
    'www.matthewpablo.com',
    'CC BY 3.0',
    'Eric Matyas',
    'www.soundimage.org',
    'Hupple',
    'Short alarm',
    'Win Jingle',
    'Coin Bling',
    'Tung Lee Media',
    'used with permission',
    'Josh Simmons',
    'CC BY 4.0',
    'Galmuri',
    'SIL Open Font License',
  ]) {
    await expect(credits).toContainText(text);
  }
  await expect(credits.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
  await expect(credits.getByRole('link', { name: 'CC BY 3.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/3.0/');
  await expect(credits.getByRole('link', { name: 'www.matthewpablo.com' })).toHaveAttribute('href', 'https://www.matthewpablo.com');
  await page.keyboard.press('Escape');
  await expect(credits).toHaveCount(0);
  await expect(page.getByRole('button', { name: /처음부터 시작/ })).toBeVisible();

  // That click unlocked audio: the lobby tune (not the in-stage loop) fades in on the title screen.
  await expect.poll(async () => (await audioState(page)).music).toBe('lobby');
  await expect.poll(async () => (await audioState(page)).loaded.length).toBe(ALL_CLIPS.length);
  const s0 = await audioState(page);
  expect(s0.context).toBe('running');
  expect(s0.failed).toEqual([]);
  expect(s0.loaded.sort()).toEqual(ALL_CLIPS);
  expect(s0.fades[0]).toMatchObject({ from: null, to: 'lobby' });
  // Loudness matched: the hot incident loop and the lobby tune are turned down to the normal loop's level.
  expect(s0.gains.normal).toBe(1);
  expect(s0.gains.lobby).toBeLessThan(1);
  expect(s0.gains.incident).toBeLessThan(0.4);

  // Mute: title button, M hotkey, saved across a reload.
  const sound = page.getByRole('button', { name: '소리' });
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(page.getByRole('button', { name: '소리' })).toHaveAttribute('aria-pressed', 'false');
  expect((await audioState(page)).muted).toBe(true);
  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: '소리' })).toHaveAttribute('aria-pressed', 'true');

  // M was a gesture too: the lobby tune comes in again. Let it reach full level.
  await expect.poll(async () => (await audioState(page)).loaded.length).toBe(ALL_CLIPS.length);
  await expect.poll(async () => (await audioState(page)).music).toBe('lobby');
  await expect.poll(async () => voice(await audioState(page), 'lobby')?.gain).toBe(s0.gains.lobby);

  // Start: a long equal-power crossfade from the lobby tune to the in-stage loop.
  await page.getByRole('button', { name: /처음부터 시작/ }).click();
  await expect.poll(async () => (await audioState(page)).music).toBe('normal');
  const into = await lastFade(page);
  expect(into).toMatchObject({ from: 'lobby', to: 'normal' });
  expect(into!.fadeIn).toBeGreaterThanOrEqual(2.5);
  expect(into!.fadeIn).toBeLessThanOrEqual(3);
  await page.waitForTimeout(700);
  const mid = await audioState(page);
  const lobbyOut = voice(mid, 'lobby');
  const normalIn = voice(mid, 'normal');
  expect(lobbyOut?.leaving).toBe(true);
  expect(lobbyOut!.gain).toBeGreaterThan(0.05);
  expect(normalIn!.gain).toBeGreaterThan(0.05);
  expect(normalIn!.gain).toBeLessThan(mid.gains.normal);
  // Equal power: (out/full)² + (in/full)² stays 1 all the way through.
  expect((lobbyOut!.gain / mid.gains.lobby) ** 2 + (normalIn!.gain / mid.gains.normal) ** 2).toBeCloseTo(1, 1);
  // Once the fade is over the lobby voice is gone.
  await expect.poll(async () => (await audioState(page)).voices.map((v) => v.track), { timeout: 6_000 }).toEqual(['normal']);

  // Dialogue blabber while the intro types.
  await expect.poll(async () => (await audioState(page)).blip, { timeout: 5_000 }).toBeGreaterThan(3);

  // Stage 3 (through the store): finishing an objective plays the coin.
  await exposeStore(page);
  const coins0 = (await audioState(page)).coin;
  await page.evaluate(() => {
    const gameStore = (window as unknown as Win).__store;
    gameStore.getState().play(3);
    for (let i = 0; i < 50 && gameStore.getState().dialogue; i++) gameStore.getState().nextDialogue();
    gameStore.setState({ terminal: { host: 'web', log: [] } });
    gameStore.getState().command('server start');
  });
  await expect.poll(async () => (await audioState(page)).coin, { timeout: 5_000 }).toBe(coins0 + 1);
  expect((await audioState(page)).music).toBe('normal'); // a new stage keeps the in-stage loop going

  // An incident: a SHORT crossfade into the incident loop (from its top) and the alarm.
  await page.evaluate(() => {
    const gameStore = (window as unknown as Win).__store;
    // s3-port fires 10 stage seconds after the app is started: run the clock forward instead of waiting.
    const active = () => gameStore.getState().run?.scenarios.some((x) => x.state === 'active');
    for (let i = 0; i < 20 && !active(); i++) gameStore.getState().tick();
  });
  await expect.poll(async () => (await audioState(page)).alarm, { timeout: 10_000 }).toBeGreaterThan(0);
  const inc = await audioState(page);
  expect(inc.music).toBe('incident');
  expect(inc.fades.at(-1)).toMatchObject({ from: 'normal', to: 'incident', fadeIn: 0.3, fadeOut: 0.3 });
  expect(voice(inc, 'incident')!.pos).toBeLessThan(1.5);
  await expect.poll(async () => (await audioState(page)).voices.map((v) => v.track), { timeout: 2_000 }).toEqual(['incident']);
  await expect(page.locator('.hud').getByRole('button', { name: '소리' })).toBeVisible();

  // The fix: its card is new, so the coin first and the win jingle 0.5 s after it; a LONG fade back to the
  // normal loop, which picks up where it stopped.
  await page.evaluate(() => {
    const gameStore = (window as unknown as Win).__store;
    gameStore.setState({ terminal: { host: 'web', log: [] } });
    gameStore.getState().command('server set port 80');
  });
  await expect.poll(async () => (await audioState(page)).win, { timeout: 5_000 }).toBe(1);
  const fixed = await audioState(page);
  expect(fixed.coin).toBe(coins0 + 2);
  const coinAt = fixed.sfx.filter((x) => x.id === 'coin').at(-1)!.at;
  const winAt = fixed.sfx.filter((x) => x.id === 'win').at(-1)!.at;
  expect(winAt - coinAt).toBeGreaterThan(0.4);
  expect(winAt - coinAt).toBeLessThan(0.6);
  expect(fixed.music).toBe('normal');
  const back = fixed.fades.at(-1)!;
  expect(back).toMatchObject({ from: 'incident', to: 'normal' });
  expect(back.fadeIn).toBeGreaterThanOrEqual(2.5);
  expect(back.fadeIn).toBeLessThanOrEqual(3);
  expect(voice(fixed, 'incident')?.leaving).toBe(true);
  expect(voice(fixed, 'normal')!.pos).toBeGreaterThan(2); // resumed, not restarted
  // The jingle ducks the music while it plays.
  await expect.poll(async () => (await audioState(page)).duck, { timeout: 3_000 }).toBeLessThan(0.5);

  // Leaving the stage: a long crossfade to the lobby tune, which resumes too; the alarm cycle is over.
  await page.evaluate(() => {
    const gameStore = (window as unknown as Win).__store;
    gameStore.getState().goSelect();
  });
  const out = await audioState(page);
  expect(out.music).toBe('lobby');
  expect(out.fades.at(-1)).toMatchObject({ from: 'normal', to: 'lobby' });
  expect(out.fades.at(-1)!.fadeIn).toBeGreaterThanOrEqual(2.5);
  expect(voice(out, 'lobby')!.pos).toBeGreaterThan(1);
  const beeps = out.alarm;
  await page.waitForTimeout(4_000);
  expect((await audioState(page)).alarm).toBe(beeps);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('스테이지 클리어 결과 창과 엔딩 수료증에서 징글, 목표마다 코인 (같은 순간은 한 번)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);

  await page.goto('/');
  await page.evaluate(() => {
    localStorage.removeItem('khu-dc-audio');
    localStorage.removeItem('khu-dc-save-v1');
  });
  await page.reload();

  // Play stage 0 like a player: the start button, then the objectives (recorded as the UI records them).
  await page.getByRole('button', { name: /처음부터 시작/ }).click();
  await expect.poll(async () => (await audioState(page)).loaded.length).toBe(ALL_CLIPS.length);
  await expect.poll(async () => (await audioState(page)).music).toBe('normal');
  await exposeStore(page);
  const event = (...events: string[]) =>
    page.evaluate((ev) => {
      const gameStore = (window as unknown as Win).__store;
      for (let i = 0; i < 50 && gameStore.getState().dialogue; i++) gameStore.getState().nextDialogue();
      gameStore.getState().event(...ev);
    }, events);
  const coin = async () => (await audioState(page)).coin;
  /** One objective's worth of player actions, then its coin (cues closer than 0.15 s merge, so pause like a player). */
  const objective = async (coins: number, ...events: string[]) => {
    await event(...events);
    await expect.poll(coin).toBe(coins);
    await page.waitForTimeout(300);
  };

  await objective(1, 'open:dashboard');
  await objective(2, 'open:mentor');
  await objective(3, 'room:server', 'room:network', 'room:power', 'room:cooling', 'room:noc');
  // The quiz objective also gives a new card and clears the stage: one coin for all of it.
  await objective(4, 'quiz:correct');
  await page.waitForTimeout(300);
  expect(await coin()).toBe(4);
  expect((await audioState(page)).win).toBe(0); // objective cards don't jingle

  // The card, then the outro, with Enter as a player would; the clear popup brings the jingle.
  await expect(page.locator('.ccard')).toBeVisible();
  await page.keyboard.press('Enter');
  const clear = page.getByRole('heading', { name: 'Stage 0 클리어!' });
  for (let i = 0; i < 30 && !(await clear.isVisible()); i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  }
  await expect(clear).toBeVisible();
  await expect.poll(async () => (await audioState(page)).win, { timeout: 3_000 }).toBe(1);
  expect((await audioState(page)).music).toBe('normal');
  await expect.poll(async () => (await audioState(page)).duck, { timeout: 3_000 }).toBeLessThan(0.5);

  // The last stage's "next" opens the ending certificate (pressed soon, as a player in a hurry would): the lobby
  // tune comes back and the jingle plays once more, taking over from the clear popup's.
  const clearWin = (await audioState(page)).sfx.filter((x) => x.id === 'win').at(-1)!;
  await expect.poll(async () => (await audioState(page)).time, { timeout: 5_000, intervals: [50] }).toBeGreaterThan(clearWin.at + 1.1);
  await page.evaluate(() => {
    const gameStore = (window as unknown as Win).__store;
    const run = gameStore.getState().run!;
    gameStore.setState({ run: { ...run, stage: 7 } });
    gameStore.getState().finishResults('next');
  });
  await expect(page.getByRole('heading', { name: '수료증' })).toBeVisible();
  await expect.poll(async () => (await audioState(page)).win, { timeout: 3_000 }).toBe(2);
  const end = await audioState(page);
  expect(end.music).toBe('lobby');
  expect(end.fades.at(-1)).toMatchObject({ from: 'normal', to: 'lobby' });
  await expect.poll(async () => (await audioState(page)).duck, { timeout: 3_000 }).toBeLessThan(0.5);
  // One jingle at a time: the clear popup's, still going, fades out as the certificate's starts.
  const wins = end.sfx.filter((x) => x.id === 'win');
  expect(wins.at(-1)!.at - clearWin.at).toBeLessThan(1.8);
  expect(wins.at(-2)).toEqual({ id: 'win', at: clearWin.at, cutAt: wins.at(-1)!.at });
  // ...and only once.
  await page.waitForTimeout(1_500);
  expect((await audioState(page)).win).toBe(2);

  expect(errors, errors.join('\n')).toEqual([]);
});
