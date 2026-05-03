import { test, expect, type Page } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

async function loginAndSeed(page: Page) {
  await loginAndSeedAsWorker(page);
}

// Next.js streaming SSR temporarily places the page content inside a
// `<div hidden id="S:0">` before React hydration relocates / removes it.
// While that hidden duplicate is in the DOM, every selector matches twice,
// which trips strict-mode locators. Wait for hydration to clear it.
async function gotoVenues(page: Page) {
  await page.goto('/venues');
  await page.waitForFunction(
    () => !document.querySelector('[id^="S:"][hidden]'),
  );
  await page.waitForSelector('a[href^="/venues/"]', { timeout: 10000 });
}

test.describe('Venues list page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  test('loads with seeded venues', async ({ page }) => {
    await gotoVenues(page);

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
    await gotoVenues(page);

    const search = page.getByRole('textbox', { name: /filter venues/i });
    await search.fill('Brooklyn');

    await expect(page.getByText('Brooklyn Steel')).toBeVisible();
    await expect(page.getByText('Madison Square Garden')).toHaveCount(0);
  });

  test('past column default sort is desc and toggles asc', async ({ page }) => {
    await gotoVenues(page);

    const pastHeader = page.getByRole('button', { name: 'Past' });
    await expect(pastHeader).toHaveAttribute('data-sort-active', 'desc');

    await pastHeader.click();
    await expect(pastHeader).toHaveAttribute('data-sort-active', 'asc');
  });

  test('clicking city header sorts alphabetically', async ({ page }) => {
    await gotoVenues(page);

    const cityHeader = page.getByRole('button', { name: 'City' });
    await cityHeader.click();
    await expect(cityHeader).toHaveAttribute('data-sort-active', 'asc');
  });

  test('TM badge reflects linked vs unlinked state', async ({ page }) => {
    await gotoVenues(page);

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
    await gotoVenues(page);

    await page
      .locator('a[href^="/venues/"]')
      .filter({ hasText: 'Madison Square Garden' })
      .first()
      .click();
    await page.waitForURL(/\/venues\/[0-9a-f-]+/);
    await expect(page.locator('body')).toContainText('Madison Square Garden');
  });
});
