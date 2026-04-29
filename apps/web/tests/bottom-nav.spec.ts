import { test, expect, type Page } from '@playwright/test';

async function loginSeeded(page: Page) {
  await page.goto('/api/test/seed');
  await page.goto('/api/test/login');
  await page.waitForURL('**/home', { timeout: 10000 });
}

// Bottom bar is only visible on mobile (<768px). Use the mobile project.
test.describe('Bottom nav — mobile viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await loginSeeded(page);
  });

  test('center + button opens popover with five entries', async ({ page }) => {
    // Locate the Add button by its aria-label
    const addBtn = page.getByRole('button', { name: /^Add$/i });
    await expect(addBtn).toBeVisible({ timeout: 8000 });

    await addBtn.click();

    // Popover should appear with all five entries
    await expect(page.getByRole('menuitem', { name: 'Add a show' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Discover' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Venues' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Artists' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Map' })).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/bottom-nav-add-popover.png',
      fullPage: true,
    });
  });

  test('clicking Discover in popover navigates to /discover', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /^Add$/i });
    await addBtn.click();

    await page.getByRole('menuitem', { name: 'Discover' }).click();
    await page.waitForURL('**/discover', { timeout: 8000 });
  });

  test('popover dismisses on Escape', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /^Add$/i });
    await addBtn.click();
    await expect(page.getByRole('menuitem', { name: 'Discover' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: 'Discover' })).not.toBeVisible();
  });

  test('popover dismisses on outside click', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /^Add$/i });
    await addBtn.click();
    await expect(page.getByRole('menuitem', { name: 'Discover' })).toBeVisible();

    // Click on a safe area outside the popover
    await page.mouse.click(5, 5);
    await expect(page.getByRole('menuitem', { name: 'Discover' })).not.toBeVisible();
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
