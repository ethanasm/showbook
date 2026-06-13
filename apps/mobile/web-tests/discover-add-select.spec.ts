import { test, expect } from '@playwright/test';

// Regression coverage for "the just-added Discover entity becomes the
// selected chip": following a venue / artist or adding a region from the
// AddToDiscoverSheet must leave that entity's chip selected so the feed
// scopes to it immediately (its ingest-pending state visible up front).
//
// Selection is asserted through its user-visible effect: each tab's feed
// starts with one announcement for a *base* entity, and once the new
// entity is auto-selected that row is filtered out and the scoped-empty
// copy renders. (react-native-web doesn't surface accessibilityState as
// aria-selected, so the DOM offers no direct selected attribute.)
//
// Mutations are mocked statefully — the followed-list / preferences mocks
// include the new entity once the follow / add mutation lands, mirroring
// what the real backend's invalidation round-trip returns.

const TEST_SESSION = {
  token: 'add-select-token',
  user: {
    id: 'add-select-user',
    email: 'add-select@showbook.dev',
    name: 'Add Select',
    image: null,
  },
};

const FUTURE = '2030-06-01';

const BASE_VENUE = { id: 'venue-base', name: 'Bowery Ballroom', city: 'New York', stateRegion: 'NY' };
const NEW_VENUE = {
  id: 'venue-new',
  name: 'Mercury Lounge',
  city: 'New York',
  stateRegion: 'NY',
  country: 'US',
  googlePlaceId: null,
};
const BASE_ARTIST = { id: 'artist-base', name: 'Arctic Monkeys', imageUrl: null };
const NEW_ARTIST = { id: 'artist-new', name: 'Radiohead', imageUrl: null };
const BASE_REGION = { id: 'region-base', cityName: 'New York', radiusMiles: 30, active: true, latitude: 40.71, longitude: -74.0 };
const NEW_REGION = { id: 'region-new', cityName: 'Hoboken', radiusMiles: 25, active: true, latitude: 40.744, longitude: -74.032 };

const VENUE_FEED_ITEM = {
  id: 'fa-1',
  showDate: FUTURE,
  kind: 'concert',
  headliner: 'Base Venue Headliner',
  productionName: null,
  support: [],
  headlinerPerformerId: 'p-other',
  supportPerformerIds: [],
  venue: { id: BASE_VENUE.id, name: BASE_VENUE.name, city: BASE_VENUE.city },
  venueId: BASE_VENUE.id,
  onSaleDate: '2029-06-01',
  onSaleStatus: 'on_sale',
  sourceUrl: null,
};

const ARTIST_FEED_ITEM = {
  ...VENUE_FEED_ITEM,
  id: 'fa-2',
  headliner: BASE_ARTIST.name,
  headlinerPerformerId: BASE_ARTIST.id,
};

