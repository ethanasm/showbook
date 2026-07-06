import { test, expect } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

// Regression tests for the Discover-feed grid template that the surrounding
// commit re-tuned:
//
//   - Mobile: rows used `64px minmax(0, 1fr) auto`. The kind chip sat in
//     the 1fr middle column, so its centered x-position depended on how
//     wide the auto third column rendered for each row. Long venue text
//     squeezed the middle column narrower and dragged the chip ~10 px left
//     compared to short-text rows.
//   - Desktop: rows used `72px 100px 1fr 120px 110px 200px`. Fixed columns
//     summed to more than a 1280 px viewport could afford after the
//     220 px main sidebar and 240 px discover rail, leaving the 1fr
//     headliner cell at ~40 px — short names like "Bon Iver" rendered as
//     "Bon…".
//
// Both assertions exercise the seeded feed (e2e-w<idx>@showbook.dev,
// followed-venues view, ~3 announcements).

test.describe('Discover kind alignment + headliner width', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeedAsWorker(page);
  });

  test('mobile: kind chip x-position is identical across rows', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 1440) >= 900, 'mobile-only layout');
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
    // Sub-pixel rounding at deviceScaleFactor=2 leaves up to ~0.5 px of
    // wobble; the broken layout produced ~9.6 px of drift.
    expect(spread, `kind chip x-positions drifted by ${spread.toFixed(2)} px across rows`).toBeLessThan(1);
  });

  test('desktop: Watch/Calendar buttons align across rows with and without ticket links', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 900, 'desktop-only layout');
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');
    await page.locator('.discover-row').first().waitFor({ state: 'visible' });

    // The actions cell right-aligns with flex-end, so rows without a
    // ticketUrl used to slide Watch + Calendar right into the space the
    // Ticketmaster button occupies on other rows. A hidden placeholder
    // now reserves that slot. The seed mixes both states (Bon Iver and
    // Alvvays have ticketUrls; Trevor Noah / Fleet Foxes / Hamilton
    // don't), so assert every Calendar button shares one x-position.
    const states = await page.$$eval('.discover-row', (rows) =>
      rows.map((row) => ({
        calendarLeft:
          row.querySelector('[data-testid="add-to-calendar"]')?.getBoundingClientRect().left ?? null,
        hasRealTix: !!row.querySelector('a.discover-tix-btn--icon-only'),
        hasPlaceholder: !!row.querySelector('.discover-tix-btn--placeholder'),
      })),
    );
    const lefts = states.map((s) => s.calendarLeft).filter((v): v is number => v !== null);
    expect(lefts.length, 'expected the seeded discover feed to have rows').toBeGreaterThanOrEqual(2);
    expect(states.some((s) => s.hasRealTix), 'seed should include a row with a ticket link').toBe(true);
    expect(states.some((s) => s.hasPlaceholder), 'seed should include a row without a ticket link').toBe(true);
    const spread = Math.max(...lefts) - Math.min(...lefts);
    expect(spread, `Calendar button x-positions drifted by ${spread.toFixed(2)} px across rows`).toBeLessThan(1);
  });

  test('desktop: headliner cell renders wide enough to show typical names without truncation', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 900, 'desktop-only layout');
    // Use a 1280 px viewport — narrower than the default desktop project
    // (1440) — to exercise the case where the original template starved
    // the 1fr headliner column.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');
    await page.locator('.discover-row').first().waitFor({ state: 'visible' });

    const widths = await page.$$eval('.discover-row__headliner-cell', (cells) =>
      cells.map((c) => c.getBoundingClientRect().width),
    );
    expect(widths.length, 'expected the seeded discover feed to have rows').toBeGreaterThanOrEqual(2);
    const minWidth = Math.min(...widths);
    // Sized to fit the shortest seeded headliner ("Hamilton", "Bon Iver")
    // at 14 px sans (~60 px text width) plus margin. The broken layout
    // collapsed this cell to ~40 px, hiding most of every name behind the
    // ellipsis.
    expect(minWidth, `headliner cell width was ${minWidth.toFixed(2)} px`).toBeGreaterThanOrEqual(100);
  });
});
