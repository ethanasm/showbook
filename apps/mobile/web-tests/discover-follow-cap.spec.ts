import { test, expect } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Visual + regression coverage for the per-user follow caps on the
// Discover "Follow a venue" / "Follow an artist" sheets. Following is now
// capped server-side (100 venues, 250 artists via `assertUnderFollowCap`);
// the sheet surfaces the cap up front instead of letting the user search
// and then bounce off a server error. At cap, the search UI is replaced by
// "Maximum N <entity> — remove one to add another."
//
// Output PNGs land in `web-tests/.screenshots/follow-cap/` (gitignored).

const TEST_SESSION = {
  token: 'follow-cap-token',
  user: {
    id: 'follow-cap-user',
    email: 'follow-cap@showbook.dev',
    name: 'Follow Cap',
    image: null,
  },
};

const FUTURE = '2030-06-01';

function venues(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `venue-${i}`,
    name: `Venue ${i}`,
    city: 'New York',
    stateRegion: 'NY',
  }));
}

function artists(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `artist-${i}`,
    name: `Artist ${i}`,
    imageUrl: null,
  }));
}

const VENUE_FEED_ITEM = {
  id: 'fa-1',
  showDate: FUTURE,
  kind: 'concert',
  headliner: 'Some Headliner',
  productionName: null,
  support: [],
  headlinerPerformerId: 'p-1',
  supportPerformerIds: [],
  venue: { id: 'venue-0', name: 'Venue 0', city: 'New York' },
  venueId: 'venue-0',
  onSaleDate: '2029-06-01',
  onSaleStatus: 'on_sale',
  sourceUrl: null,
};

const ARTIST_FEED_ITEM = {
  ...VENUE_FEED_ITEM,
  id: 'fa-2',
  headliner: 'Artist 0',
  headlinerPerformerId: 'artist-0',
};

const OUT_DIR = join(__dirname, '.screenshots', 'follow-cap');

test.beforeAll(() => {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
});

async function installMocks(
  page: import('@playwright/test').Page,
  opts: { venueCount: number; artistCount: number },
): Promise<void> {
  await page.route('**/api/trpc/**', async (route) => {
    const url = new URL(route.request().url());
    const baseProcedure = (url.pathname.split('/api/trpc/')[1] ?? '').split('?')[0] ?? '';
    const isBatch = url.searchParams.get('batch') === '1';
    const procedures = isBatch ? baseProcedure.split(',') : [baseProcedure];

    const dataFor = (proc: string): unknown => {
      if (proc === 'discover.followedFeed') return { items: [VENUE_FEED_ITEM], nextCursor: null };
      if (proc === 'discover.followedArtistsFeed') return { items: [ARTIST_FEED_ITEM], nextCursor: null };
      if (proc === 'discover.nearbyFeed') return { items: [], hasRegions: false, nextCursors: {} };
      if (proc === 'venues.followed') return venues(opts.venueCount);
      if (proc === 'performers.followed') return artists(opts.artistCount);
      if (proc === 'preferences.get') {
        return { regions: [], notifications: { email: false, push: false }, emailDigest: { enabled: false } };
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

test.describe('mobile web — discover follow caps', () => {
  test('venue follow sheet at cap (100) shows the cap message', async ({ page }) => {
    await seedSession(page);
    await installMocks(page, { venueCount: 100, artistCount: 0 });

    await page.goto('/discover');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Venues' }).first().click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Follow a venue' }).first().click();
    await page.waitForTimeout(600);

    await expect(
      page.getByText('Maximum 100 venues — remove one to add another.'),
    ).toBeVisible({ timeout: 5_000 });

    await page.screenshot({
      path: join(OUT_DIR, 'pr-mobile-discover-venue-at-cap.png'),
      animations: 'disabled',
    });
  });

  test('artist follow sheet at cap (250) shows the cap message', async ({ page }) => {
    await seedSession(page);
    await installMocks(page, { venueCount: 0, artistCount: 250 });

    await page.goto('/discover');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Artists' }).first().click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Follow an artist' }).first().click();
    await page.waitForTimeout(600);

    await expect(
      page.getByText('Maximum 250 artists — remove one to add another.'),
    ).toBeVisible({ timeout: 5_000 });

    await page.screenshot({
      path: join(OUT_DIR, 'pr-mobile-discover-artist-at-cap.png'),
      animations: 'disabled',
    });
  });
});
