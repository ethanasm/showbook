import { test, expect } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

// Regression test for the mobile-layout bug fixed alongside this spec: when
// `.discover-row` used `64px minmax(0, 1fr) auto`, the centered kind chip's
// x-position depended on the auto column's content width. Rows with long
// venue or headliner text squeezed the 1fr column narrower and dragged the
// chip left, so the kind column was visibly misaligned across rows on
// mobile. The grid now uses a fixed-width middle column so the chip lives
// at the same x on every row.

test.describe('Discover kind column alignment (mobile)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) >= 900, 'mobile-only layout');

  test.beforeEach(async ({ page }) => {
    await loginAndSeedAsWorker(page);
  });

  test('kind chip x-position is identical across rows regardless of venue name length', async ({ page }) => {
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');
    await page.locator('.discover-row').first().waitFor({ state: 'visible' });

    const centers = await page.$$eval('.discover-row__kind', (nodes) =>
      nodes.map((n) => {
        const chip = n.getBoundingClientRect();
        const row = n.closest('.discover-row');
        const rowLeft = row ? row.getBoundingClientRect().left : 0;
        return chip.left + chip.width / 2 - rowLeft;
      }),
    );

    expect(centers.length, 'expected the seeded discover feed to have rows').toBeGreaterThanOrEqual(2);
    const spread = Math.max(...centers) - Math.min(...centers);
    // Sub-pixel rounding (deviceScaleFactor=2) leaves up to ~0.5 px of
    // wobble; require well under the 9.6 px shift the bug used to produce.
    expect(spread, `kind chip x-positions drifted by ${spread.toFixed(2)} px across rows`).toBeLessThan(1);
  });
});
