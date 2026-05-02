import { test, expect, type Page } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

async function loginAndSeed(page: Page) {
  await loginAndSeedAsWorker(page);
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
    // Wait for the keyboard handler in GlobalSearch.tsx to register before
    // dispatching the ⌘K. networkidle alone wasn't enough — the listener
    // registers in a useEffect that runs after first paint.
    await page.waitForLoadState('networkidle');
    await page.getByTestId('global-search-trigger').or(page.locator('body')).first().waitFor();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByTestId('global-search-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('global-search-panel')).toHaveCount(0);
  });

  // The floating "global-search-trigger" button is mobile-only — its CSS
  // has display:none above 767px and inline-flex below. Run this on mobile
  // viewports only; on desktop the sidebar's search row exposes the modal.
  test('floating trigger opens the modal (mobile only)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Trigger is mobile-only');
    await page.goto('/home');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('global-search-trigger').click();
    await expect(page.getByTestId('global-search-panel')).toBeVisible();
  });
});
