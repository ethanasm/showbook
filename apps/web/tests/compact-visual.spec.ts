import { test, expect, type Page } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

// Captures screenshots of every list-bearing page in both loose and compact
// modes so a human can eyeball that nothing looks broken.

async function login(page: Page) {
  await loginAndSeedAsWorker(page);
}

async function setCompact(page: Page, on: boolean) {
  await page.goto('/preferences');
  const row = page.locator('div').filter({ hasText: /^Compact mode/ }).first();
  const toggle = row.getByRole('switch');
  const current = await toggle.getAttribute('aria-checked');
  if ((current === 'true') !== on) {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', on ? 'true' : 'false');
  }
}

const PAGES = ['/home', '/upcoming', '/logbook', '/venues', '/artists', '/discover', '/preferences'];

test('capture loose vs compact for every list page', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await setCompact(page, false);
  for (const p of PAGES) {
    await page.goto(p);
    await page.waitForLoadState('domcontentloaded');
    const slug = p.replace(/^\//, '') || 'home';
    await page.screenshot({
      path: `test-results/screenshots/compact-loose-${slug}.png`,
      fullPage: true,
    });
  }
  await setCompact(page, true);
  for (const p of PAGES) {
    await page.goto(p);
    await page.waitForLoadState('domcontentloaded');
    const slug = p.replace(/^\//, '') || 'home';
    await page.screenshot({
      path: `test-results/screenshots/compact-on-${slug}.png`,
      fullPage: true,
    });
  }
  await setCompact(page, false);
});
