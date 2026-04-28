import { test, expect, type Page } from '@playwright/test';

async function loginAndSeed(page: Page) {
  await page.goto('/api/test/seed');
  await page.goto('/api/test/login');
  await page.waitForURL('**/home');
}

test.describe('Global search', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  test('opens with ⌘K and finds shows, artists, venues', async ({ page }) => {
    await page.goto('/home');
    await page.waitForLoadState('networkidle');

    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByTestId('global-search-panel')).toBeVisible();

    await page.getByTestId('global-search-input').fill('madison');
    await expect(page.getByTestId('global-search-result-venue').first()).toBeVisible({ timeout: 5000 });

    // Clear and search for an artist
    await page.getByTestId('global-search-input').fill('radio');
    await expect(page.getByTestId('global-search-result-performer').first()).toBeVisible({ timeout: 5000 });
  });

  test('clicking a show result navigates to /shows/[id]', async ({ page }) => {
    await page.goto('/home');
    await page.waitForLoadState('networkidle');

    await page.keyboard.press('ControlOrMeta+k');
    await page.getByTestId('global-search-input').fill('radiohead');
    await page.getByTestId('global-search-result-show').first().waitFor({ state: 'visible' });
    await page.getByTestId('global-search-result-show').first().click();
    await page.waitForURL(/\/shows\/[0-9a-f-]+/);
  });

  test('Escape closes the modal', async ({ page }) => {
    await page.goto('/home');
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByTestId('global-search-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('global-search-panel')).toHaveCount(0);
  });

  test('floating trigger opens the modal', async ({ page }) => {
    await page.goto('/home');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('global-search-trigger').click();
    await expect(page.getByTestId('global-search-panel')).toBeVisible();
  });
});
