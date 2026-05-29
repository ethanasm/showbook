import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Visual + regression coverage for the Discover → Regions two-tier
// filter (region chip row + venue chip row underneath). Verifies:
//   - The region chip row renders chips from the user's followed
//     regions, sourced from `preferences.get`.
//   - With no region selected, the venue row reflects every venue
//     surfaced by the nearby feed.
//   - Picking a region narrows the venue row to that region's venues
//     and clears the previous venue selection.
//   - Picking a venue narrows the announcement list to that venue.
// Output snapshot lands in `web-tests/.screenshots/` so reviewers can
// see the new affordance inline on the PR. Same gitignored directory
// the existing `pr-screenshots.spec.ts` writes to.

const TEST_SESSION = {
  token: 'discover-filter-token',
  user: {
    id: 'discover-filter-user',
    email: 'discover-filter@showbook.dev',
    name: 'Discover Filter',
    image: null,
  },
};

const NOW = new Date();
const FUTURE = (days: number): string => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const REGIONS = [
  { id: 'region-nyc', cityName: 'New York', radiusMiles: 30, active: true, latitude: 40.7, longitude: -74.0 },
  { id: 'region-bay', cityName: 'San Francisco', radiusMiles: 25, active: true, latitude: 37.77, longitude: -122.42 },
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
    onSaleStatus: 'announced',
    sourceUrl: null,
  },
  {
    id: 'a-2',
    showDate: FUTURE(12),
    kind: 'concert',
    headliner: 'Black Country, New Road',
    productionName: null,
    support: [],
    headlinerPerformerId: 'p-2',
    supportPerformerIds: [],
    venue: { id: 'venue-bowery', name: 'Bowery Ballroom', city: 'New York' },
    venueId: 'venue-bowery',
    regionId: 'region-nyc',
    regionCityName: 'New York',
    regionRadiusMiles: 30,
    onSaleDate: FUTURE(5),
    onSaleStatus: 'on_sale',
    sourceUrl: null,
  },
  {
    id: 'a-3',
    showDate: FUTURE(20),
    kind: 'comedy',
    headliner: 'John Mulaney',
    productionName: null,
    support: [],
    headlinerPerformerId: 'p-3',
    supportPerformerIds: [],
    venue: { id: 'venue-msg', name: 'Madison Square Garden', city: 'New York' },
    venueId: 'venue-msg',
    regionId: 'region-nyc',
    regionCityName: 'New York',
    regionRadiusMiles: 30,
    onSaleDate: FUTURE(1),
    onSaleStatus: 'on_sale',
    sourceUrl: null,
  },
  {
    id: 'a-4',
    showDate: FUTURE(9),
    kind: 'concert',
    headliner: 'Jay Som',
    productionName: null,
    support: [],
    headlinerPerformerId: 'p-4',
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

const OUT_DIR = join(__dirname, '.screenshots');

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.describe('mobile web — discover regions venue filter', () => {
  test('renders the two-tier region + venue chip rows and filters announcements', async ({
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
        if (proc === 'discover.nearbyFeed') {
          return { items: NEARBY_ITEMS, hasRegions: true, nextCursors: {} };
        }
        if (proc === 'discover.followedFeed' || proc === 'discover.followedArtistsFeed') {
          return { items: [], nextCursor: null };
        }
        if (proc === 'preferences.get') {
          return {
            regions: REGIONS,
            notifications: { email: false, push: false },
            emailDigest: { enabled: false },
          };
        }
        if (proc === 'venues.followed' || proc === 'performers.followed') {
          return [];
        }
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

    // Switch to the Regions sub-tab. The SegmentedControl renders as a
    // Pressable with accessibilityLabel="Regions".
    await page.getByRole('button', { name: 'Regions' }).first().click();
    await page.waitForTimeout(500);

    // The region rail is the redesigned overflow rail: chips that fit
    // render inline, the rest live behind the trailing "+N" dropdown.
    // The rail picks a single id from the followed regions; assert both
    // are reachable (inline or via the dropdown picker) by id.
    await expect(filterOptionExists(page, 'discover-group', 'region-nyc')).resolves.toBe(true);
    await expect(filterOptionExists(page, 'discover-group', 'region-bay')).resolves.toBe(true);

    // The venue sub-rail underneath surfaces every venue from the nearby
    // feed: Bowery (NYC), MSG (NYC), Fillmore (SF).
    await expect(filterOptionExists(page, 'discover-venue-chip', 'venue-bowery')).resolves.toBe(true);
    await expect(filterOptionExists(page, 'discover-venue-chip', 'venue-msg')).resolves.toBe(true);
    await expect(filterOptionExists(page, 'discover-venue-chip', 'venue-fillmore')).resolves.toBe(true);

    // Snapshot — two-tier overflow rail, no horizontal scroll.
    await page.waitForTimeout(300);
    await page.screenshot({
      path: join(OUT_DIR, '12-discover-regions-filter-all-after.png'),
      fullPage: true,
      animations: 'disabled',
    });

    // Pick the New York region — the venue rail narrows to NYC venues
    // only (Bowery + MSG) and the Fillmore disappears entirely.
    await pickFilter(page, 'discover-group', 'region-nyc');
    await page.waitForTimeout(400);

    await expect(filterOptionExists(page, 'discover-venue-chip', 'venue-fillmore')).resolves.toBe(false);
    await expect(filterOptionExists(page, 'discover-venue-chip', 'venue-bowery')).resolves.toBe(true);
    await expect(filterOptionExists(page, 'discover-venue-chip', 'venue-msg')).resolves.toBe(true);

    await page.screenshot({
      path: join(OUT_DIR, '13-discover-regions-filter-nyc-after.png'),
      fullPage: true,
      animations: 'disabled',
    });

    // Pick Bowery — announcement list should narrow to the two Bowery
    // shows. MSG-only headliners (John Mulaney) drop out.
    await pickFilter(page, 'discover-venue-chip', 'venue-bowery');
    await page.waitForTimeout(400);

    await expect(page.getByText('Phoebe Bridgers').first()).toBeVisible();
    await expect(page.getByText('Black Country, New Road').first()).toBeVisible();
    await expect(page.getByText('John Mulaney')).toHaveCount(0);

    await page.screenshot({
      path: join(OUT_DIR, '14-discover-regions-filter-nyc-bowery-after.png'),
      fullPage: true,
      animations: 'disabled',
    });
  });
});

/**
 * Resolve whether a filter option is reachable in the redesigned rail —
 * either rendered inline as a chip, or listed in the overflow dropdown
 * sheet behind the trailing "+N" button. The off-screen measuring pass
 * the rail uses to decide what fits carries no testIDs, so chip / sheet
 * testIDs are unambiguous.
 */
async function filterOptionExists(
  page: import('@playwright/test').Page,
  prefix: string,
  id: string,
): Promise<boolean> {
  if ((await page.getByTestId(`${prefix}-${id}`).count()) > 0) return true;
  const more = page.getByTestId(`${prefix}-more`);
  if ((await more.count()) === 0) return false;
  await more.first().click();
  const present = (await page.getByTestId(`${prefix}-sheet-${id}`).count()) > 0;
  // Close the sheet via the backdrop so the next interaction starts clean.
  await page.getByRole('button', { name: 'Close sheet' }).first().click();
  await page.waitForTimeout(250);
  return present;
}

/** Select a filter option, clicking the inline chip when present and
 *  falling back to the overflow dropdown otherwise. */
async function pickFilter(
  page: import('@playwright/test').Page,
  prefix: string,
  id: string,
): Promise<void> {
  const inline = page.getByTestId(`${prefix}-${id}`);
  if ((await inline.count()) > 0) {
    await inline.first().click();
    return;
  }
  await page.getByTestId(`${prefix}-more`).first().click();
  await page.getByTestId(`${prefix}-sheet-${id}`).first().click();
}
