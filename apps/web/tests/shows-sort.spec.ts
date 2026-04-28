import { test, expect, type Page } from '@playwright/test';

async function loginAndSeed(page: Page) {
  await page.goto('/api/test/seed');
  await page.goto('/api/test/login');
  await page.waitForURL('**/home');
}

async function getRowHeadliners(page: Page): Promise<string[]> {
  return await page.locator('.show-row__headliner').allTextContents();
}

test.describe('Shows table sortable columns', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  test('date column is sorted desc by default and toggles asc', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForSelector('.show-row', { timeout: 10000 });

    const dateHeader = page.getByTestId('sort-header-date');
    await expect(dateHeader).toHaveAttribute('data-sort-active', 'desc');

    await dateHeader.click();
    await expect(dateHeader).toHaveAttribute('data-sort-active', 'asc');

    await dateHeader.click();
    await expect(dateHeader).toHaveAttribute('data-sort-active', 'desc');
  });

  test('clicking headliner header sorts alphabetically', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForSelector('.show-row', { timeout: 10000 });

    await page.getByTestId('sort-header-headliner').click();
    await expect(page.getByTestId('sort-header-headliner')).toHaveAttribute('data-sort-active', 'asc');

    const headliners = await getRowHeadliners(page);
    const sorted = [...headliners].sort((a, b) => a.localeCompare(b));
    expect(headliners).toEqual(sorted);
  });

  test('clicking venue header sorts alphabetically', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForSelector('.show-row', { timeout: 10000 });

    await page.getByTestId('sort-header-venue').click();
    await expect(page.getByTestId('sort-header-venue')).toHaveAttribute('data-sort-active', 'asc');
  });

  test('clicking paid header sorts numerically descending by default', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForSelector('.show-row', { timeout: 10000 });

    await page.getByTestId('sort-header-paid').click();
    await expect(page.getByTestId('sort-header-paid')).toHaveAttribute('data-sort-active', 'desc');
  });

  test('reset on reload (no persistence)', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForSelector('.show-row', { timeout: 10000 });

    await page.getByTestId('sort-header-venue').click();
    await expect(page.getByTestId('sort-header-venue')).toHaveAttribute('data-sort-active', 'asc');

    await page.reload();
    await page.waitForSelector('.show-row', { timeout: 10000 });
    await expect(page.getByTestId('sort-header-date')).toHaveAttribute('data-sort-active', 'desc');
    await expect(page.getByTestId('sort-header-venue')).not.toHaveAttribute('data-sort-active', 'asc');
  });
});
