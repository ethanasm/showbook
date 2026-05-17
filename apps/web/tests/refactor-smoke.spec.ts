/**
 * Smoke screenshots for the refactor-ui-components branch.
 *
 * Captures the routes touched by the refactors at three viewport
 * widths so reviewers can verify no visual regressions:
 *
 *   - mobile  (390 × 844)
 *   - tablet  (768 × 1024)
 *   - desktop (1440 × 900)
 *
 * Routes:
 *   - /home              — unrelated, sanity check
 *   - /logbook           — shows list
 *   - /artists           — artists list
 *   - /artists/<id>      — uses the migrated QueryBoundary
 *   - /venues/<id>       — uses the migrated QueryBoundary
 *   - /discover          — decomposed View
 *   - /preferences       — uses usePlaceSearch (AddRegionForm)
 *
 * Files are written under tests/screenshots/refactor/.
 */

import path from 'node:path';
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

const WIDTHS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

const OUT_DIR = path.resolve(__dirname, 'screenshots/refactor');

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

async function snap(page: import('@playwright/test').Page, route: string, label: string) {
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w.width, height: w.height });
    await page.goto(route);
    // Give layout + lazy content (RemoteImage, tRPC queries) a tick.
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(400);
    const file = path.join(OUT_DIR, `${label}.${w.name}.png`);
    await page.screenshot({ path: file, fullPage: false });
  }
}

test.describe('refactor smoke', () => {
  test('home', async ({ page }) => {
    await loginAndSeedAsWorker(page);
    await snap(page, '/home', 'home');
  });

  test('logbook (shows list)', async ({ page }) => {
    await loginAndSeedAsWorker(page);
    await snap(page, '/logbook', 'logbook');
  });

  test('artists list', async ({ page }) => {
    await loginAndSeedAsWorker(page);
    await snap(page, '/artists', 'artists-list');
  });

  test('artist detail (QueryBoundary migration)', async ({ page }) => {
    await loginAndSeedAsWorker(page);
    await page.goto('/artists');
    // First artist row — the seed data is deterministic per worker.
    const firstLink = page.locator('a[href^="/artists/"]').first();
    await firstLink.waitFor({ state: 'visible' });
    const href = await firstLink.getAttribute('href');
    expect(href).toBeTruthy();
    await snap(page, href!, 'artist-detail');
  });

  test('venues list', async ({ page }) => {
    await loginAndSeedAsWorker(page);
    await snap(page, '/venues', 'venues-list');
  });

  test('venue detail (QueryBoundary migration)', async ({ page }) => {
    await loginAndSeedAsWorker(page);
    await page.goto('/venues');
    const firstLink = page.locator('a[href^="/venues/"]').first();
    await firstLink.waitFor({ state: 'visible' });
    const href = await firstLink.getAttribute('href');
    expect(href).toBeTruthy();
    await snap(page, href!, 'venue-detail');
  });

  test('discover (decomposed)', async ({ page }) => {
    await loginAndSeedAsWorker(page);
    await snap(page, '/discover', 'discover');
  });

  test('preferences (usePlaceSearch migration)', async ({ page }) => {
    await loginAndSeedAsWorker(page);
    await snap(page, '/preferences', 'preferences');
  });
});
