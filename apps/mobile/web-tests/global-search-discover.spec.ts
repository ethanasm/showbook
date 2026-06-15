import { test, expect } from '@playwright/test';

// Coverage for the header-launched global search now surfacing
// not-yet-followed entities:
//   - the search affordance is reachable from a main tab header
//     (search-button) and opens the omnisearch modal;
//   - `discover.searchArtists` (Ticketmaster) and `venues.search`
//     (catalog) results render in decorated "to follow" sections,
//     deduped against the user's own log results;
//   - following an artist inline flips the row to its "Following" state.
//
// tRPC is mocked statefully so the inline follow mutation resolves like
// the real backend would.

const TEST_SESSION = {
  token: 'global-search-token',
  user: {
    id: 'global-search-user',
    email: 'global-search@showbook.dev',
    name: 'Global Search',
    image: null,
  },
};

// An owned artist whose name collides with a Ticketmaster hit — proves
// the dedupe drops the discoverable copy.
const OWNED_ARTIST = { id: 'p-owned', name: 'Phoenix', imageUrl: null, showCount: 3 };

const TM_ARTISTS = [
  { id: 'tm-phoenix', name: 'Phoenix', imageUrl: null, mbid: null }, // deduped out
  { id: 'tm-muna', name: 'Muna', imageUrl: null, mbid: null },
];

const CATALOG_VENUE = {
  id: 'venue-catalog',
  name: 'Brooklyn Steel',
  city: 'Brooklyn',
  stateRegion: 'NY',
  country: 'US',
  googlePlaceId: null,
  photoUrl: null,
  ticketmasterVenueId: null,
  pastShowsCount: 0,
  futureShowsCount: 0,
};

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

async function installMocks(page: import('@playwright/test').Page): Promise<void> {
  const state = { artistFollowed: false };

  await page.route('**/api/trpc/**', async (route) => {
    const url = new URL(route.request().url());
    const baseProcedure = (url.pathname.split('/api/trpc/')[1] ?? '').split('?')[0] ?? '';
    const isBatch = url.searchParams.get('batch') === '1';
    const procedures = isBatch ? baseProcedure.split(',') : [baseProcedure];

    const dataFor = (proc: string): unknown => {
      if (proc === 'search.global') {
        return { shows: [], performers: [OWNED_ARTIST], venues: [] };
      }
      if (proc === 'search.futureShows') return [];
      if (proc === 'discover.searchArtists') return TM_ARTISTS;
      if (proc === 'venues.search') return [CATALOG_VENUE];
      if (proc === 'performers.followAttraction') {
        state.artistFollowed = true;
        return { performerId: 'p-muna' };
      }
      if (proc === 'performers.list') return state.artistFollowed ? [{ id: 'p-muna' }] : [];
      // Discover feed invalidations fired by the follow mutation.
      if (proc === 'discover.followedFeed') return { items: [], nextCursor: null };
      if (proc === 'discover.followedArtistsFeed') return { items: [], nextCursor: null };
      if (proc === 'discover.nearbyFeed') return { items: [], hasRegions: false, nextCursors: {} };
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
}

test.describe('mobile web — global search surfaces entities to follow', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
    await installMocks(page);
  });

  test('header search opens omnisearch and lists not-followed artists + venues', async ({
    page,
  }) => {
    await page.goto('/(tabs)');
    await page.waitForLoadState('networkidle');

    // The search affordance lives in the header of a main tab.
    await page.getByTestId('search-button').first().click();

    const input = page.getByLabel('Search query');
    await expect(input).toBeVisible({ timeout: 5_000 });
    await input.fill('Phoenix');

    // Catalog venue renders in its decorated section.
    await expect(page.getByTestId(`search-discover-venue-${CATALOG_VENUE.id}`)).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText('VENUES TO FOLLOW · 1')).toBeVisible();

    // Ticketmaster artist that is NOT already in the log renders; the
    // colliding "Phoenix" is deduped against the owned result.
    await expect(page.getByTestId('search-discover-artist-tm-muna')).toBeVisible();
    await expect(page.getByTestId('search-discover-artist-tm-phoenix')).toHaveCount(0);
    await expect(page.getByText('ARTISTS TO FOLLOW · 1')).toBeVisible();
  });

  test('following a discoverable artist flips the row to Following', async ({ page }) => {
    await page.goto('/(tabs)');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('search-button').first().click();

    const input = page.getByLabel('Search query');
    await expect(input).toBeVisible({ timeout: 5_000 });
    await input.fill('Muna');

    const row = page.getByTestId('search-discover-artist-tm-muna');
    await expect(row).toBeVisible({ timeout: 5_000 });
    await row.click();

    // Row flips to its followed state (label + pill both read "Following").
    await expect(page.getByLabel('Following Muna')).toBeVisible({ timeout: 5_000 });
  });
});
