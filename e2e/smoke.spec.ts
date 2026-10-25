// Smoke test: start a new game, get through the intro, walk a little,
// open/close the dashboard and the concept book, and make sure nothing logs an error.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { getStage } from '../src/content/stages';

const stage0 = getStage(0);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Short, distinctive prefixes of the D-5 briefing lines. */
const INTRO = stage0.intro.map((l) => l.text.slice(0, 12).trim());
const INTRO_RE = new RegExp(INTRO.map(escapeRe).join('|'));

/**
 * The intro dialogue box (role="dialog") showing any intro line. Matching on the box rather than on
 * the visible text is deliberate: while the typewriter is still at the start of a line, the text sits
 * in a visibility:hidden span, but the box itself is on screen the whole time.
 */
const introDialog = (page: Page): Locator => page.getByRole('dialog').filter({ hasText: INTRO_RE });

/** ModalFrame windows (dashboard, concept book, terminal, …). */
const modal = (page: Page): Locator => page.locator('.modal-backdrop .modal');

async function holdKey(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

/** The open window is fully on screen and the page itself never scrolls. */
async function expectFitsViewport(page: Page, what: Locator): Promise<void> {
  const vp = page.viewportSize();
  const box = await what.boundingBox();
  expect(vp && box, 'window has a size').toBeTruthy();
  if (!vp || !box) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
  const scroll = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  expect(scroll.w, 'no horizontal page scroll').toBeLessThanOrEqual(vp.width + 1);
  expect(scroll.h, 'no vertical page scroll').toBeLessThanOrEqual(vp.height + 1);
}

test('처음부터 시작 → 인트로 → 이동 → 대시보드 → 개념 도감, 콘솔 에러 없음', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });

  await page.goto('/');
  await page.getByRole('button', { name: /처음부터 시작/ }).click();

  // Intro dialogue: wait for the box, then press Enter (sometimes click it) until it is gone.
  // Each line needs up to two presses: one finishes the typewriter, the next goes to the next line.
  await expect(introDialog(page)).toBeVisible();
  for (let i = 0; i < INTRO.length * 4 && (await introDialog(page).count()) > 0; i++) {
    if (i % 3 === 2) await introDialog(page).click({ timeout: 1_000 }).catch(() => {});
    else await page.keyboard.press('Enter');
    await page.waitForTimeout(350);
  }
  await expect(introDialog(page)).toHaveCount(0);

  // The Phaser world is up: walk right, then up.
  await expect(page.locator('canvas').first()).toBeVisible();
  await holdKey(page, 'ArrowRight', 800);
  await holdKey(page, 'ArrowUp', 800);
  await page.screenshot({ path: testInfo.outputPath('01-walk.png') });

  // Tab opens the dashboard, Escape closes it.
  await page.keyboard.press('Tab');
  await expect(modal(page)).toBeVisible();
  await expectFitsViewport(page, modal(page));
  await page.screenshot({ path: testInfo.outputPath('02-dashboard.png') });
  await page.keyboard.press('Escape');
  await expect(modal(page)).toHaveCount(0);

  // C opens the concept book.
  await page.keyboard.press('c');
  await expect(modal(page)).toBeVisible();
  await expectFitsViewport(page, modal(page));
  await page.screenshot({ path: testInfo.outputPath('03-concepts.png') });
  await page.keyboard.press('Escape');
  await expect(modal(page)).toHaveCount(0);

  // Same dashboard on a Full HD screen.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.keyboard.press('Tab');
  await expect(modal(page)).toBeVisible();
  await expectFitsViewport(page, modal(page));
  await page.screenshot({ path: testInfo.outputPath('04-dashboard-1080p.png') });
  await page.keyboard.press('Escape');
  await expect(modal(page)).toHaveCount(0);

  expect(errors, errors.join('\n')).toEqual([]);
});
