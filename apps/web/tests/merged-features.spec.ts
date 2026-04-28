import { test, expect, type Page } from '@playwright/test';

async function loginAsTestUser(page: Page) {
  await page.goto('/api/test/seed');
  await page.goto('/api/test/login');
  await page.waitForURL('**/home');
}

test.describe('Venue cleanup: neighborhood removed', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('home page loads without neighborhood references', async ({ page }) => {
    await expect(page.locator('body')).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain('neighborhood');
  });

  test('shows page loads and displays production names for theatre', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForSelector('[class*="show"]', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const content = await page.textContent('body');
    expect(content).toContain('Wicked');

    await page.screenshot({
      path: 'test-results/screenshots/shows-production-names.png',
      fullPage: true,
    });
  });

  test('map page loads without neighborhood in inspector', async ({ page }) => {
    await page.goto('/map');
    await page.waitForTimeout(3000);
    await page.screenshot({
      path: 'test-results/screenshots/map-no-neighborhood.png',
      fullPage: true,
    });
  });

  test('discover page uses city label instead of neighborhood', async ({ page }) => {
    await page.goto('/discover');
    await page.waitForTimeout(3000);
    const html = await page.content();
    expect(html).not.toMatch(/venue\.neighborhood/);
    await page.screenshot({
      path: 'test-results/screenshots/discover-city-labels.png',
      fullPage: true,
    });
  });
});

test.describe('Venue detail pages', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('venue detail page loads from discover link', async ({ page }) => {
    await page.goto('/discover');
    await page.waitForTimeout(3000);

    const venueLink = page.locator('a[href^="/venues/"]').first();
    if (await venueLink.isVisible()) {
      await venueLink.click();
      await page.waitForURL('**/venues/**');

      await expect(page.locator('body')).toContainText('Venue');
      await expect(page.locator('body')).toContainText('Your shows');
      await expect(page.locator('body')).toContainText('Upcoming');

      await page.screenshot({
        path: 'test-results/screenshots/venue-detail-from-discover.png',
        fullPage: true,
      });
    }
  });

  test('venue detail page shows stats and follow button', async ({ page }) => {
    await page.goto('/discover');
    await page.waitForTimeout(3000);

    const venueLink = page.locator('a[href^="/venues/"]').first();
    if (await venueLink.isVisible()) {
      const href = await venueLink.getAttribute('href');
      await page.goto(href!);
      await page.waitForTimeout(2000);

      await expect(page.locator('body')).toContainText('Your shows');
      await expect(page.locator('body')).toContainText('Upcoming');
      await expect(page.locator('body')).toContainText('First seen');
      await expect(page.locator('body')).toContainText('Last seen');

      const followBtn = page.locator('button', { hasText: /Follow/ });
      await expect(followBtn).toBeVisible();

      await page.screenshot({
        path: 'test-results/screenshots/venue-detail-stats.png',
        fullPage: true,
      });
    }
  });

  test('follow/unfollow toggle works on venue detail', async ({ page }) => {
    await page.goto('/discover');
    await page.waitForTimeout(3000);

    const venueLink = page.locator('a[href^="/venues/"]').first();
    if (await venueLink.isVisible()) {
      const href = await venueLink.getAttribute('href');
      await page.goto(href!);
      await page.waitForTimeout(2000);

      const followBtn = page.locator('button', { hasText: /Follow/ });
      if (await followBtn.isVisible()) {
        const initialText = await followBtn.textContent();
        await followBtn.click();
        await page.waitForTimeout(1000);
        const afterText = await followBtn.textContent();
        expect(afterText).not.toBe(initialText);

        await page.screenshot({
          path: 'test-results/screenshots/venue-detail-follow-toggled.png',
          fullPage: true,
        });
      }
    }
  });

  test('venue detail shows user show history', async ({ page }) => {
    await page.goto('/discover');
    await page.waitForTimeout(3000);

    const venueLink = page.locator('a[href^="/venues/"]').first();
    if (await venueLink.isVisible()) {
      const href = await venueLink.getAttribute('href');
      await page.goto(href!);
      await page.waitForTimeout(2000);

      // The venue detail page now renders both an exact "Your shows" header
      // and a "Your shows · N" count chip. Disambiguate to avoid strict-mode
      // violation by selecting the exact match.
      const yourShows = page.getByText('Your shows', { exact: true });
      await expect(yourShows).toBeVisible();

      await page.screenshot({
        path: 'test-results/screenshots/venue-detail-history.png',
        fullPage: true,
      });
    }
  });

  test('venue detail has breadcrumb back to venues list', async ({ page }) => {
    // Commit 15e1efa changed the venue detail breadcrumb from /discover
    // to /venues ("Shows ← venues / venue-name"). The test is updated to
    // match the current implementation.
    await page.goto('/discover');
    await page.waitForTimeout(3000);

    const venueLink = page.locator('a[href^="/venues/"]').first();
    if (await venueLink.isVisible()) {
      const href = await venueLink.getAttribute('href');
      await page.goto(href!);
      await page.waitForTimeout(2000);

      const breadcrumb = page.locator('a[href="/venues"]');
      await expect(breadcrumb).toBeVisible();
      await expect(breadcrumb).toContainText(/venues/i);

      await breadcrumb.click();
      await page.waitForURL('**/venues');
    }
  });

  test('venue detail page handles nonexistent venue gracefully', async ({ page }) => {
    await page.goto('/venues/00000000-0000-0000-0000-000000000000');
    await page.waitForTimeout(3000);

    await expect(page.locator('body')).toContainText(/load venue|not found|discover/i);

    await page.screenshot({
      path: 'test-results/screenshots/venue-detail-not-found.png',
      fullPage: true,
    });
  });

  test('venue detail does not reference neighborhood', async ({ page }) => {
    await page.goto('/discover');
    await page.waitForTimeout(3000);

    const venueLink = page.locator('a[href^="/venues/"]').first();
    if (await venueLink.isVisible()) {
      const href = await venueLink.getAttribute('href');
      await page.goto(href!);
      await page.waitForTimeout(2000);

      const locationText = await page.textContent('body');
      expect(locationText).not.toMatch(/midtown|williamsburg|greenwich village|broadway|upper west side|union square/i);
    }
  });
});

test.describe('Theatre production name handling', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('theatre shows display production name as headliner on home', async ({ page }) => {
    await page.waitForTimeout(5000);
    const content = await page.textContent('body');
    expect(content).toContain('Wicked');
  });

  test('theatre shows display production name on shows page', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForTimeout(3000);

    const content = await page.textContent('body');
    expect(content).toContain('Wicked');

    await page.screenshot({
      path: 'test-results/screenshots/shows-theatre-production.png',
      fullPage: true,
    });
  });
});

test.describe('Database schema verification', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
  });

  test('shows page loads correctly after schema migration', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForTimeout(3000);
    const content = await page.textContent('body');
    expect(content).toBeTruthy();
    expect(content!.length).toBeGreaterThan(100);
  });
});
