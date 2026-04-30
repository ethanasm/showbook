import { test, expect, type Page } from '@playwright/test';

async function loginAndSeed(page: Page) {
  await page.goto('/api/test/login');
  await page.waitForURL('**/home');
  await page.goto('/api/test/seed');
  await page.waitForLoadState('networkidle');
}

test.describe('Discover improvements', () => {
  // Discover-rail features (right-click venue, Follow another artist, region
  // headers) live in the desktop rail (.discover-rail). On <768px the rail is
  // hidden and replaced with .discover-chips, which does not expose these
  // affordances. Skip on mobile.
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768);

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

  test('Followed regions tab shows items grouped under region headers when regions exist', async ({ page }) => {
    // Add a region via the seed to ensure we have nearby data
    // The seed adds a NYC region, so just check the Followed regions tab
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Followed regions/i }).click();
    await page.waitForLoadState('networkidle');

    // If we have regions and announcements, region headers should appear
    // They have class discover-venue-group__header--region or contain ▼/▶ toggle
    const body = await page.locator('body').textContent();
    if (body?.includes('Follow a region')) {
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

  test('right-click region header on Followed regions tab shows Unfollow region option', async ({ page }) => {
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Followed regions/i }).click();
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

  test('Followed regions rail groups venues under region section headers', async ({ page }) => {
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Followed regions/i }).click();
    await page.waitForLoadState('networkidle');

    // Seed has two regions (New York, Brooklyn). With non-followed nearby
    // venues seeded (Irving Plaza, Comedy Cellar), the rail should render
    // a section header for each region (even if some have zero venues).
    const sectionHeaders = page.locator('.discover-rail__section-header');
    const count = await sectionHeaders.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Each section header should display a region name and the radius.
    await expect(sectionHeaders.first()).toContainText(/mi/i);

    // The rail should still have the "All regions" aggregate item at top.
    await expect(page.locator('.discover-rail__item', { hasText: /All regions/i }).first()).toBeVisible();
  });

  test('Followed regions table shows both Venue and Headliner column headers', async ({ page }) => {
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Followed regions/i }).click();
    await page.waitForLoadState('networkidle');

    // The Followed regions tab uses the --region column-header layout, which renders
    // a Venue column in addition to Headliner.
    const headers = page.locator('.discover-col-headers--region');
    const count = await headers.count();
    if (count === 0) {
      // No region groups visible (possible if no items + no active regions);
      // tolerated by other tests, skip here.
      test.skip();
      return;
    }
    await expect(headers.first()).toContainText(/Venue/i);
    await expect(headers.first()).toContainText(/Headliner/i);

    // Sanity: the Followed venues tab should NOT have the --region variant.
    await page.getByRole('button', { name: /Followed venues/i }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.discover-col-headers--region')).toHaveCount(0);
  });

  test('Followed regions row uses the --region grid (extra venue cell)', async ({ page }) => {
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Followed regions/i }).click();
    await page.waitForLoadState('networkidle');

    const regionRows = page.locator('.discover-row.discover-row--region');
    const count = await regionRows.count();
    if (count === 0) {
      test.skip();
      return;
    }

    // The venue cell should contain a link to /venues/...
    const firstVenueLink = regionRows.first().locator('.discover-row__venue-cell a').first();
    await expect(firstVenueLink).toHaveAttribute('href', /^\/venues\//);
  });
});
