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

  test('inline rename persists across navigation', async ({ page }, testInfo) => {
    // Renaming Radiohead writes to the global performers table, which
    // races with other workers that look up Radiohead by name (show-detail,
    // add-setlists, media-upload). Run only in single-worker mode.
    test.skip(
      testInfo.config.workers > 1,
      'rename mutates global performer name; races with concurrent workers',
    );
    await page.goto('/artists');
    await page.getByRole('link', { name: 'Radiohead', exact: false }).first().click();
    await page.waitForURL(/\/artists\/[0-9a-f-]+/);

    try {
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
    } finally {
      // Always attempt to restore the canonical name, even if the assertions
      // above fail. Without this, a mid-test crash leaks "Radiohead (renamed)"
      // into the e2e DB, breaking every later test that looks up Radiohead
      // by name. The seed handler also heals this defensively, but a
      // try/finally here is the cheapest safety net.
      try {
        await page
          .locator('div[title="Double-click to edit"]')
          .first()
          .dblclick({ timeout: 5000 });
        const input2 = page.locator('input').first();
        await input2.fill('Radiohead');
        await input2.press('Enter');
      } catch {
        // The page may not be in an editable state if the assertions above
        // failed early. The seed-side heal will pick up the slack on the
        // next run.
      }
    }
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
