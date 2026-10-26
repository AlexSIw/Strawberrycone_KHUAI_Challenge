// Smoke test: start a new game, get through the briefing, walk a little, open the NOC (all three tabs)
// and the concept book, and make sure nothing logs an error. Then "D-Day 바로 체험" from the title.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { getStage } from '../src/content/stages';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Short, distinctive prefixes of a day's briefing lines. */
const introRe = (day: 0 | 5) => new RegExp(getStage(day).intro.map((l) => escapeRe(l.text.slice(0, 12).trim())).join('|'));

/**
 * The briefing dialogue box (role="dialog") showing any of its lines. Matching on the box rather than on
 * the visible text is deliberate: while the typewriter is still at the start of a line, the text sits
 * in a visibility:hidden span, but the box itself is on screen the whole time.
 */
const introDialog = (page: Page, day: 0 | 5): Locator => page.getByRole('dialog').filter({ hasText: introRe(day) });

/** ModalFrame windows (NOC, concept book, terminal, …). */
const modal = (page: Page): Locator => page.locator('.modal-backdrop .modal');

async function holdKey(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

/** Presses Enter until the cards on screen (a card ignores keys in its first 0.3 s) are gone. */
async function enterAwayCards(page: Page): Promise<void> {
  const card = page.locator('.ccard-backdrop');
  for (let i = 0; i < 8 && (await card.count()) > 0; i++) {
    await page.waitForTimeout(350);
    await page.keyboard.press('Enter');
  }
  await expect(card).toHaveCount(0);
}

/**
 * Press Enter (sometimes click the box) until the briefing is gone, then read the first missions' 미션 브리핑
 * away. A day started cold opens with its "지금까지" recap first: Enter goes on to the briefing.
 */
async function skipBriefing(page: Page, day: 0 | 5, recap = false): Promise<void> {
  if (recap) {
    await expect(page.locator('.rcp')).toBeVisible();
    await page.waitForTimeout(350);
    await page.keyboard.press('Enter');
    await expect(page.locator('.rcp')).toHaveCount(0);
  }
  const box = introDialog(page, day);
  await expect(box).toBeVisible();
  const lines = getStage(day).intro.length;
  for (let i = 0; i < lines * 4 + 4 && (await box.count()) > 0; i++) {
    if (i % 3 === 2) await box.click({ timeout: 1_000 }).catch(() => {});
    else await page.keyboard.press('Enter');
    await page.waitForTimeout(350);
  }
  await expect(box).toHaveCount(0);
  await enterAwayCards(page);
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

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/** N opens the NOC (the 관제 화면). */
async function openNoc(page: Page): Promise<void> {
  await page.keyboard.press('n');
  await expect(modal(page)).toBeVisible();
}

test('새로 시작 → 브리핑 → 이동 → 관제 화면(NMS/SMS/FMS) → 개념 도감, 콘솔 에러 없음', async ({ page }, testInfo) => {
  const errors = collectErrors(page);

  await page.goto('/');
  await page.getByRole('button', { name: /새로 시작/ }).click();
  await skipBriefing(page, 0);

  // The Phaser world is up: walk right, then up.
  await expect(page.locator('canvas').first()).toBeVisible();
  await holdKey(page, 'ArrowRight', 800);
  await holdKey(page, 'ArrowUp', 800);
  await expect(page.locator('.hud')).toContainText('D-5');
  await page.screenshot({ path: testInfo.outputPath('01-walk.png') });

  // C opens the concept book.
  await page.keyboard.press('c');
  await expect(modal(page)).toBeVisible();
  await expectFitsViewport(page, modal(page));
  await page.screenshot({ path: testInfo.outputPath('02-concepts.png') });
  await page.keyboard.press('Escape');
  await expect(modal(page)).toHaveCount(0);

  // The NOC opens on its NMS tab: alarm list, topology map; a device opens its detail pane.
  await openNoc(page);
  await expect(page.getByRole('tab', { name: /NMS/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.nms-map')).toBeVisible();
  await page.locator('.nms-node', { hasText: 'TOR-01' }).click();
  await expect(page.locator('.nms-dev h3')).toHaveText('TOR-01');
  await expectFitsViewport(page, modal(page));
  await page.screenshot({ path: testInfo.outputPath('03-noc-nms.png') });

  await page.getByRole('tab', { name: /SMS/ }).click();
  await expect(page.getByRole('tab', { name: /SMS/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: /DHCP/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('04-noc-sms.png') });

  await page.getByRole('tab', { name: /FMS/ }).click();
  await expect(page.getByRole('button', { name: /시설팀 통보/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('05-noc-fms.png') });
  await page.keyboard.press('Escape');
  await expect(modal(page)).toHaveCount(0);

  // The NOC on a Full HD screen.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openNoc(page);
  await page.getByRole('tab', { name: /NMS/ }).click();
  await expectFitsViewport(page, modal(page));
  await page.screenshot({ path: testInfo.outputPath('06-noc-1080p.png') });
  await page.keyboard.press('Escape');
  await expect(modal(page)).toHaveCount(0);

  // The hotkeys: N toggles the NOC, Tab too.
  await page.keyboard.press('n');
  await expect(modal(page)).toBeVisible();
  await page.keyboard.press('n');
  await expect(modal(page)).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(modal(page)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(modal(page)).toHaveCount(0);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('타이틀 → D-Day 바로 체험 → HUD에 D-Day', async ({ page }, testInfo) => {
  const errors = collectErrors(page);

  await page.goto('/');
  await page.getByRole('button', { name: /D-Day 바로 체험/ }).click();
  await expect(page.locator('.hud')).toContainText('D-Day');
  // Nothing before D-Day is cleared: the "지금까지" recap comes before the briefing.
  await expect(page.locator('.rcp h2')).toHaveText(/지금까지/);
  await skipBriefing(page, 5, true);
  await expect(page.locator('.hud')).toContainText(/D-Day/);
  await expect(page.locator('.hud-time')).toHaveText(/^\d{2}:\d{2}:\d{2}/);
  await page.screenshot({ path: testInfo.outputPath('08-dday.png') });

  // The calendar opens every day.
  await page.getByRole('button', { name: /나가기/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: '나가기' }).click();
  await expect(page.getByRole('heading', { name: /달력/ })).toBeVisible();
  await expect(page.locator('.sel-card')).toHaveCount(6);
  await page.screenshot({ path: testInfo.outputPath('09-calendar.png') });

  expect(errors, errors.join('\n')).toEqual([]);
});
