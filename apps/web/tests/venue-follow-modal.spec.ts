import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3010';

async function loginAndSeed(page: Page) {
  await page.goto(`${BASE}/api/test/login`);
  await page.waitForURL('**/home');
  await page.goto(`${BASE}/api/test/seed`);
  await page.waitForLoadState('networkidle');
}

test.describe('Venue follow modal (Discover)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  test('opens with palette layout, search input, and footer hints', async ({ page }) => {
    await page.goto(`${BASE}/discover`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Follow another venue/i }).click();
    const modal = page.getByTestId('venue-follow-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('venue-follow-input')).toBeFocused();

    await expect(modal.getByText(/navigate/)).toBeVisible();
    await expect(modal.getByText(/follow/)).toBeVisible();
    await expect(modal.getByText(/close/)).toBeVisible();

    await expect(modal.getByText(/Type at least 2 characters/i)).toBeVisible();
  });

  test('typing query shows debounced results in two sections', async ({ page }) => {
    await page.goto(`${BASE}/discover`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Follow another venue/i }).click();
    const modal = page.getByTestId('venue-follow-modal');
    await expect(modal).toBeVisible();

    // "Gershwin Theatre" is in the seeded VENUES list (DB).
    // Google Places autocomplete also returns Gershwin venues.
    await page.getByTestId('venue-follow-input').fill('Gershwin');

    // Both section headers should appear: "Venues" (DB) and "From Google Places".
    await expect(modal.getByText(/^Venues$/, { exact: true })).toBeVisible({ timeout: 8000 });
    await expect(modal.getByText(/From Google Places/i)).toBeVisible({ timeout: 8000 });

    // At least one row from each section
    await expect(modal.getByTestId('venue-follow-result-db').first()).toBeVisible();
    await expect(modal.getByTestId('venue-follow-result-place').first()).toBeVisible();
  });

  test('Esc closes the modal', async ({ page }) => {
    await page.goto(`${BASE}/discover`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Follow another venue/i }).click();
    await expect(page.getByTestId('venue-follow-modal')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('venue-follow-modal')).not.toBeVisible();
  });

  test('arrow keys + enter follow a DB venue and close the modal', async ({ page }) => {
    await page.goto(`${BASE}/discover`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Follow another venue/i }).click();
    const modal = page.getByTestId('venue-follow-modal');
    await page.getByTestId('venue-follow-input').fill('Gershwin');
    await expect(modal.getByTestId('venue-follow-result-db').first()).toBeVisible({ timeout: 8000 });

    // First row is the DB Gershwin Theatre.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(modal).not.toBeVisible({ timeout: 8000 });
  });

  test('selecting a Google Place creates+follows the venue (Ticketmaster ID lookup runs server-side)', async ({ page }) => {
    await page.goto(`${BASE}/discover`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Follow another venue/i }).click();
    const modal = page.getByTestId('venue-follow-modal');
    // Use a venue that's NOT in the seed so we exercise the "create from Google Places" path.
    await page.getByTestId('venue-follow-input').fill('Bowery Ballroom New York');
    await expect(modal.getByTestId('venue-follow-result-place').first()).toBeVisible({ timeout: 8000 });

    // Capture the row text so we can find the resulting venue in the DB.
    const placeText = await modal.getByTestId('venue-follow-result-place').first().textContent();
    expect(placeText).toMatch(/Bowery Ballroom/i);

    await modal.getByTestId('venue-follow-result-place').first().click();
    await expect(modal).not.toBeVisible({ timeout: 10000 });
  });
});
