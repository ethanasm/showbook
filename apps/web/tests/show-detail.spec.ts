import { test, expect, type Page } from '@playwright/test';

async function loginAndSeed(page: Page) {
  await page.goto('/api/test/seed');
  await page.goto('/api/test/login');
  await page.waitForURL('**/home');
}

async function gotoRadioheadMSG(page: Page): Promise<string> {
  // Look up the show id directly so we don't depend on shows-page pagination.
  const res = await page.request.get(
    '/api/test/show-id?headliner=Radiohead&venueName=Madison+Square+Garden&state=past',
  );
  const { id } = await res.json();
  if (!id) throw new Error('Radiohead @ MSG show not seeded');
  await page.goto(`/shows/${id}`);
  await page.locator('text=Loading show…').waitFor({ state: 'detached', timeout: 15000 });
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
    // Venue stat is linked.
    const venueLink = page.getByRole('link', { name: /Madison Square Garden/i });
    await expect(venueLink).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/show-detail.png',
      fullPage: true,
    });
  });

  test('renders setlist when present', async ({ page }) => {
    await gotoRadioheadMSG(page);

    // The Radiohead seeded concert has a 10-song setlist. Scope to the
    // setlist section — "Videotape" also appears in the seeded notes
    // ("Thom dedicated Videotape to the crowd"), which would otherwise
    // trip strict-mode.
    const setlist = page.getByTestId('setlist-section');
    await expect(setlist.getByText(/Setlist · 10 songs/i)).toBeVisible();
    for (const song of ['15 Step', 'Bodysnatchers', 'Videotape']) {
      await expect(setlist.getByText(song)).toBeVisible();
    }
  });

  test('hides the setlist section when not present', async ({ page }) => {
    // LCD Soundsystem at Brooklyn Steel does NOT have a seeded setlist.
    const res = await page.request.get(
      '/api/test/show-id?headliner=LCD+Soundsystem&venueName=Brooklyn+Steel&state=past',
    );
    const { id } = await res.json();
    if (!id) throw new Error('LCD @ Brooklyn Steel show not seeded');
    await page.goto(`/shows/${id}`);
    await page.locator('text=Loading show…').waitFor({ state: 'detached', timeout: 15000 });
    await expect(page.getByText(/^Setlist ·/i)).toHaveCount(0);
  });

  test('headliner link navigates to /artists/[id]', async ({ page }) => {
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

    // Several "Edit" buttons live on this page now (lineup, setlist,
    // actions); pick the actions one explicitly.
    await page.getByTestId('action-edit-show').click();
    await page.waitForURL(/\/add\?editId=[0-9a-f-]+/);
  });
});

test.describe('Shows list — row click navigates', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  test('row click navigates to detail (no inline expand any more)', async ({ page }) => {
    await page.goto('/shows');
    await page.waitForSelector('.show-row', { timeout: 10000 });

    // Click the date cell — it has no inner link/button, so the row's
    // own navigation handler fires (instead of e.g. the headliner Link
    // intercepting the click).
    const row = page.locator('.show-row').first();
    await row.locator('.show-row__date').click();
    await page.waitForURL(/\/shows\/[0-9a-f-]+/);
  });
});
