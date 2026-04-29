import { test, expect, type Page } from '@playwright/test';

async function loginAndSeed(page: Page) {
  await page.goto('/api/test/seed');
  await page.goto('/api/test/login');
  await page.waitForURL('**/home');
}

async function navigateToRadioheadMSGShow(page: Page) {
  // Look up the show id directly so we don't depend on shows-page pagination.
  const res = await page.request.get(
    '/api/test/show-id?headliner=Radiohead&venueName=Madison+Square+Garden&state=past',
  );
  const { id } = await res.json();
  if (!id) throw new Error('Radiohead @ MSG show not seeded');
  await page.goto(`/shows/${id}`);
  // Wait for the detail query to resolve (Loading… replaced by real content).
  await page.locator('text=Loading show…').waitFor({ state: 'detached', timeout: 15000 });
}

test.describe('Show detail — per-performer setlists', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  test('renders artist picker when two performers have setlists', async ({ page }) => {
    await navigateToRadioheadMSGShow(page);

    // Both Radiohead and LCD Soundsystem have seeded setlists
    await expect(page.getByTestId('setlist-section')).toBeVisible();

    // Tab for Radiohead should be present (default)
    await expect(page.getByTestId('setlist-tab-radiohead')).toBeVisible();
    // Tab for LCD Soundsystem
    await expect(page.getByTestId('setlist-tab-lcd-soundsystem')).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/show-detail-setlists-tabs.png',
      fullPage: true,
    });
  });

  test('defaults to headliner setlist and shows songs', async ({ page }) => {
    await navigateToRadioheadMSGShow(page);

    // Radiohead tab should be active by default
    await expect(page.getByTestId('setlist-tab-radiohead')).toBeVisible();

    // Radiohead songs should be visible
    for (const song of ['15 Step', 'Bodysnatchers', 'Videotape']) {
      await expect(page.getByText(song)).toBeVisible();
    }
  });

  test('switching to support performer updates displayed songs', async ({ page }) => {
    await navigateToRadioheadMSGShow(page);

    // Switch to LCD Soundsystem
    await page.getByTestId('setlist-tab-lcd-soundsystem').click();

    // LCD Soundsystem songs should now be visible
    await expect(page.getByText('All My Friends')).toBeVisible();
    await expect(page.getByText('Someone Great')).toBeVisible();

    // Radiohead-only songs should not be visible
    await expect(page.getByText('15 Step')).toHaveCount(0);
  });

  test('hides setlist section for shows without setlists', async ({ page }) => {
    // LCD Soundsystem at Brooklyn Steel has no setlist
    const res = await page.request.get(
      '/api/test/show-id?headliner=LCD+Soundsystem&venueName=Brooklyn+Steel&state=past',
    );
    const { id } = await res.json();
    if (!id) throw new Error('LCD @ Brooklyn Steel show not seeded');
    await page.goto(`/shows/${id}`);
    await page.locator('text=Loading show…').waitFor({ state: 'detached', timeout: 15000 });
    await expect(page.getByTestId('setlist-section')).toHaveCount(0);
  });
});
