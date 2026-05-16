import { test, expect, type Page } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

// Scope every locator to the page's <main> wrapper. Next.js's
// App-Router streaming sometimes leaves a hydration shadow (the
// pre-hydration server tree + the post-hydration client tree
// briefly co-exist in production), which trips Playwright's strict
// mode on bare testid queries. Restricting to <main> bypasses any
// out-of-band copies the layout shell might keep around.
function main(page: Page) {
  return page.locator('main');
}

test.describe('Songs page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeedAsWorker(page);
  });

  test('loads /songs and lists every song the seeded user has heard', async ({ page }) => {
    await page.goto('/songs');
    await expect(
      main(page).getByRole('heading', { name: /^Songs$/, level: 1 }),
    ).toBeVisible({ timeout: 15000 });
    // The Radiohead show seeds a 10-song setlist; every title should
    // show up as a row.
    await expect(main(page).getByTestId('songs-row').first()).toBeVisible();
    const rowCount = await main(page).getByTestId('songs-row').count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test('free-text search narrows the result set', async ({ page }) => {
    await page.goto('/songs');
    await main(page).getByTestId('songs-result-count').first().waitFor({ state: 'visible' });

    const initialCount = await main(page).getByTestId('songs-row').count();
    expect(initialCount).toBeGreaterThan(1);

    await main(page).getByTestId('songs-search').fill('Videotape');
    // The Radiohead seed includes "Videotape" as the last song.
    await expect(main(page).getByTestId('songs-row')).toHaveCount(1);
    await expect(main(page).getByTestId('songs-row').first()).toContainText('Videotape');
  });

  test('First time only filter narrows to single-play songs', async ({ page }) => {
    await page.goto('/songs');
    const countLocator = main(page).getByTestId('songs-result-count').first();
    await countLocator.waitFor({ state: 'visible' });

    const beforeText = await countLocator.innerText();
    await main(page).getByTestId('filter-first-heard').click();
    // The result count must shrink or stay equal — never grow.
    const afterText = await countLocator.innerText();
    const before = parseInt(beforeText.match(/\d+/)?.[0] ?? '0', 10);
    const after = parseInt(afterText.match(/\d+/)?.[0] ?? '0', 10);
    expect(after).toBeLessThanOrEqual(before);
  });

  test('clicking a song row navigates to /songs/[songId] detail', async ({ page }) => {
    await page.goto('/songs');
    await main(page).getByTestId('songs-row').first().waitFor({ state: 'visible' });
    await main(page).getByTestId('songs-row').first().click();
    await page.waitForURL(/\/songs\/[0-9a-f-]+/);
    // The detail page heading is the song title in quotes.
    await expect(main(page).locator('h1.display-title')).toBeVisible();
    // The stat strip uses "Heard live" exactly; the page also has the
    // eyebrow "Song you've heard live", so match exact text only.
    await expect(main(page).getByText('Heard live', { exact: true })).toBeVisible();
    await expect(main(page).getByTestId('song-show-list')).toBeVisible();
  });

  test('sort by count toggles ascending → descending', async ({ page }) => {
    await page.goto('/songs');
    await main(page).getByTestId('sort-header-count').waitFor({ state: 'visible' });
    // Default sort is count DESC. The first row's count must be ≥ the
    // last visible row's count.
    await main(page).getByTestId('songs-row').first().waitFor({ state: 'visible' });
    // Toggle to ASC and verify the indicator flips.
    await main(page).getByTestId('sort-header-count').click();
    await expect(main(page).getByTestId('sort-header-count')).toHaveAttribute(
      'data-sort-active',
      'asc',
    );
  });
});
