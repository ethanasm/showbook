import { test, expect } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Visual + regression coverage for the region cap on the Discover
// "Add region" bottom sheet. The sheet used to be unaware of the
// 5-region cap (`preferences.addRegion` throws once the user has 5),
// so a user at the cap could fill in the form and only learn it was
// rejected from the post-submit error toast. It now disables the
// ADD REGION button and shows "Maximum 5 regions — remove one to add
// another." the moment the sheet opens at cap.
//
// Two states are captured for contrast:
//   - below cap (4 regions): the normal add form, unchanged behaviour;
//   - at cap (5 regions): the disabled button + cap message.
// Output PNGs land in `web-tests/.screenshots/region-cap/` (gitignored)
// so the pr-screenshots skill can embed them inline on the PR.

const TEST_SESSION = {
  token: 'region-cap-token',
  user: {
    id: 'region-cap-user',
    email: 'region-cap@showbook.dev',
    name: 'Region Cap',
    image: null,
  },
};

const NOW = new Date();
const FUTURE = (days: number): string => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const ALL_REGIONS = [
  { id: 'region-nyc', cityName: 'New York', radiusMiles: 30, active: true, latitude: 40.7, longitude: -74.0 },
  { id: 'region-bay', cityName: 'San Francisco', radiusMiles: 25, active: true, latitude: 37.77, longitude: -122.42 },
  { id: 'region-la', cityName: 'Los Angeles', radiusMiles: 25, active: true, latitude: 34.05, longitude: -118.24 },
  { id: 'region-chi', cityName: 'Chicago', radiusMiles: 25, active: true, latitude: 41.88, longitude: -87.63 },
  { id: 'region-atx', cityName: 'Austin', radiusMiles: 25, active: true, latitude: 30.27, longitude: -97.74 },
];

const NEARBY_ITEMS = [
  {
    id: 'a-1',
    showDate: FUTURE(7),
    kind: 'concert',
    headliner: 'Phoebe Bridgers',
    productionName: null,
    support: [],
    headlinerPerformerId: 'p-1',
    supportPerformerIds: [],
    venue: { id: 'venue-bowery', name: 'Bowery Ballroom', city: 'New York' },
    venueId: 'venue-bowery',
    regionId: 'region-nyc',
    regionCityName: 'New York',
    regionRadiusMiles: 30,
    onSaleDate: FUTURE(3),
    onSaleStatus: 'on_sale',
    sourceUrl: null,
  },
  {
    id: 'a-2',
    showDate: FUTURE(9),
    kind: 'concert',
    headliner: 'Jay Som',
    productionName: null,
    support: [],
    headlinerPerformerId: 'p-2',
    supportPerformerIds: [],
    venue: { id: 'venue-fillmore', name: 'The Fillmore', city: 'San Francisco' },
    venueId: 'venue-fillmore',
    regionId: 'region-bay',
    regionCityName: 'San Francisco',
    regionRadiusMiles: 25,
    onSaleDate: FUTURE(2),
    onSaleStatus: 'on_sale',
    sourceUrl: null,
  },
];

const OUT_DIR = join(__dirname, '.screenshots', 'region-cap');

test.beforeAll(() => {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
});

async function openAddRegionSheet(
  page: import('@playwright/test').Page,
  regionCount: number,
): Promise<void> {
  const regions = ALL_REGIONS.slice(0, regionCount);

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
      if (proc === 'discover.nearbyFeed') {
        return { items: NEARBY_ITEMS, hasRegions: true, nextCursors: {} };
      }
      if (proc === 'discover.followedFeed' || proc === 'discover.followedArtistsFeed') {
        return { items: [], nextCursor: null };
      }
      if (proc === 'preferences.get') {
        return {
          regions,
          notifications: { email: false, push: false },
          emailDigest: { enabled: false },
        };
      }
      if (proc === 'venues.followed' || proc === 'performers.followed') return [];
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

  // Switch to the Regions sub-tab, then open the add sheet via the
  // leading "Add a region" chip.
  await page.getByRole('button', { name: 'Regions' }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Add a region' }).first().click();
  await page.waitForTimeout(600);
}

test.describe('mobile web — discover add-region cap', () => {
  test('at cap (5 regions): disables submit and shows the cap message', async ({ page }) => {
    await openAddRegionSheet(page, 5);

    await expect(
      page.getByText('Maximum 5 regions — remove one to add another.'),
    ).toBeVisible({ timeout: 5_000 });

    await page.screenshot({
      path: join(OUT_DIR, 'pr-mobile-discover-region-at-cap.png'),
      animations: 'disabled',
    });
  });

  test('below cap (4 regions): normal add form, no cap message', async ({ page }) => {
    await openAddRegionSheet(page, 4);

    // The CITY field is present and the cap message is absent.
    await expect(page.getByPlaceholder('e.g. Nashville')).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByText('Maximum 5 regions — remove one to add another.'),
    ).toHaveCount(0);

    await page.screenshot({
      path: join(OUT_DIR, 'pr-mobile-discover-region-below-cap.png'),
      animations: 'disabled',
    });
  });
});
