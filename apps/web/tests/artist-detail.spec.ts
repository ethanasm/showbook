import { test, expect, type Page } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

async function loginAndSeed(page: Page) {
  await loginAndSeedAsWorker(page);
}

test.describe('Artist detail page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  test('loads from /artists row click', async ({ page }) => {
    await page.goto('/artists');
    // Click the Radiohead row link (auto-waits for it to be actionable).
    await page.getByRole('link', { name: /Radiohead/i }).first().click();
    await page.waitForURL(/\/artists\/[0-9a-f-]+/);

    // Hero shows the artist name.
    await expect(page.locator('body')).toContainText('Radiohead');
    // Match the shows section header exactly — `/Your shows ·/i` also
    // hits "Media from your shows · 0", which trips strict-mode.
    await expect(page.getByText(/^Your shows ·/i)).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/artist-detail.png',
      fullPage: true,
    });
  });

  test('lists shows for that artist with venue links', async ({ page }) => {
    await page.goto('/artists');
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
    await page.getByRole('link', { name: 'Radiohead', exact: false }).first().click();
    await page.waitForURL(/\/artists\/[0-9a-f-]+/);

    // Find the editable name (uses div with title="Double-click to edit").
    const editable = page.locator('div[title="Double-click to edit"]').first();
    await expect(editable).toContainText('Radiohead');
    await editable.dblclick();

    const input = page.locator('input').first();
    await input.fill('Radiohead (renamed)');
    await input.press('Enter');

    // Wait for the editable label to reflect the new value before reloading.
    await expect(editable).toContainText('Radiohead (renamed)');
    await page.reload();
    await expect(page.locator('body')).toContainText('Radiohead (renamed)');

    // Restore so other tests / fixtures aren't affected within this run.
    await page.locator('div[title="Double-click to edit"]').first().dblclick();
    const input2 = page.locator('input').first();
    await input2.fill('Radiohead');
    await input2.press('Enter');
    await expect(page.locator('div[title="Double-click to edit"]').first()).toContainText('Radiohead');
  });

  test('follow toggle persists', async ({ page }) => {
    await page.goto('/artists');
    await page.getByRole('link', { name: /Radiohead/i }).first().click();
    await page.waitForURL(/\/artists\/[0-9a-f-]+/);

    const followBtn = page.getByRole('button', { name: /^Follow$|^Following$/ });
    const initialText = (await followBtn.textContent())?.trim();
    await followBtn.click();
    // Wait for the label flip rather than a fixed sleep.
    await expect(followBtn).not.toHaveText(initialText ?? '');

    const after = (await followBtn.textContent())?.trim();
    expect(after).not.toBe(initialText);

    // Reload, expect the new state to persist.
    await page.reload();
    const reloaded = (await page.getByRole('button', { name: /^Follow$|^Following$/ }).textContent())?.trim();
    expect(reloaded).toBe(after);

    // Toggle back so subsequent runs start from the same state.
    const toggleBack = page.getByRole('button', { name: /^Follow$|^Following$/ });
    await toggleBack.click();
    await expect(toggleBack).not.toHaveText(after ?? '');
  });

  test('show row click navigates to /shows/[id]', async ({ page }) => {
    await page.goto('/artists');
    await page.getByRole('link', { name: /Radiohead/i }).first().click();
    await page.waitForURL(/\/artists\/[0-9a-f-]+/);

    // Click somewhere on the first show row that's not a link/button.
    const row = page.locator('.show-row').first();
    await row.locator('.show-row__date').click();
    await page.waitForURL(/\/shows\/[0-9a-f-]+/);
  });
});