const NEARBY_FEED_ITEM = {
  ...VENUE_FEED_ITEM,
  id: 'fa-3',
  headliner: 'Base Region Headliner',
  regionId: BASE_REGION.id,
  regionCityName: BASE_REGION.cityName,
  regionRadiusMiles: BASE_REGION.radiusMiles,
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
  // Flipped by the respective mutation mocks so the post-add refetches
  // include the new entity, like the real backend would.
  const state = { venueFollowed: false, artistFollowed: false, regionAdded: false };

  await page.route('**/api/trpc/**', async (route) => {
    const url = new URL(route.request().url());
    const baseProcedure = (url.pathname.split('/api/trpc/')[1] ?? '').split('?')[0] ?? '';
    const isBatch = url.searchParams.get('batch') === '1';
    const procedures = isBatch ? baseProcedure.split(',') : [baseProcedure];

    const dataFor = (proc: string): unknown => {
      if (proc === 'discover.followedFeed') {
        return { items: [VENUE_FEED_ITEM], nextCursor: null };
      }
      if (proc === 'discover.followedArtistsFeed') {
        return { items: [ARTIST_FEED_ITEM], nextCursor: null };
      }
      if (proc === 'discover.nearbyFeed') {
        return { items: [NEARBY_FEED_ITEM], hasRegions: true, nextCursors: {} };
      }
      if (proc === 'discover.ingestStatus') {
        return { venueIds: [], performerIds: [], regionIds: [] };
      }
      if (proc === 'venues.followed') {
        return state.venueFollowed ? [BASE_VENUE, NEW_VENUE] : [BASE_VENUE];
      }
      if (proc === 'performers.followed') {
        return state.artistFollowed ? [BASE_ARTIST, NEW_ARTIST] : [BASE_ARTIST];
      }
      if (proc === 'preferences.get') {
        return {
          regions: state.regionAdded ? [BASE_REGION, NEW_REGION] : [BASE_REGION],
          notifications: { email: false, push: false },
          emailDigest: { enabled: false },
        };
      }
      if (proc === 'venues.search') return [NEW_VENUE];
      if (proc === 'enrichment.searchPlaces') {
        return [
          {
            placeId: 'place-hoboken',
            displayName: 'Hoboken',
            formattedAddress: 'Hoboken, NJ, USA',
          },
        ];
      }
      if (proc === 'enrichment.placeDetails') {
        return { name: 'Hoboken', city: 'Hoboken', latitude: 40.744, longitude: -74.032 };
      }
      if (proc === 'discover.searchArtists') {
        return [{ id: 'tm-radiohead', name: 'Radiohead', imageUrl: null, mbid: null }];
      }
      if (proc === 'venues.follow') {
        state.venueFollowed = true;
        return { success: true };
      }
      if (proc === 'performers.followAttraction') {
        state.artistFollowed = true;
        return { performerId: NEW_ARTIST.id };
      }
      if (proc === 'preferences.addRegion') {
        state.regionAdded = true;
        return { ...NEW_REGION, ingestJobId: 'job-1' };
      }
      if (proc === 'discover.watchedAnnouncementIds') return [];
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

const SCOPED_EMPTY_TEXT = 'No upcoming announcements yet';

test.describe('mobile web — discover add auto-selects the new chip', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
    await installMocks(page);
  });

  test('following a venue selects its chip and scopes the feed', async ({ page }) => {
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');

    // Unfiltered feed shows the base venue's announcement.
    await expect(page.getByText('Base Venue Headliner').first()).toBeVisible();

    await page.getByTestId('discover-add-chip-venues').first().click();
    await page.waitForTimeout(600);

    await page.getByTestId('discover-add-venue-input').fill('Mercury');
    const result = page.getByTestId('discover-add-venue-result-venue-new');
    await expect(result).toBeVisible({ timeout: 5_000 });
    await result.click();

    // The new venue's chip appears and is auto-selected: the feed scopes
    // to it (no announcements yet), dropping the base venue's row.
    await expect(page.getByTestId('discover-group-venue-new')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(SCOPED_EMPTY_TEXT)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Base Venue Headliner')).toHaveCount(0);
  });

  test('following an artist selects its chip and scopes the feed', async ({ page }) => {
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Artists' }).first().click();
    await page.waitForTimeout(400);

    // The base artist's announcement row is visible (its venue line is
    // unique to the row — chip labels only carry artist names).
    await expect(page.getByText(BASE_VENUE.name).first()).toBeVisible();

    await page.getByTestId('discover-add-chip-artists').first().click();
    await page.waitForTimeout(600);

    await page.getByTestId('discover-add-artist-input').fill('Radio');
    const result = page.getByTestId('discover-add-artist-result-tm-radiohead');
    await expect(result).toBeVisible({ timeout: 5_000 });
    await result.click();

    await expect(page.getByTestId('discover-group-artist-new')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(SCOPED_EMPTY_TEXT)).toBeVisible({ timeout: 5_000 });
    // The base artist's announcement row (venue line) is filtered out;
    // the artist's chip itself stays in the rail.
    await expect(page.getByText(BASE_VENUE.name)).toHaveCount(0);
  });

  test('adding a region selects its chip and scopes the feed', async ({ page }) => {
    await page.goto('/discover');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Regions' }).first().click();
    await page.waitForTimeout(400);

    await expect(page.getByText('Base Region Headliner').first()).toBeVisible();

    await page.getByTestId('discover-add-chip-regions').first().click();
    await page.waitForTimeout(600);

    await page.getByTestId('regions-add-city-input').fill('Hobo');
    const suggestion = page.getByTestId('regions-add-suggestion-place-hoboken');
    await expect(suggestion).toBeVisible({ timeout: 5_000 });
    await suggestion.click();

    const submit = page.getByTestId('regions-add-submit');
    await expect(submit).toBeEnabled({ timeout: 5_000 });
    await submit.click();

    await expect(page.getByTestId('discover-group-region-new')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(SCOPED_EMPTY_TEXT)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Base Region Headliner')).toHaveCount(0);
  });
});
