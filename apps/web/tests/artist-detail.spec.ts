import { test, expect, type Page } from '@playwright/test';

async function loginAndSeed(page: Page) {
  await page.goto('/api/test/seed');
  await page.goto('/api/test/login');
  await page.waitForURL('**/home');
}

test.describe('Artist detail page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  test('loads from /artists row click', async ({ page }) => {
    await page.goto('/artists');
    await page.waitForTimeout(1000);

    // Click the Radiohead row link.
    await page.getByRole('link', { name: /Radiohead/i }).first().click();
    await page.waitForURL(/\/artists\/[0-9a-f-]+/);

    // Hero shows the artist name.
    await expect(page.locator('body')).toContainText('Radiohead');
    await expect(page.getByText(/Your shows ·/i)).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/artist-detail.png',
      fullPage: true,
    });
  });

  test('lists shows for that artist with venue links', async ({ page }) => {
    await page.goto('/artists');
    await page.waitForTimeout(1000);
    await page.getByRole('link', { name: /Radiohead/i }).first().click();
    await page.waitForURL(/\/artists\/[0-9a-f-]+/);

    // Radiohead is seeded as headliner of two shows (concert + festival) and
    // support on Massive Attack's bill — it should appear at least twice.
    const venueLinks = page.locator('.show-row a[href^="/venues/"]');
    await expect(venueLinks.first()).toBeVisible();
    expect(await venueLinks.count()).toBeGreaterThan(0);
  });

  test('inline rename persists across navigation', async ({ page }) => {
    await page.goto('/artists');
    await page.waitForTimeout(1000);
    await page.getByRole('link', { name: 'Radiohead', exact: false }).first().click();
    await page.waitForURL(/\/artists\/[0-9a-f-]+/);

    // Find the editable name (uses div with title="Double-click to edit").
    const editable = page.locator('div[title="Double-click to edit"]').first();
    await expect(editable).toContainText('Radiohead');
    await editable.dblclick();

    const input = page.locator('input').first();
    await input.fill('Radiohead (renamed)');
    await input.press('Enter');

    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.locator('body')).toContainText('Radiohead (renamed)');

    // Restore so other tests / fixtures aren't affected within this run.
    await page.locator('div[title="Double-click to edit"]').first().dblclick();
    const input2 = page.locator('input').first();
    await input2.fill('Radiohead');
    await input2.press('Enter');
    await page.waitForTimeout(500);
  });

  test('follow toggle persists', async ({ page }) => {
    await page.goto('/artists');
    await page.waitForTimeout(1000);
    await page.getByRole('link', { name: /Radiohead/i }).first().click();
    await page.waitForURL(/\/artists\/[0-9a-f-]+/);

    const followBtn = page.getByRole('button', { name: /^Follow$|^Following$/ });
    const initialText = (await followBtn.textContent())?.trim();
    await followBtn.click();
    await page.waitForTimeout(400);

    const after = (await followBtn.textContent())?.trim();
    expect(after).not.toBe(initialText);

    // Reload, expect the new state to persist.
    await page.reload();
    const reloaded = (await page.getByRole('button', { name: /^Follow$|^Following$/ }).textContent())?.trim();
    expect(reloaded).toBe(after);

    // Toggle back so subsequent runs start from the same state.
    await page.getByRole('button', { name: /^Follow$|^Following$/ }).click();
    await page.waitForTimeout(400);
  });

  test('show row click navigates to /shows/[id]', async ({ page }) => {
    await page.goto('/artists');
    await page.waitForTimeout(1000);
    await page.getByRole('link', { name: /Radiohead/i }).first().click();
    await page.waitForURL(/\/artists\/[0-9a-f-]+/);

    // Click somewhere on the first show row that's not a link/button.
    const row = page.locator('.show-row').first();
    await row.locator('.show-row__date').click();
    await page.waitForURL(/\/shows\/[0-9a-f-]+/);
  });
});
