import { test, expect, type Page } from '@playwright/test';

async function loginAndSeed(page: Page) {
  await page.goto('/api/test/seed');
  await page.goto('/api/test/login');
  await page.waitForURL('**/home');
}

test.describe('Show detail page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  test('loads via row navigation and renders headliner + venue', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForSelector('.show-row', { timeout: 10000 });

    // Click the row that contains "Radiohead" (one of the seeded past concerts).
    const radioheadRow = page.locator('.show-row', { hasText: 'Radiohead' }).first();
    await expect(radioheadRow).toBeVisible();
    await radioheadRow.click();

    await page.waitForURL(/\/shows\/[0-9a-f-]+/);

    // Hero shows headliner.
    await expect(page.locator('h1')).toContainText('Radiohead');
    // Venue stat is linked.
    const venueLink = page.getByRole('link', { name: /Madison Square Garden/i });
    await expect(venueLink).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/show-detail.png',
      fullPage: true,
    });
  });

  test('renders setlist when present', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForSelector('.show-row', { timeout: 10000 });
    await page.locator('.show-row', { hasText: 'Radiohead' }).first().click();
    await page.waitForURL(/\/shows\/[0-9a-f-]+/);

    // The Radiohead seeded concert has a 10-song setlist.
    await expect(page.getByText(/Setlist · 10 songs/i)).toBeVisible();
    for (const song of ['15 Step', 'Bodysnatchers', 'Videotape']) {
      await expect(page.getByText(song)).toBeVisible();
    }
  });

  test('hides the setlist section when not present', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForSelector('.show-row', { timeout: 10000 });
    // LCD Soundsystem at Brooklyn Steel does NOT have a seeded setlist.
    await page.locator('.show-row', { hasText: 'LCD Soundsystem' }).first().click();
    await page.waitForURL(/\/shows\/[0-9a-f-]+/);
    await expect(page.getByText(/^Setlist ·/i)).toHaveCount(0);
  });

  test('headliner link navigates to /artists/[id]', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForSelector('.show-row', { timeout: 10000 });
    await page.locator('.show-row', { hasText: 'Radiohead' }).first().click();
    await page.waitForURL(/\/shows\/[0-9a-f-]+/);

    await page.getByRole('link', { name: 'Radiohead' }).first().click();
    await page.waitForURL(/\/artists\/[0-9a-f-]+/);
    await expect(page.locator('body')).toContainText('Radiohead');
  });

  test('venue link navigates to /venues/[id]', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForSelector('.show-row', { timeout: 10000 });
    await page.locator('.show-row', { hasText: 'Radiohead' }).first().click();
    await page.waitForURL(/\/shows\/[0-9a-f-]+/);

    await page.getByRole('link', { name: /Madison Square Garden/i }).first().click();
    await page.waitForURL(/\/venues\/[0-9a-f-]+/);
    await expect(page.locator('body')).toContainText('Madison Square Garden');
  });

  test('Edit button routes to /add?editId=', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForSelector('.show-row', { timeout: 10000 });
    await page.locator('.show-row', { hasText: 'Radiohead' }).first().click();
    await page.waitForURL(/\/shows\/[0-9a-f-]+/);

    await page.getByRole('button', { name: /Edit/i }).click();
    await page.waitForURL(/\/add\?editId=[0-9a-f-]+/);
  });
});

test.describe('Shows list — row vs chevron split', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  test('chevron expands inline; row click navigates', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForSelector('.show-row', { timeout: 10000 });

    const startUrl = page.url();
    const row = page.locator('.show-row', { hasText: 'Radiohead' }).first();

    // Chevron click should NOT navigate.
    const chevron = row.locator('.show-row__expand');
    await chevron.click();
    expect(page.url()).toBe(startUrl);

    // Row click (anywhere outside chevron / venue link / headliner link) should navigate.
    // Click the date cell, which has no inner link/button.
    await row.locator('.show-row__date').click();
    await page.waitForURL(/\/shows\/[0-9a-f-]+/);
  });
});
