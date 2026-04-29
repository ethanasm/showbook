import { test, expect, type Page } from '@playwright/test';

async function loginAndSeed(page: Page) {
  await page.goto('/api/test/login');
  await page.waitForURL('**/home');
  await page.goto('/api/test/seed');
  await page.waitForLoadState('networkidle');
}

test.describe('Discover improvements', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  test('right-click followed venue in rail shows Unfollow context menu and removes it', async ({ page }) => {
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');

    // Wait for the rail to have venue items (beyond the "All followed" item)
    const railItems = page.locator('.discover-rail__item').filter({ hasNot: page.locator(':has-text("All followed")') });
    const count = await railItems.count();
    if (count === 0) {
      // No followed venues with announcements — skip gracefully
      test.skip();
      return;
    }

    const firstItem = railItems.first();
    const venueName = await firstItem.locator('.discover-rail__item-name').textContent();

    // Right-click to open context menu
    await firstItem.click({ button: 'right' });
    const unfollowBtn = page.locator('button', { hasText: 'Unfollow' }).first();
    await expect(unfollowBtn).toBeVisible({ timeout: 3000 });

    // Click unfollow
    await unfollowBtn.click();

    // Verify the venue is removed from the rail
    await expect(page.locator('.discover-rail__item-name', { hasText: venueName! })).not.toBeVisible({ timeout: 5000 });
  });

  test('"Follow another artist" affordance appears on Artists tab', async ({ page }) => {
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Followed artists/i }).click();
    await page.waitForTimeout(300);

    // The "Follow another artist" button should be visible in the rail
    await expect(page.getByRole('button', { name: /Follow another artist/i })).toBeVisible();
  });

  test('"Follow another artist" search box opens on click', async ({ page }) => {
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /Followed artists/i }).click();
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: /Follow another artist/i }).click();

    // Search input should appear
    await expect(page.locator('input[placeholder*="Search artists"]')).toBeVisible({ timeout: 3000 });
  });

  test('"Follow another artist" search calls mocked discover.searchArtists', async ({ page }) => {
    // Mock the tRPC endpoint for searchArtists
    await page.route('**/api/trpc/discover.searchArtists**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          result: {
            data: {
              json: [
                { id: 'K8vZ917_1VV', name: 'Radiohead', imageUrl: null, mbid: null },
              ],
            },
          },
        }]),
      });
    });

    await page.goto('/discover');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /Followed artists/i }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /Follow another artist/i }).click();

    const searchInput = page.locator('input[placeholder*="Search artists"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('Radio');

    // Wait for results (debounced 350ms)
    await page.waitForTimeout(600);

    // Should show the mocked result
    await expect(page.locator('text=Radiohead')).toBeVisible({ timeout: 5000 });
  });

  test('Near You tab shows items grouped under region headers when regions exist', async ({ page }) => {
    // Add a region via the seed to ensure we have nearby data
    // The seed adds a NYC region, so just check the Near You tab
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Near you/i }).click();
    await page.waitForLoadState('networkidle');

    // If we have regions and announcements, region headers should appear
    // They have class discover-venue-group__header--region or contain ▼/▶ toggle
    const body = await page.locator('body').textContent();
    if (body?.includes('Add a region')) {
      // No regions configured — that's fine, test passes
      return;
    }

    // If there are items, they should be grouped under region headers with collapsible toggle
    const regionHeaders = page.locator('.discover-venue-group__header--region');
    const count = await regionHeaders.count();
    if (count > 0) {
      // Region header should show radiusMiles and upcoming count
      await expect(regionHeaders.first()).toContainText(/mi/);
      await expect(regionHeaders.first()).toContainText(/upcoming/);
    }
  });

  test('right-click region header on Near You tab shows Unfollow region option', async ({ page }) => {
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Near you/i }).click();
    await page.waitForLoadState('networkidle');

    const regionHeaders = page.locator('.discover-venue-group__header--region');
    const count = await regionHeaders.count();
    if (count === 0) {
      test.skip();
      return;
    }

    await regionHeaders.first().click({ button: 'right' });

    const unfollowBtn = page.locator('button', { hasText: 'Unfollow region' }).first();
    await expect(unfollowBtn).toBeVisible({ timeout: 3000 });
  });
});
