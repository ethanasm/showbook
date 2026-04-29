import { test, expect, type Page } from '@playwright/test';

async function loginAndSeed(page: Page) {
  await page.goto('/api/test/seed');
  await page.goto('/api/test/login');
  await page.waitForURL('**/home');
}

test.describe('Add page — per-performer setlist input', () => {
  // The add page uses a fixed 2-column layout (1fr + 440px) that is
  // designed for wide screens only; skip on narrow mobile viewports.
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 600);

  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  test('shows setlist input blocks for headliner on past concerts', async ({ page }) => {
    await page.goto('/add');

    // Select "past" timeframe
    await page.getByText('past').first().click();

    // Select "Concert" kind
    await page.getByText('Concert').first().click();

    // Enter headliner
    const headlinerInput = page.locator('input[placeholder="Search for an artist or show..."]').first();
    await headlinerInput.fill('Test Artist');
    // Use "Use..." manual entry option
    await page.getByText(/Use "Test Artist"/i).click();

    // Enter venue
    const venueInput = page.locator('input[placeholder*="venue"]').first();
    if (await venueInput.isVisible()) {
      await venueInput.fill('Test Venue');
    }

    // Enter a past date
    const dateInput = page.locator('input[type="date"]').first();
    await dateInput.fill('2024-01-15');

    // The setlist section should appear for past concerts
    await expect(page.getByTestId('setlist-section')).toBeVisible({ timeout: 5000 });

    // The headliner setlist block should be present
    await expect(page.getByTestId('setlist-block-test-artist')).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/add-setlist-blocks.png',
      fullPage: true,
    });
  });

  test('shows "Search setlist.fm" button for headliner', async ({ page }) => {
    await page.goto('/add');
    await page.getByText('past').first().click();
    await page.getByText('Concert').first().click();

    const headlinerInput = page.locator('input[placeholder="Search for an artist or show..."]').first();
    await headlinerInput.fill('Radiohead');
    await page.getByText(/Use "Radiohead"/i).click();

    const dateInput = page.locator('input[type="date"]').first();
    await dateInput.fill('2024-01-15');

    await expect(page.getByTestId('setlist-section')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('search-setlist-radiohead')).toBeVisible();
  });

  test('editing a show with setlists renders the setlist section', async ({ page }) => {
    // Look up the show id directly so we don't depend on shows-page pagination.
    const res = await page.request.get(
      '/api/test/show-id?headliner=Radiohead&venueName=Madison+Square+Garden&state=past',
    );
    const { id } = await res.json();
    if (!id) throw new Error('Radiohead @ MSG show not seeded');
    await page.goto(`/add?editId=${id}`);
    // Wait for the edit prefill to finish (Loading… is replaced by the form).
    await page.locator('text=Loading show...').waitFor({ state: 'detached', timeout: 15000 });

    // The setlist section should show the prefilled setlist
    await expect(page.getByTestId('setlist-section')).toBeVisible({ timeout: 5000 });

    await page.screenshot({
      path: 'test-results/screenshots/add-setlist-edit-prefill.png',
      fullPage: true,
    });
  });
});
