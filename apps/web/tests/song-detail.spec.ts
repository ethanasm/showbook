import { test, expect, type Page } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

// The standalone /songs index page is gone; the per-song detail page
// remains, reached from the artist page's "Songs you've heard live"
// section (and from setlist / predicted-setlist rows on show detail).
// This spec covers that surviving path end-to-end.

// Scope every locator to the page's <main> wrapper. Next.js's
// App-Router streaming sometimes leaves a hydration shadow (the
// pre-hydration server tree + the post-hydration client tree
// briefly co-exist in production), which trips Playwright's strict
// mode on bare testid queries. Restricting to <main> bypasses any
// out-of-band copies the layout shell might keep around.
function main(page: Page) {
  return page.locator('main');
}

// Navigate to the Radiohead artist page by clicking the artist *name*
// inside the row link — clicking the row itself is viewport-sensitive
// because the row's center can land on the inline follow toggle, which
// intentionally swallows the click (see artists-follow-toggle.spec.ts).
async function gotoRadioheadArtistPage(page: Page) {
  await page.goto('/artists');
  const row = main(page).getByRole('link', { name: /Radiohead/ }).first();
  await row.waitFor({ state: 'visible' });
  await row.getByText('Radiohead', { exact: true }).click();
  await page.waitForURL(/\/artists\/[0-9a-f-]+/);
}

test.describe('Song detail page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeedAsWorker(page);
  });

  test('artist page songs section links through to /songs/[songId]', async ({ page }) => {
    // The Radiohead seed carries a 10-song setlist, so its artist page
    // renders the "Songs you've heard live" section.
    await gotoRadioheadArtistPage(page);

    const songsSection = main(page).getByTestId('artist-songs-section');
    await expect(songsSection).toBeVisible({ timeout: 15000 });
    await songsSection.getByTestId('artist-songs-row').first().click();
    await page.waitForURL(/\/songs\/[0-9a-f-]+/);

    // The detail page heading is the song title in quotes.
    await expect(main(page).locator('h1.display-title')).toBeVisible();
    // The stat strip uses "Heard live" exactly; the page also has the
    // eyebrow "Song you've heard live", so match exact text only.
    await expect(main(page).getByText('Heard live', { exact: true })).toBeVisible();
    await expect(main(page).getByTestId('song-show-list')).toBeVisible();
  });

  test('breadcrumb navigates back to the artist page', async ({ page }) => {
    await gotoRadioheadArtistPage(page);
    const artistUrl = page.url();

    const songsSection = main(page).getByTestId('artist-songs-section');
    await expect(songsSection).toBeVisible({ timeout: 15000 });
    await songsSection.getByTestId('artist-songs-row').first().click();
    await page.waitForURL(/\/songs\/[0-9a-f-]+/);

    await main(page).getByRole('link', { name: /radiohead/ }).first().click();
    await page.waitForURL(artistUrl);
  });
});
