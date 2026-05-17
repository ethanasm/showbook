/**
 * Smoke screenshots for the ShowsListView + add/page decomposition.
 *
 * Captures each touched view-mode at three viewport widths so the
 * reviewer can verify no visual regressions:
 *   - mobile  (390 × 844)
 *   - tablet  (768 × 1024)
 *   - desktop (1440 × 900)
 *
 * Routes:
 *   - /upcoming and /logbook   — ShowsListView in both modes
 *   - /upcoming?view=calendar  — CalendarView (month + year sub-views)
 *   - /logbook?view=stats      — StatsView
 *   - /add                     — LivePreview right-panel
 *
 * Files are written under tests/screenshots/decompose/.
 */

import path from 'node:path';
import fs from 'node:fs';
import { test, type Page } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

const WIDTHS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

const OUT_DIR = path.resolve(__dirname, 'screenshots/decompose');

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

async function snap(page: Page, label: string) {
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w.width, height: w.height });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(OUT_DIR, `${label}.${w.name}.png`),
      fullPage: false,
    });
  }
}

test.describe('decompose smoke', () => {
  test('upcoming list', async ({ page }) => {
    await loginAndSeedAsWorker(page);
    await page.goto('/upcoming');
    await snap(page, 'upcoming-list');
  });

  test('logbook list', async ({ page }) => {
    await loginAndSeedAsWorker(page);
    await page.goto('/logbook');
    await snap(page, 'logbook-list');
  });

  test('logbook calendar (month view)', async ({ page }) => {
    await loginAndSeedAsWorker(page);
    await page.goto('/logbook');
    // Switch to calendar view via the toolbar button. The button text
    // is the lowercased mode name.
    const calBtn = page.getByRole('button', { name: /^Calendar\b/ });
    await calBtn.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await snap(page, 'logbook-calendar-month');
  });

  test('logbook calendar (year view)', async ({ page }) => {
    await loginAndSeedAsWorker(page);
    await page.goto('/logbook');
    await page.getByRole('button', { name: /^Calendar\b/ }).click();
    // Inside the calendar, the year sub-view is the "YEAR" button in the toggle.
    await page.locator('[data-testid="cal-view-year"]').click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await snap(page, 'logbook-calendar-year');
  });

  test('logbook stats', async ({ page }) => {
    await loginAndSeedAsWorker(page);
    await page.goto('/logbook');
    await page.getByRole('button', { name: /^Stats\b/ }).click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await snap(page, 'logbook-stats');
  });

  test('add form (LivePreview right panel)', async ({ page }) => {
    await loginAndSeedAsWorker(page);
    await page.goto('/add');
    await snap(page, 'add-form');
  });
});
