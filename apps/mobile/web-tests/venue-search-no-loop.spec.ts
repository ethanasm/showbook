import { test, expect } from '@playwright/test';

// Regression for the "Follow a venue" search flicker: the sheet's search
// effect used to depend on the whole `venueSearch` memo object, whose
// identity changes every time a search toggles loading / sets results.
// That re-fired the effect after every search, looping `runSearch`
// forever — the UI flickered between "Searching…" and "No venues found"
// even after the user stopped typing, and the backend was hammered with
// repeating `venues.search` / `enrichment.searchPlaces` calls.
//
// This test counts those calls after a single (debounced) query for a
// venue with no results. With the loop, the count keeps climbing; fixed,
// it stabilises and the sheet settles on "No venues found".

const TEST_SESSION = {
  token: 'venue-search-token',
  user: {
    id: 'venue-search-user',
    email: 'venue-search@showbook.dev',
    name: 'Venue Search',
    image: null,
  },
};

async function installMocks(
  page: import('@playwright/test').Page,
  counters: { searchCalls: number },
): Promise<void> {
  await page.route('**/api/trpc/**', async (route) => {
    const url = new URL(route.request().url());
    const baseProcedure = (url.pathname.split('/api/trpc/')[1] ?? '').split('?')[0] ?? '';
    const isBatch = url.searchParams.get('batch') === '1';
    const procedures = isBatch ? baseProcedure.split(',') : [baseProcedure];

    const dataFor = (proc: string): unknown => {
      if (proc === 'discover.followedFeed') return { items: [], nextCursor: null };
      if (proc === 'discover.followedArtistsFeed') return { items: [], nextCursor: null };
      if (proc === 'discover.nearbyFeed') return { items: [], hasRegions: false, nextCursors: {} };
      if (proc === 'venues.followed') return [];
      if (proc === 'performers.followed') return [];
      if (proc === 'preferences.get') {
        return { regions: [], notifications: { email: false, push: false }, emailDigest: { enabled: false } };
      }
      if (proc === 'discover.watchedAnnouncementIds') return [];
      if (proc === 'shows.list') return [];
      // The two halves of the typeahead. Both return nothing for the
      // queried venue so the sheet lands on the "No venues found" state.
      if (proc === 'venues.search') {
        counters.searchCalls += 1;
        return [];
      }
      if (proc === 'enrichment.searchPlaces') {
        counters.searchCalls += 1;
        return [];
      }
      return null;
    };

    const results = procedures.map((p) => ({ result: { data: { json: dataFor(p) } } }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(isBatch ? results : results[0]),
    });
  });
}

async function seedSession(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(
    ({ token, userJson }) => {
      window.localStorage.setItem('secureStore::showbook.auth.token', token);
      window.localStorage.setItem('secureStore::showbook.auth.user', userJson);
      window.localStorage.setItem('secureStore::showbook.auth.firstRunComplete', 'true');
    },
    { token: TEST_SESSION.token, userJson: JSON.stringify(TEST_SESSION.user) },
  );
}

test('venue follow sheet does not loop searches after the query settles', async ({ page }) => {
  const counters = { searchCalls: 0 };
  await seedSession(page);
  await installMocks(page, counters);

  await page.goto('/discover');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Venues' }).first().click();
  await page.waitForTimeout(400);
  // With no followed venues the Discover empty state surfaces a
  // "Search venues" CTA that opens the follow sheet.
  await page.getByRole('button', { name: 'Search venues' }).first().click();
  await page.waitForTimeout(400);

  await page.getByTestId('discover-add-venue-input').fill('Smith Center Las Vegas');

  // Settle the no-results state.
  await expect(page.getByText('No venues found.')).toBeVisible({ timeout: 5_000 });

  // Let any runaway loop accumulate calls, then assert the count is
  // stable across a second window. The fixed effect fires once per
  // half (venues.search + enrichment.searchPlaces) → 2 total; allow a
  // little slack for React Query retry without admitting a loop.
  await page.waitForTimeout(800);
  const afterSettle = counters.searchCalls;
  await page.waitForTimeout(1_500);
  const afterWait = counters.searchCalls;

  expect(afterWait).toBe(afterSettle);
  expect(afterSettle).toBeLessThanOrEqual(6);
  // The no-results text must stay put — no flicker back into "Searching…".
  await expect(page.getByText('No venues found.')).toBeVisible();
});
