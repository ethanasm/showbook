import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Mobile Discover used to flatten multi-night runs (Phantom of the Opera
// at the Orpheum, May 28 – Jun 24) into a single `showDate` row, losing
// the other dates entirely. This spec proves:
//   - The row renders the run date range + "N dates" sub-label instead
//     of a single calendar tile.
//   - Tapping "Got ticket" opens the pick-a-date sheet with the full
//     `performanceDates` list (not just the first night).
//
// Output snapshot lands in `web-tests/.screenshots/` so reviewers can
// see the affordance inline on the PR.

const TEST_SESSION = {
  token: 'discover-runs-token',
  user: {
    id: 'discover-runs-user',
    email: 'discover-runs@showbook.dev',
    name: 'Discover Runs',
    image: null,
  },
};

const NOW = new Date();
const FUTURE = (days: number): string => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const RUN_START = FUTURE(8);
const RUN_END = FUTURE(35);
const PERFORMANCE_DATES = [
  FUTURE(8),
  FUTURE(9),
  FUTURE(10),
  FUTURE(14),
  FUTURE(15),
  FUTURE(16),
  FUTURE(21),
  FUTURE(22),
  FUTURE(23),
  FUTURE(28),
  FUTURE(29),
  FUTURE(30),
  RUN_END,
];

const FOLLOWED_ITEMS = [
  {
    id: 'a-phantom',
    showDate: RUN_START,
    runStartDate: RUN_START,
    runEndDate: RUN_END,
    performanceDates: PERFORMANCE_DATES,
    kind: 'theatre',
    headliner: 'Phantom of the Opera',
    productionName: 'The Phantom of the Opera',
    support: [],
    headlinerPerformerId: null,
    supportPerformerIds: [],
    venue: { id: 'venue-orpheum', name: 'Orpheum Theatre', city: 'San Francisco' },
    venueId: 'venue-orpheum',
    onSaleDate: FUTURE(-3),
    onSaleStatus: 'on_sale',
    sourceUrl: null,
    ticketUrl: null,
  },
];

const OUT_DIR = join(__dirname, '.screenshots');

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.describe('mobile web — discover multi-night runs', () => {
  test('renders the date range and opens the pick-date sheet on "Got ticket"', async ({
    page,
  }) => {
    await page.addInitScript(
      ({ token, userJson }) => {
        window.localStorage.setItem('secureStore::showbook.auth.token', token);
        window.localStorage.setItem('secureStore::showbook.auth.user', userJson);
        window.localStorage.setItem('secureStore::showbook.auth.firstRunComplete', 'true');
      },
      { token: TEST_SESSION.token, userJson: JSON.stringify(TEST_SESSION.user) },
    );

    await page.route('**/api/trpc/**', async (route) => {
      const url = new URL(route.request().url());
      const procedurePath = url.pathname.split('/api/trpc/')[1] ?? '';
      const baseProcedure = procedurePath.split('?')[0] ?? '';
      const isBatch = url.searchParams.get('batch') === '1';
      const procedures = isBatch ? baseProcedure.split(',') : [baseProcedure];

      const dataFor = (proc: string): unknown => {
        if (proc === 'discover.followedFeed') {
          return { items: FOLLOWED_ITEMS, nextCursor: null };
        }
        if (proc === 'discover.followedArtistsFeed') {
          return { items: [], nextCursor: null };
        }
        if (proc === 'discover.nearbyFeed') {
          return { items: [], hasRegions: false, nextCursors: {} };
        }
        if (proc === 'discover.watchedAnnouncementIds') return [];
        if (proc === 'preferences.get') {
          return {
            regions: [],
            notifications: { email: false, push: false },
            emailDigest: { enabled: false },
          };
        }
        if (proc === 'venues.followed') {
          return [
            { id: 'venue-orpheum', name: 'Orpheum Theatre', city: 'San Francisco' },
          ];
        }
        if (proc === 'performers.followed') return [];
        if (proc === 'shows.list') return [];
        return null;
      };

      const results = procedures.map((p) => ({ result: { data: { json: dataFor(p) } } }));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(isBatch ? results : results[0]),
      });
    });

    await page.goto('/discover');
    await page.waitForLoadState('networkidle');

    // The Venues tab is the default and the Phantom run lives in
    // followedFeed. The row should show a date *range* with an "N dates"
    // sub-label, not a single calendar tile.
    const runRow = page.locator('[data-testid="discover-row-run-a-phantom"]').first();
    await expect(runRow).toBeVisible({ timeout: 5_000 });
    // The date block should show a range (en-dash) and an "N dates"
    // sub-label rather than a single calendar tile.
    await expect(runRow.getByText('–')).toBeVisible();
    await expect(
      runRow.getByText(new RegExp(`${PERFORMANCE_DATES.length} dates`, 'i')),
    ).toBeVisible();

    await page.waitForTimeout(300);
    await page.screenshot({
      path: join(OUT_DIR, '15-discover-runs-row.png'),
      fullPage: true,
      animations: 'disabled',
    });

    // Tap the row to open the action sheet, then "Mark as ticketed" — the
    // pick-date sheet should open with every performance date as its own
    // button.
    await page.locator('[data-testid="discover-row-a-phantom"]').first().click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="announcement-action-ticketed"]').first().click();
    await page.waitForTimeout(400);

    for (const date of PERFORMANCE_DATES) {
      await expect(
        page.locator(`[data-testid="pick-date-${date}"]`),
      ).toBeVisible();
    }

    await page.screenshot({
      path: join(OUT_DIR, '16-discover-runs-pick-date-sheet.png'),
      fullPage: true,
      animations: 'disabled',
    });
  });
});
