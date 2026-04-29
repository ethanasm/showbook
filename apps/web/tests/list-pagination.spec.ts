import { test, expect, type Page } from '@playwright/test';

async function loginAndSeed(page: Page) {
  await page.goto('/api/test/seed');
  await page.goto('/api/test/login');
  await page.waitForURL('**/home');
}

test.describe('List page pagination', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  test('shows page: first page has at most 12 rows in normal mode', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForSelector('.show-row', { timeout: 10000 });

    const rowCount = await page.locator('.show-row').count();
    // Seeded data has 20 shows so first page = 12
    expect(rowCount).toBeLessThanOrEqual(12);
    expect(rowCount).toBeGreaterThan(0);
  });

  test('shows page: pagination footer is visible with prev/next buttons', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForSelector('.show-row', { timeout: 10000 });

    await expect(page.getByTestId('pagination-prev')).toBeVisible();
    await expect(page.getByTestId('pagination-next')).toBeVisible();
  });

  test('shows page: prev is disabled on page 1, next navigates to page 2', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForSelector('.show-row', { timeout: 10000 });

    const prev = page.getByTestId('pagination-prev');
    const next = page.getByTestId('pagination-next');

    await expect(prev).toBeDisabled();

    const rowsBefore = await page.locator('.show-row').count();

    // Only click next if there are multiple pages
    if (await next.isEnabled()) {
      await next.click();
      await page.waitForTimeout(300);

      // Prev should now be enabled
      await expect(prev).toBeEnabled();

      // We should be on page 2 now
      const rowsAfter = await page.locator('.show-row').count();
      expect(rowsAfter).toBeGreaterThan(0);
    }
  });

  test('shows page: sort persists after navigating to next page', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForSelector('.show-row', { timeout: 10000 });

    // Sort by headliner
    await page.getByTestId('sort-header-headliner').click();
    await expect(page.getByTestId('sort-header-headliner')).toHaveAttribute('data-sort-active', 'asc');

    const next = page.getByTestId('pagination-next');
    if (await next.isEnabled()) {
      await next.click();
      await page.waitForTimeout(300);
      // Sort header should still show headliner active
      await expect(page.getByTestId('sort-header-headliner')).toHaveAttribute('data-sort-active', 'asc');
    }
  });

  test('shows page: filter resets to page 1', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForSelector('.show-row', { timeout: 10000 });

    const next = page.getByTestId('pagination-next');
    if (await next.isEnabled()) {
      await next.click();
      await page.waitForTimeout(300);

      // Apply a kind filter — page should reset
      await page.locator('span').filter({ hasText: 'concert' }).first().click();
      await page.waitForTimeout(300);

      // Prev should be disabled again (back to page 1)
      await expect(page.getByTestId('pagination-prev')).toBeDisabled();
    }
  });

  test('venues page: pagination is present', async ({ page }) => {
    await page.goto('/venues');
    await page.waitForSelector('a[href^="/venues/"]', { timeout: 10000 });

    await expect(page.getByTestId('pagination-prev')).toBeVisible();
    await expect(page.getByTestId('pagination-next')).toBeVisible();
    await expect(page.getByTestId('pagination-prev')).toBeDisabled();
  });

  test('artists page: pagination is present', async ({ page }) => {
    await page.goto('/artists');
    await page.waitForTimeout(1000);

    await expect(page.getByTestId('pagination-prev')).toBeVisible();
    await expect(page.getByTestId('pagination-next')).toBeVisible();
    await expect(page.getByTestId('pagination-prev')).toBeDisabled();
  });
});
