import { test, expect, type Page } from '@playwright/test';

// Tablet shell regression coverage for the two-pane redesign:
//
//   1. At the tablet breakpoint the tab bar renders as a vertical icon
//      rail on the LEFT edge (tabBarPosition: 'left'), not a bottom bar.
//   2. The Shows tab composes the SplitViewLayout — list sidebar plus a
//      "Select a show" detail placeholder — and tapping a row renders
//      the show detail IN PLACE (no route push) with the tablet-only
//      venue map card present on the Overview tab.
//   3. The Map tab gets essentially the full content width (the old
//      three-pane shell pinned it to a 360pt sliver).
//
// Driven against the Expo Web bundle like the rest of web-tests; the
// 1180×820 viewport approximates an 11" iPad in landscape, which is
// comfortably past the 900pt TABLET_MIN_WIDTH breakpoint.

const TEST_SESSION = {
  token: 'tablet-split-token',
  user: {
    id: 'tablet-split-user',
    email: 'tablet@showbook.dev',
    name: 'Tablet Tester',
    image: null,
  },
};

const VENUE = {
  id: 'sb-venue-fox',
  name: 'Fox Theater — Oakland',
  city: 'Oakland',
  stateRegion: 'CA',
  country: 'US',
  latitude: 37.808,
  longitude: -122.272,
  googlePlaceId: null,
  photoUrl: null,
};

const SHOW_LIST_ROW = {
  id: 'sb-show-midnight',
  userId: TEST_SESSION.user.id,
  kind: 'concert',
  state: 'past',
  date: '2026-05-09',
  endDate: null,
  seat: 'GA',
  pricePaid: '55',
  ticketCount: 1,
  productionName: null,
  coverImageUrl: null,
  tourName: null,
  notes: null,
  rating: null,
  source: 'manual',
  ticketmasterId: null,
  ticketUrl: null,
  createdAt: '2026-04-01T18:00:00.000Z',
  updatedAt: '2026-05-10T18:00:00.000Z',
  venue: VENUE,
  showPerformers: [
    {
      showId: 'sb-show-midnight',
      performerId: 'sb-performer-midnight',
      role: 'headliner',
      sortOrder: 0,
      characterName: null,
      performer: {
        id: 'sb-performer-midnight',
        name: 'The Midnight',
        imageUrl: null,
      },
    },
  ],
  setlists: null,
};

const TRPC_STUBS: Record<string, unknown> = {
  'shows.list': [SHOW_LIST_ROW],
  'shows.detail': SHOW_LIST_ROW,
  'shows.songBadges': { byPerformerId: {} },
  'setlistIntel.trackPreviewsForShow': { previews: {} },
  'media.listForShow': [],
  'shows.listForMap': [
    {
      id: SHOW_LIST_ROW.id,
      kind: 'concert',
      state: 'past',
      date: '2026-05-09',
      seat: 'GA',
      pricePaid: '55',
      ticketCount: 1,
      venue: VENUE,
      headlinerName: 'The Midnight',
    },
  ],
  // Must be listed before the feed-shaped `discover.*` fallback below:
  // the map screen builds `new Set(watchedQuery.data)` from this, and a
  // non-array crashes the whole route into the error boundary.
  'discover.watchedAnnouncementIds': [],
};

async function seedAndStub(page: Page): Promise<void> {
  await page.addInitScript(
    ({ token, userJson }) => {
      window.localStorage.setItem('secureStore::showbook.auth.token', token);
      window.localStorage.setItem('secureStore::showbook.auth.user', userJson);
      window.localStorage.setItem(
        'secureStore::showbook.auth.firstRunComplete',
        'true',
      );
    },
    { token: TEST_SESSION.token, userJson: JSON.stringify(TEST_SESSION.user) },
  );

  // Same stub strategy as pr-screenshots.spec.ts: named procedures get
  // payloads, everything else falls back to an empty/null shape so the
  // screen renders its empty branch instead of erroring.
  await page.route('**/api/trpc/**', async (route) => {
    const url = new URL(route.request().url());
    const procedurePath = url.pathname.split('/api/trpc/')[1] ?? '';
    const baseProcedure = procedurePath.split('?')[0] ?? '';
    const isBatch = url.searchParams.get('batch') === '1';
    const procedures = isBatch ? baseProcedure.split(',') : [baseProcedure];

    const dataFor = (proc: string): unknown => {
      if (proc in TRPC_STUBS) return TRPC_STUBS[proc];
      if (proc.startsWith('discover.')) {
        if (proc === 'discover.mapFeed') return [];
        return { items: [], hasRegions: false, nextCursor: null };
      }
      if (
        proc === 'performers.list' ||
        proc === 'performers.followed' ||
        proc === 'venues.list' ||
        proc === 'venues.followed'
      ) {
        return [];
      }
      return null;
    };

    const results = procedures.map((p) => ({
      result: { data: { json: dataFor(p) } },
    }));

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(isBatch ? results : results[0]),
    });
  });
}

test.describe('tablet shell (1180×820)', () => {
  test.use({ viewport: { width: 1180, height: 820 } });

  test('tab bar renders as a left rail, not a bottom bar', async ({ page }) => {
    await seedAndStub(page);
    await page.goto('/shows');
    await expect(page.getByText('Select a show')).toBeVisible({
      timeout: 15_000,
    });

    // On a 1180pt-wide bottom bar "Discover" (last tab) would sit at
    // x ≈ 950; on the left rail every tab label hugs the left edge.
    for (const label of ['Home', 'Map', 'Discover']) {
      const box = await page
        .getByText(label, { exact: true })
        .first()
        .boundingBox();
      expect(box, `tab label "${label}" should be visible`).not.toBeNull();
      expect(
        box!.x,
        `tab label "${label}" should sit in the left rail`,
      ).toBeLessThan(120);
    }
  });

  test('shows tab: split view selects in place and renders the venue map card', async ({
    page,
  }) => {
    await seedAndStub(page);
    await page.goto('/shows');

    // Empty detail pane placeholder + the list sidebar, side by side.
    await expect(page.getByText('Select a show')).toBeVisible({
      timeout: 15_000,
    });
    const row = page.getByTestId('show-card-row-0');
    await expect(row).toBeVisible();

    await row.click();

    // Selection renders in place: detail shell appears, placeholder
    // goes away, and the URL does NOT change to /show/<id>.
    const detail = page.getByTestId('show-detail-tabs-root');
    await expect(detail).toBeVisible({ timeout: 10_000 });
    await expect(detail.getByText('The Midnight').first()).toBeVisible();
    await expect(page.getByText('Select a show')).toHaveCount(0);
    expect(new URL(page.url()).pathname).not.toContain('/show/');

    // The list sidebar is still on screen alongside the detail pane.
    await expect(row).toBeVisible();

    // Tablet-only Overview extra: the venue mini-map card (the web
    // bundle renders the react-native-maps placeholder inside it).
    const mapCard = page.getByTestId('venue-map-card');
    await expect(mapCard).toBeAttached();
  });

  test('map tab gets (nearly) the full content width', async ({ page }) => {
    await seedAndStub(page);
    await page.goto('/map');

    const map = page.getByTestId('map-view');
    await expect(map).toBeVisible({ timeout: 15_000 });
    const box = await map.boundingBox();
    expect(box).not.toBeNull();
    // The retired three-pane shell capped the map at 360pt. With the
    // rail (~100pt) the map should now own the rest of the window.
    expect(box!.width).toBeGreaterThan(900);
  });
});
