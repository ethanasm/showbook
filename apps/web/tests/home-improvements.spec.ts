import { test, expect, type Page } from '@playwright/test';
import { loginAndSeedAsWorker, loginAsEmptyWorker } from './helpers/auth';

async function loginEmpty(page: Page) {
  // Per-worker empty user so seeded tests don't interfere.
  await loginAsEmptyWorker(page);
}

async function loginSeeded(page: Page) {
  await loginAndSeedAsWorker(page);
}

test.describe('Home page — empty state', () => {
  test('shows Get Started hub with all four onboarding doors when no shows exist', async ({ page }) => {
    await loginEmpty(page);
    // Scope to <main>: React 18 streaming SSR leaves a hidden suspense
    // template (`<div hidden id="S:0">`) that contains a duplicate copy of
    // the rendered subtree, which trips strict-mode locators.
    const empty = page.getByRole('main').getByTestId('home-empty-state');
    await expect(empty).toBeVisible({ timeout: 10000 });

    const hub = empty.getByTestId('get-started-hub');
    await expect(hub).toBeVisible();
    await expect(hub.getByRole('heading', { name: /Build your showbook/i })).toBeVisible();

    // All four doors render so users see every onboarding option in one grid.
    await expect(hub.getByTestId('get-started-door-gmail')).toBeVisible();
    await expect(hub.getByTestId('get-started-door-discover')).toBeVisible();
    await expect(hub.getByTestId('get-started-door-spotify')).toBeVisible();
    await expect(hub.getByTestId('get-started-door-add')).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/home-empty-state.png',
      fullPage: true,
    });
  });

  test('Gmail door navigates to /logbook with ?gmail=1', async ({ page }) => {
    await loginEmpty(page);
    const empty = page.getByRole('main').getByTestId('home-empty-state');
    await expect(empty).toBeVisible({ timeout: 10000 });

    await empty.getByTestId('get-started-door-gmail').click();
    // The shows page opens the Gmail modal — just verify navigation happened.
    await page.waitForURL('**/logbook*', { timeout: 8000 });
  });
});

test.describe('Home page — seeded shows', () => {
  test.beforeEach(async ({ page }) => {
    await loginSeeded(page);
  });

  test('hero card venue link points at /venues/[id]', async ({ page }) => {
    // Wait for the home page hero card to appear
    await page.waitForSelector('text=Next up', { timeout: 10000 });

    // Find the venue link inside the hero card area (MapPin is before venue name)
    // The hero card venue is a Link to /venues/[id]
    const venueLinks = page.locator('a[href^="/venues/"]');
    await expect(venueLinks.first()).toBeVisible({ timeout: 8000 });

    const href = await venueLinks.first().getAttribute('href');
    expect(href).toMatch(/^\/venues\/[0-9a-f-]+$/);

    await page.screenshot({
      path: 'test-results/screenshots/home-hero-venue-link.png',
      fullPage: true,
    });
  });

  test('recent row click navigates to show detail', async ({ page }) => {
    // Ensure the Recent section is visible
    await page.waitForSelector('text=Recent', { timeout: 10000 });

    // Recent rows have data-testid="recent-row"
    const firstRow = page.locator('[data-testid="recent-row"]').first();
    await expect(firstRow).toBeVisible({ timeout: 8000 });
    await firstRow.click();
    await page.waitForURL(/\/shows\/[0-9a-f-]+/, { timeout: 8000 });

    await page.screenshot({
      path: 'test-results/screenshots/home-recent-row-nav.png',
      fullPage: true,
    });
  });

  test('hero card click navigates to show detail', async ({ page }) => {
    await page.waitForSelector('text=Next up', { timeout: 10000 });

    const hero = page.getByRole('main').getByTestId('hero-card').first();
    await expect(hero).toBeVisible({ timeout: 8000 });
    const expectedId = await hero.getAttribute('data-show-id');
    expect(expectedId).toMatch(/^[0-9a-f-]+$/);

    // Click on a region that is NOT an artist / venue link — the date column
    // on the right is plain text so it's a safe click target.
    await hero.locator('.hero-card__date').click();
    await page.waitForURL(new RegExp(`/shows/${expectedId}`), { timeout: 8000 });
  });

  test('hero card artist link still navigates to artist (not show detail)', async ({ page }) => {
    await page.waitForSelector('text=Next up', { timeout: 10000 });

    const hero = page.getByRole('main').getByTestId('hero-card').first();
    await expect(hero).toBeVisible({ timeout: 8000 });
    const artistLink = hero.locator('a[href^="/artists/"]').first();
    await expect(artistLink).toBeVisible({ timeout: 8000 });
    await artistLink.click();
    await page.waitForURL(/\/artists\/[0-9a-f-]+/, { timeout: 8000 });
  });

  test('upcoming mini card click navigates to show detail', async ({ page }) => {
    await page.waitForSelector('text=Next up', { timeout: 10000 });

    const miniCard = page.locator('[data-testid="upcoming-mini-card"]').first();
    // The seeded fixture may not have enough upcoming shows for mini cards to
    // render; skip rather than fail when they're absent.
    if ((await miniCard.count()) === 0) {
      test.skip(true, 'Seed has no mini upcoming cards');
    }
    await expect(miniCard).toBeVisible({ timeout: 8000 });
    const expectedId = await miniCard.getAttribute('data-show-id');
    expect(expectedId).toMatch(/^[0-9a-f-]+$/);
    await miniCard.click();
    await page.waitForURL(new RegExp(`/shows/${expectedId}`), { timeout: 8000 });
  });

  test('wordmark header visible instead of greeting', async ({ page }) => {
    await page.waitForSelector('[data-testid="home-wordmark"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="home-wordmark"]')).toBeVisible();
    // Greeting text should not appear
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toMatch(/Good (morning|afternoon|evening)/);
  });

  test('home stats show Shows, Venues, Artists but not Spent', async ({ page }) => {
    // Stats labels are inside the home top bar (data-testid="home-stats")
    const stats = page.locator('[data-testid="home-stats"]');
    await expect(stats).toBeVisible({ timeout: 10000 });
    // Labels appear as uppercase via CSS but DOM text is original case
    await expect(stats.getByText('Shows', { exact: true })).toBeVisible();
    await expect(stats.getByText('Venues', { exact: true })).toBeVisible();
    await expect(stats.getByText('Artists', { exact: true })).toBeVisible();
    // Spent column should not be present
    await expect(stats.getByText('Spent', { exact: true })).toHaveCount(0);
  });
});
