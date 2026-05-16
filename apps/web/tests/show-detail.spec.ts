import { test, expect, type Page } from '@playwright/test';
import { loginAndSeedAsWorker, workerShowId } from './helpers/auth';

async function loginAndSeed(page: Page) {
  await loginAndSeedAsWorker(page);
}

async function gotoRadioheadMSG(page: Page, tab?: string): Promise<string> {
  // Look up the show id directly so we don't depend on shows-page pagination.
  const id = await workerShowId(page, {
    headliner: 'Radiohead',
    venueName: 'Madison Square Garden',
    state: 'past',
  });
  if (!id) throw new Error('Radiohead @ MSG show not seeded');
  const url = tab ? `/shows/${id}?tab=${tab}` : `/shows/${id}`;
  await page.goto(url);
  await page.locator('text=Loading show…').waitFor({ state: 'detached', timeout: 15000 });
  // Wait for the 4-tab shell to render so subsequent locator calls
  // aren't racing the initial paint.
  await expect(page.getByTestId('show-tab-bar')).toBeVisible({ timeout: 15000 });
  return id;
}

test.describe('Show detail page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  test('loads via direct id navigation and renders headliner + venue', async ({ page }) => {
    await gotoRadioheadMSG(page);

    // Hero shows headliner.
    await expect(page.locator('h1')).toContainText('Radiohead');
    // Venue stat in the Overview tab links to /venues/<id>.
    const venueLink = page.getByRole('link', { name: /Madison Square Garden/i });
    await expect(venueLink).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/show-detail.png',
      fullPage: true,
    });
  });

  test('renders the actual setlist on the Setlist tab when present', async ({ page }) => {
    await gotoRadioheadMSG(page, 'setlist');

    // Banner shows the song count for the seeded 10-song setlist.
    const banner = page.getByTestId('setlist-actual-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('10');

    // Each seeded song title surfaces inside the actual-setlist grid.
    const setlist = page.getByTestId('actual-setlist-grid');
    for (const song of ['15 Step', 'Bodysnatchers', 'Videotape']) {
      await expect(setlist.getByText(song, { exact: false })).toBeVisible();
    }
  });

  test('shows the empty Setlist-tab state when no actual setlist is seeded', async ({ page }) => {
    // LCD Soundsystem at Brooklyn Steel does NOT have a seeded setlist.
    const id = await workerShowId(page, {
      headliner: 'LCD Soundsystem',
      venueName: 'Brooklyn Steel',
      state: 'past',
    });
    if (!id) throw new Error('LCD @ Brooklyn Steel show not seeded');
    await page.goto(`/shows/${id}?tab=setlist`);
    await page.locator('text=Loading show…').waitFor({ state: 'detached', timeout: 15000 });
    await expect(page.getByTestId('setlist-tab-past-empty')).toBeVisible({
      timeout: 15000,
    });
    // No actual-setlist-grid renders in the empty state.
    await expect(page.getByTestId('actual-setlist-grid')).toHaveCount(0);
  });

  test('headliner link in the Overview lineup navigates to /artists/[id]', async ({ page }) => {
    await gotoRadioheadMSG(page);

    await page.getByRole('link', { name: 'Radiohead' }).first().click();
    await page.waitForURL(/\/artists\/[0-9a-f-]+/);
    await expect(page.locator('body')).toContainText('Radiohead');
  });

  test('venue link navigates to /venues/[id]', async ({ page }) => {
    await gotoRadioheadMSG(page);

    await page.getByRole('link', { name: /Madison Square Garden/i }).first().click();
    await page.waitForURL(/\/venues\/[0-9a-f-]+/);
    await expect(page.locator('body')).toContainText('Madison Square Garden');
  });

  test('Edit button routes to /add?editId=', async ({ page }) => {
    await gotoRadioheadMSG(page);

    await page.getByTestId('action-edit-show').click();
    await page.waitForURL(/\/add\?editId=[0-9a-f-]+/);
  });

  test('tab navigation crossfades between Overview / Setlist / Media / Notes', async ({ page }) => {
    await gotoRadioheadMSG(page);

    // Default tab is Overview.
    await expect(page.getByTestId('show-tab-panel-overview')).toBeVisible();

    // Click each non-default tab and verify its panel renders.
    await page.getByTestId('show-tab-setlist').click();
    await expect(page.getByTestId('show-tab-panel-setlist')).toBeVisible();
    await expect(page).toHaveURL(/[?&]tab=setlist/);

    await page.getByTestId('show-tab-media').click();
    await expect(page.getByTestId('show-tab-panel-media')).toBeVisible();
    await expect(page).toHaveURL(/[?&]tab=media/);

    await page.getByTestId('show-tab-notes').click();
    await expect(page.getByTestId('show-tab-panel-notes')).toBeVisible();
    await expect(page).toHaveURL(/[?&]tab=notes/);

    // Back to Overview drops the `tab` param (Overview is the URL default).
    await page.getByTestId('show-tab-overview').click();
    await expect(page.getByTestId('show-tab-panel-overview')).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]tab=/);
  });
});

test.describe('Shows list — row click navigates', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  test('row click navigates to detail (no inline expand any more)', async ({ page }) => {
    await page.goto('/logbook');
    await page.waitForSelector('.show-row', { timeout: 10000 });

    // Click the date cell — it has no inner link/button, so the row's
    // own navigation handler fires (instead of e.g. the headliner Link
    // intercepting the click).
    const row = page.locator('.show-row').first();
    await row.locator('.show-row__date').click();
    await page.waitForURL(/\/shows\/[0-9a-f-]+/);
  });
});
