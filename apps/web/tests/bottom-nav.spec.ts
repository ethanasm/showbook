import { test, expect, type Page } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

async function loginSeeded(page: Page) {
  await loginAndSeedAsWorker(page);
}

// Bottom bar is only visible on mobile (<768px). Use the mobile project.
test.describe('Bottom nav — mobile viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await loginSeeded(page);
  });

  test('center + button navigates to /add directly', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /^Add a show$/i });
    await expect(addBtn).toBeVisible({ timeout: 8000 });

    await addBtn.click();
    await page.waitForURL('**/add', { timeout: 8000 });
  });

  test('Discover tab navigates to /discover', async ({ page }) => {
    const discoverBtn = page.getByRole('button', { name: /^Discover$/i });
    await expect(discoverBtn).toBeVisible({ timeout: 8000 });
    await discoverBtn.click();
    await page.waitForURL('**/discover', { timeout: 8000 });
  });

  test('Shows tab navigates to /upcoming', async ({ page }) => {
    const showsBtn = page.getByRole('button', { name: /^Shows$/i });
    await expect(showsBtn).toBeVisible({ timeout: 8000 });
    await showsBtn.click();
    await page.waitForURL('**/upcoming', { timeout: 8000 });
  });

  test('right-most Me tab navigates to /preferences not /me', async ({ page }) => {
    // The Me tab in the bottom bar should navigate to /preferences
    const meTab = page.getByRole('button', { name: /^Me$/i });
    await expect(meTab).toBeVisible({ timeout: 8000 });
    await meTab.click();
    await page.waitForURL('**/preferences', { timeout: 8000 });
    // Sanity: should not be /me
    expect(page.url()).not.toContain('/me');
  });
});
