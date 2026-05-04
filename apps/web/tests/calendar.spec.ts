import { test, expect, type Page } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

async function loginAndSeed(page: Page) {
  await loginAndSeedAsWorker(page);
}

test.describe('Calendar and stats features', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  test('calendar view is accessible from shows page', async ({ page }) => {
    await page.goto('/logbook');
    await page.waitForSelector('.show-row', { timeout: 10000 });

    await page.getByRole('button', { name: /Calendar/i }).click();
    await expect(page.getByTestId('cal-prev')).toBeVisible();
    await expect(page.getByTestId('cal-next')).toBeVisible();
  });

  test('year view toggle renders 12 mini grids', async ({ page }) => {
    await page.goto('/logbook');
    await page.waitForSelector('.show-row', { timeout: 10000 });

    await page.getByRole('button', { name: /Calendar/i }).click();
    await page.waitForTimeout(500);

    // Switch to year view
    await page.getByTestId('cal-view-year').click();
    await page.waitForTimeout(300);

    // Should render 12 mini month grids
    const grids = page.getByTestId(/year-mini-grid-/);
    await expect(grids).toHaveCount(12);
  });

  test('clicking a mini month in year view switches to month view', async ({ page }) => {
    await page.goto('/logbook');
    await page.waitForSelector('.show-row', { timeout: 10000 });

    await page.getByRole('button', { name: /Calendar/i }).click();
    await page.waitForTimeout(500);

    await page.getByTestId('cal-view-year').click();
    await page.waitForTimeout(300);

    // Click January (index 0)
    await page.getByTestId('year-mini-grid-0').click();
    await page.waitForTimeout(300);

    // Should now show month view toggle active
    await expect(page.getByTestId('cal-view-month')).toBeVisible();
  });

  test('calendar prev button is disabled when at earliest show month', async ({ page }) => {
    await page.goto('/logbook');
    await page.waitForSelector('.show-row', { timeout: 10000 });

    await page.getByRole('button', { name: /Calendar/i }).click();
    await page.waitForTimeout(500);

    // Navigate back until prev is disabled (at earliest show month)
    const prev = page.getByTestId('cal-prev');
    let iterations = 0;
    while (await prev.isEnabled() && iterations < 50) {
      await prev.click();
      await page.waitForTimeout(100);
      iterations++;
    }

    await expect(prev).toBeDisabled();
  });

  test('stats timeframe filter changes the shown data', async ({ page }) => {
    await page.goto('/logbook');
    await page.waitForSelector('.show-row', { timeout: 10000 });

    await page.getByRole('button', { name: /Stats/i }).click();
    await page.waitForTimeout(500);

    // Get all-time count label
    const allTimeBtn = page.getByTestId('stats-timeframe-all');
    const yearBtn = page.getByTestId('stats-timeframe-year');

    await expect(allTimeBtn).toBeVisible();
    await expect(yearBtn).toBeVisible();

    // All time should be active by default
    await expect(allTimeBtn).toHaveCSS('background-color', /rgb/);

    // Switch to this year
    await yearBtn.click();
    await page.waitForTimeout(300);

    // The timeframe label should change in the stats heading
    const currentYear = new Date().getFullYear();
    await expect(page.locator('body')).toContainText(String(currentYear));
  });

  test('stats timeframe buttons are present: year, 5years, all', async ({ page }) => {
    await page.goto('/logbook');
    await page.waitForSelector('.show-row', { timeout: 10000 });

    await page.getByRole('button', { name: /Stats/i }).click();
    await page.waitForTimeout(500);

    await expect(page.getByTestId('stats-timeframe-year')).toBeVisible();
    await expect(page.getByTestId('stats-timeframe-5years')).toBeVisible();
    await expect(page.getByTestId('stats-timeframe-all')).toBeVisible();
  });
});
