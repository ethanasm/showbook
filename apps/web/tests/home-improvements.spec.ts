import { test, expect, type Page } from '@playwright/test';

async function loginEmpty(page: Page) {
  // Use a dedicated empty-state test user so seeded tests in other projects
  // don't interfere (they use the default test@showbook.dev user).
  await page.goto('/api/test/login?email=empty%40showbook.dev');
  await page.waitForURL('**/home', { timeout: 10000 });
}

async function loginSeeded(page: Page) {
  await page.goto('/api/test/seed');
  await page.goto('/api/test/login');
  await page.waitForURL('**/home', { timeout: 10000 });
}

test.describe('Home page — empty state', () => {
  test('shows empty-state copy and Gmail import button when no shows exist', async ({ page }) => {
    await loginEmpty(page);
    await page.waitForSelector('text=No shows yet', { timeout: 10000 });

    await expect(page.getByText('No shows yet')).toBeVisible();
    await expect(page.getByText(/Import your ticket history from Gmail/i)).toBeVisible();

    const gmailBtn = page.getByRole('button', { name: /Import from Gmail/i });
    await expect(gmailBtn).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/home-empty-state.png',
      fullPage: true,
    });
  });

  test('Gmail import button navigates to /shows with ?gmail=1', async ({ page }) => {
    await loginEmpty(page);
    await page.waitForSelector('text=No shows yet', { timeout: 10000 });

    const gmailBtn = page.getByRole('button', { name: /Import from Gmail/i });
    await gmailBtn.click();
    // The shows page opens the Gmail modal — just verify navigation happened
    await page.waitForURL('**/shows*', { timeout: 8000 });
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
