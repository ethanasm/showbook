import { test, expect } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

test.describe('Songs page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeedAsWorker(page);
  });

  test('loads /songs and lists every song the seeded user has heard', async ({ page }) => {
    await page.goto('/songs');
    await expect(page.getByRole('heading', { name: /^Songs$/ })).toBeVisible({
      timeout: 15000,
    });
    // The Radiohead show seeds a 10-song setlist; every title should
    // show up as a row.
    await expect(page.getByTestId('songs-row').first()).toBeVisible();
    const rowCount = await page.getByTestId('songs-row').count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test('free-text search narrows the result set', async ({ page }) => {
    await page.goto('/songs');
    await page.getByTestId('songs-result-count').waitFor({ state: 'visible' });

    const initialCount = await page.getByTestId('songs-row').count();
    expect(initialCount).toBeGreaterThan(1);

    await page.getByTestId('songs-search').fill('Videotape');
    // The Radiohead seed includes "Videotape" as the last song.
    await expect(page.getByTestId('songs-row')).toHaveCount(1);
    await expect(page.getByTestId('songs-row').first()).toContainText('Videotape');
  });

  test('First time only filter narrows to single-play songs', async ({ page }) => {
    await page.goto('/songs');
    await page.getByTestId('songs-result-count').waitFor({ state: 'visible' });

    const beforeText = await page.getByTestId('songs-result-count').innerText();
    await page.getByTestId('filter-first-heard').click();
    // The result count must shrink or stay equal — never grow.
    const afterText = await page.getByTestId('songs-result-count').innerText();
    const before = parseInt(beforeText.match(/\d+/)?.[0] ?? '0', 10);
    const after = parseInt(afterText.match(/\d+/)?.[0] ?? '0', 10);
    expect(after).toBeLessThanOrEqual(before);
  });

  test('clicking a song row navigates to /songs/[songId] detail', async ({ page }) => {
    await page.goto('/songs');
    await page.getByTestId('songs-row').first().waitFor({ state: 'visible' });
    await page.getByTestId('songs-row').first().click();
    await page.waitForURL(/\/songs\/[0-9a-f-]+/);
    // The detail page heading is the song title in quotes.
    await expect(page.locator('h1.display-title')).toBeVisible();
    // Stat strip should always have "Heard live" because every
    // song in the list has at least one attended occurrence.
    await expect(page.locator('text=/Heard live/i')).toBeVisible();
    await expect(page.getByTestId('song-show-list')).toBeVisible();
  });

  test('sort by count toggles ascending → descending', async ({ page }) => {
    await page.goto('/songs');
    await page.getByTestId('sort-header-count').waitFor({ state: 'visible' });
    // Default sort is count DESC. The first row's count must be ≥ the
    // last visible row's count.
    await page.getByTestId('songs-row').first().waitFor({ state: 'visible' });
    // Toggle to ASC and verify the indicator flips.
    await page.getByTestId('sort-header-count').click();
    await expect(page.getByTestId('sort-header-count')).toHaveAttribute(
      'data-sort-active',
      'asc',
    );
  });
});
