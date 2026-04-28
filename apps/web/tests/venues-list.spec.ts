import { test, expect, type Page } from '@playwright/test';

async function loginAndSeed(page: Page) {
  await page.goto('/api/test/seed');
  await page.goto('/api/test/login');
  await page.waitForURL('**/home');
}

test.describe('Venues list page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  test('loads with seeded venues', async ({ page }) => {
    await page.goto('/venues');
    await page.waitForSelector('a[href^="/venues/"]', { timeout: 10000 });

    // Several known seeded venues should appear.
    for (const name of [
      'Madison Square Garden',
      'Brooklyn Steel',
      'Gershwin Theatre',
      'The Beacon Theatre',
    ]) {
      await expect(page.getByText(name).first()).toBeVisible();
    }

    await page.screenshot({
      path: 'test-results/screenshots/venues-list.png',
      fullPage: true,
    });
  });

  test('search filters by name and city', async ({ page }) => {
    await page.goto('/venues');
    await page.waitForSelector('a[href^="/venues/"]', { timeout: 10000 });

    const search = page.getByPlaceholder(/filter venues/i);
    await search.fill('Brooklyn');

    await expect(page.getByText('Brooklyn Steel')).toBeVisible();
    await expect(page.getByText('Madison Square Garden')).toHaveCount(0);
  });

  test('past column default sort is desc and toggles asc', async ({ page }) => {
    await page.goto('/venues');
    await page.waitForSelector('a[href^="/venues/"]', { timeout: 10000 });

    const pastHeader = page.getByTestId('sort-header-past');
    await expect(pastHeader).toHaveAttribute('data-sort-active', 'desc');

    await pastHeader.click();
    await expect(pastHeader).toHaveAttribute('data-sort-active', 'asc');
  });

  test('clicking city header sorts alphabetically', async ({ page }) => {
    await page.goto('/venues');
    await page.waitForSelector('a[href^="/venues/"]', { timeout: 10000 });

    await page.getByTestId('sort-header-city').click();
    await expect(page.getByTestId('sort-header-city')).toHaveAttribute(
      'data-sort-active',
      'asc',
    );
  });

  test('TM badge reflects linked vs unlinked state', async ({ page }) => {
    await page.goto('/venues');
    await page.waitForSelector('a[href^="/venues/"]', { timeout: 10000 });

    // Madison Square Garden has a TM ID seeded; Brooklyn Steel does not.
    const msgRow = page.locator('a[href^="/venues/"]').filter({
      hasText: 'Madison Square Garden',
    });
    const bsRow = page.locator('a[href^="/venues/"]').filter({
      hasText: 'Brooklyn Steel',
    });

    await expect(
      msgRow.locator('span[title="Ticketmaster ID linked"]'),
    ).toHaveAttribute('data-linked', 'true');
    await expect(
      bsRow.locator('span[title="No Ticketmaster ID"]'),
    ).toHaveAttribute('data-linked', 'false');
  });

  test('row click navigates to venue detail page', async ({ page }) => {
    await page.goto('/venues');
    await page.waitForSelector('a[href^="/venues/"]', { timeout: 10000 });

    await page
      .locator('a[href^="/venues/"]')
      .filter({ hasText: 'Madison Square Garden' })
      .first()
      .click();
    await page.waitForURL(/\/venues\/[0-9a-f-]+/);
    await expect(page.locator('body')).toContainText('Madison Square Garden');
  });
});
