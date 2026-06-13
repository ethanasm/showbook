import { test, expect, type Page } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

// Adding an entity on a Discover tab auto-selects it: the rail highlights
// the new venue / artist immediately so the feed scopes to what the user
// just followed (count 0 until its first ingest lands). Regions aren't
// directly selectable in the rail (selection there is venue-scoped), so
// adding one clears any venue filter and surfaces the new region section.
test.describe('Discover auto-select on add', () => {
  // The rail is desktop-only (<768px swaps to .discover-chips).
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768);

  test.beforeEach(async ({ page }: { page: Page }) => {
    await loginAndSeedAsWorker(page);
  });

  test('newly followed venue becomes the selected rail item', async ({ page }) => {
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Follow another venue/i }).click();
    const input = page.locator('input[placeholder*="Search venues"]');
    await expect(input).toBeVisible({ timeout: 3000 });
    // Irving Plaza is seeded but not followed.
    await input.fill('Irving');

    const result = page
      .locator('.discover-modal__result', { hasText: 'Irving Plaza' })
      .first();
    await expect(result).toBeVisible({ timeout: 5000 });
    await result.click();

    const active = page.locator('.discover-rail__item--active');
    await expect(active).toContainText('Irving Plaza', { timeout: 10_000 });
    // The "All followed" row is no longer the active one.
    await expect(active).toHaveCount(1);
  });

  test('newly followed artist becomes the selected rail item', async ({ page }) => {
    // searchArtists hits Ticketmaster — mock it; the follow itself runs
    // for real through performers.followAttraction.
    await page.route('**/api/trpc/discover.searchArtists**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            result: {
              data: {
                json: [
                  { id: 'K8vZ917_1VV', name: 'Radiohead', imageUrl: null, mbid: null },
                ],
              },
            },
          },
        ]),
      });
    });

    await page.goto('/discover');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /Followed artists/i }).click();
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: /Follow another artist/i }).click();
    const searchInput = page.locator('input[placeholder*="Search artists"]');
    await expect(searchInput).toBeVisible({ timeout: 3000 });
    await searchInput.fill('Radio');

    const result = page.locator('button', { hasText: 'Radiohead' }).first();
    await expect(result).toBeVisible({ timeout: 5000 });
    await result.click();

    const active = page.locator('.discover-rail__item--active');
    await expect(active).toContainText('Radiohead', { timeout: 10_000 });
    await expect(active).toHaveCount(1);
  });

  test('newly added region section appears with no venue filter applied', async ({ page }) => {
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /Followed regions/i }).click();
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: /Follow another region/i }).click();
    // Place search needs a Google key the test env doesn't have — use
    // the manual-coordinates path.
    await page.getByRole('button', { name: /Enter coordinates manually/i }).click();
    await page.locator('input[placeholder="e.g. Nashville"]').fill('Hoboken');
    await page.locator('input[placeholder="36.1627"]').fill('40.7440');
    await page.locator('input[placeholder="-86.7816"]').fill('-74.0324');
    await page.getByRole('button', { name: /^Follow Region$/ }).click();

    // The new region's rail section header renders, and with no venue
    // selected the "All regions" row stays active so the section is
    // guaranteed visible.
    await expect(
      page.locator('.discover-rail__section-header', { hasText: 'Hoboken' }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('.discover-rail__item--active', { hasText: /All regions/i }),
    ).toBeVisible();
  });
});
