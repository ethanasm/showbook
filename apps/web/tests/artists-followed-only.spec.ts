import { test, expect } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

// Smoke coverage for the "Followed only" filter on /artists. The seeded
// fixture user has no follows, so toggling the chip empties the list and
// surfaces the empty-state CTA. This proves the chip is wired to the
// list filter without needing to fight the per-worker seed to inject a
// follow-only artist (see the integration test
// `performers-list-followed.integration.test.ts` for that path).

test.describe('/artists — Followed only filter', () => {
  test('toggling Followed only narrows the list to follow rows', async ({ page }) => {
    await loginAndSeedAsWorker(page);
    await page.goto('/artists');

    // Seeded user has 12 non-theatre performers; filter starts off.
    const toggle = page.getByTestId('artists-followed-only-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    const beforeCountText = await page.getByText(/\d+ artists?/).first().textContent();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    // No follows in the seed → the empty state copy renders. Use the
    // testid the empty-state action group emits so we don't double-match
    // the eyebrow or filter-bar text.
    await expect(page.getByTestId('artists-empty-actions')).toBeVisible();

    // Toggle back off restores the full list.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    const afterCountText = await page.getByText(/\d+ artists?/).first().textContent();
    expect(afterCountText).toBe(beforeCountText);
  });
});
