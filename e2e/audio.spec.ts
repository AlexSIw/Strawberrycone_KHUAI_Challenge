// Sound: credits window, mute toggle (button, M, saved setting), and the audio engine following the
// game — normal loop, incident loop + alarm, win jingle. Reads the engine through its dev hook.
import { expect, test, type Page } from '@playwright/test';

type AudioState = { context: string; music: string | null; muted: boolean; loaded: string[]; failed: string[]; alarm: number; win: number; blip: number };

const audioState = (page: Page) => page.evaluate(() => (window as never as { __khuAudio: { debugState(): AudioState } }).__khuAudio.debugState());

test('크레딧 · 소리 켜기/끄기 · 배경음/경보/효과음, 콘솔 에러 없음', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });

  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('khu-dc-audio'));
  await page.reload();

  // Nothing starts before the player does something.
  expect((await audioState(page)).context).toBe('none');

  // Credits window: opens from the corner, Esc closes it.
  await page.getByRole('button', { name: '크레딧' }).click();
  const credits = page.locator('.modal').filter({ hasText: '크레딧' });
  await expect(credits).toBeVisible();
  for (const text of ['Eric Matyas', 'www.soundimage.org', 'Hupple', 'Short alarm', 'Win Jingle', 'Josh Simmons', 'CC BY 4.0', 'Galmuri', 'SIL Open Font License']) {
    await expect(credits).toContainText(text);
  }
  await expect(credits.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
  await page.keyboard.press('Escape');
  await expect(credits).toHaveCount(0);
  await expect(page.getByRole('button', { name: /처음부터 시작/ })).toBeVisible();

  // That click unlocked audio: the normal loop plays and every file decoded.
  await expect.poll(async () => (await audioState(page)).music).toBe('normal');
  const s0 = await audioState(page);
  expect(s0.context).toBe('running');
  expect(s0.failed).toEqual([]);
  expect(s0.loaded.sort()).toEqual(['alarm', 'incident', 'normal', 'voice', 'win']);

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

  // Dialogue blabber while the intro types.
  await page.getByRole('button', { name: /처음부터 시작/ }).click();
  await expect.poll(async () => (await audioState(page)).blip, { timeout: 5_000 }).toBeGreaterThan(3);

  // Stage 3: an incident switches to the incident loop and sounds the alarm; fixing it plays the jingle.
  await page.evaluate(async () => {
    const { gameStore } = (await import(/* @vite-ignore */ '/src/store/game.ts' as string)) as typeof import('../src/store/game');
    const s = gameStore.getState();
    s.play(3);
    for (let i = 0; i < 50 && gameStore.getState().dialogue; i++) gameStore.getState().nextDialogue();
    gameStore.setState({ terminal: { host: 'web', log: [] } });
    gameStore.getState().command('server start');
  });
  await expect.poll(async () => (await audioState(page)).alarm, { timeout: 10_000 }).toBeGreaterThan(0);
  expect((await audioState(page)).music).toBe('incident');
  await expect(page.locator('.hud').getByRole('button', { name: '소리' })).toBeVisible();

  await page.evaluate(async () => {
    const { gameStore } = (await import(/* @vite-ignore */ '/src/store/game.ts' as string)) as typeof import('../src/store/game');
    gameStore.setState({ terminal: { host: 'web', log: [] } });
    gameStore.getState().command('server set port 80');
  });
  await expect.poll(async () => (await audioState(page)).win, { timeout: 5_000 }).toBe(1);
  expect((await audioState(page)).music).toBe('normal');

  // The fix (and leaving the stage) stopped the alarm cycle: no more beeps.
  await page.evaluate(async () => {
    const { gameStore } = (await import(/* @vite-ignore */ '/src/store/game.ts' as string)) as typeof import('../src/store/game');
    gameStore.getState().goSelect();
  });
  const beeps = (await audioState(page)).alarm;
  await page.waitForTimeout(4_000);
  expect((await audioState(page)).alarm).toBe(beeps);

  expect(errors, errors.join('\n')).toEqual([]);
});
