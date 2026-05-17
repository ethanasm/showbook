import { test, expect } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

// Smoke check for the inline follow toggle on /artists. The toggle
// lives inside the row's <Link> wrapper, so clicking it must
// stopPropagation/preventDefault — otherwise it would navigate to the
// artist detail page instead of toggling follow state.

test.describe('/artists — inline follow toggle', () => {
  test('clicking the eye toggle flips follow state without navigating', async ({ page }) => {
    await loginAndSeedAsWorker(page);
    await page.goto('/artists');

    // Pick the first follow toggle on the page. The data-testid carries
    // the artist id; we don't need it — we just need a stable selector.
    const toggle = page.locator('[data-testid^="artist-follow-toggle-"]').first();
    await expect(toggle).toBeVisible();

    const startingPressed = await toggle.getAttribute('aria-pressed');

    await toggle.click();

    // URL stays on /artists (no navigation to /artists/<id>).
    await expect(page).toHaveURL(/\/artists(?:\?.*)?$/);

    // aria-pressed flips. The tRPC mutation is async; wait for the
    // re-render to land.
    await expect(toggle).not.toHaveAttribute('aria-pressed', startingPressed ?? '');

    // Restore the original state so this test doesn't leak follow rows
    // into the shared worker user — other specs (e.g.
    // artists-followed-only.spec.ts) assume the seeded user has zero
    // follows. The `/api/test/seed` endpoint does not reset follow
    // rows, so the cleanup has to happen client-side.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', startingPressed ?? '');
  });
});
