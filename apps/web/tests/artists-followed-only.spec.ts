import { test, expect } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

// Smoke coverage for the scope segmented control on /artists. The seeded
// fixture user has no follows, so selecting "Following" empties the list
// and surfaces the empty-state CTA. This proves the segments are wired to
// the list filter without needing to fight the per-worker seed to inject
// a follow-only artist (see the integration test
// `performers-list-followed.integration.test.ts` for that path).

test.describe('/artists — scope filter', () => {
  test('selecting Following narrows the list to follow rows', async ({ page }) => {
    await loginAndSeedAsWorker(page);
    await page.goto('/artists');

    // Seeded user has 12 non-theatre performers; default scope is "All".
    // `.first()` defends against a transient hydration race where both
    // the server-rendered shell and the client-rendered tree are
    // momentarily in the DOM with the same testid — see the same
    // pattern in global-search.spec.ts.
    const followingSegment = page.getByTestId('artists-followed-only-toggle').first();
    const allSegment = page.getByTestId('artists-scope-all').first();
    await expect(followingSegment).toBeVisible();
    await expect(followingSegment).toHaveAttribute('aria-pressed', 'false');
    await expect(allSegment).toHaveAttribute('aria-pressed', 'true');
    const beforeCountText = await page.getByText(/\d+ artists?/).first().textContent();

    await followingSegment.click();
    await expect(followingSegment).toHaveAttribute('aria-pressed', 'true');
    await expect(allSegment).toHaveAttribute('aria-pressed', 'false');

    // No follows in the seed → the empty state copy renders. Use the
    // testid the empty-state action group emits so we don't double-match
    // the eyebrow or filter-bar text.
    await expect(page.getByTestId('artists-empty-actions').first()).toBeVisible();

    // Switching back to "All" restores the full list.
    await allSegment.click();
    await expect(allSegment).toHaveAttribute('aria-pressed', 'true');
    await expect(followingSegment).toHaveAttribute('aria-pressed', 'false');
    const afterCountText = await page.getByText(/\d+ artists?/).first().textContent();
    expect(afterCountText).toBe(beforeCountText);
  });

  test('In my shows and Seen live segments filter the list', async ({ page }) => {
    await loginAndSeedAsWorker(page);
    await page.goto('/artists');

    const allSegment = page.getByTestId('artists-scope-all').first();
    const inShowsSegment = page.getByTestId('artists-scope-inShows').first();
    const seenLiveSegment = page.getByTestId('artists-scope-seenLive').first();

    await expect(allSegment).toHaveAttribute('aria-pressed', 'true');

    // "In my shows" is mutually exclusive with "All" and updates the
    // section header to reflect the active scope.
    await inShowsSegment.click();
    await expect(inShowsSegment).toHaveAttribute('aria-pressed', 'true');
    await expect(allSegment).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText(/In my shows · \d+/).first()).toBeVisible();

    // "Seen live" likewise — and clicking it deselects "In my shows".
    await seenLiveSegment.click();
    await expect(seenLiveSegment).toHaveAttribute('aria-pressed', 'true');
    await expect(inShowsSegment).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText(/Seen live · \d+/).first()).toBeVisible();
  });
});
