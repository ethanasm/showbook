/**
 * Regression for the Discoverable-layer crash on the Map tab.
 *
 * Even with the native map shimmed out for the web target, this spec
 * exercises the cluster / fitRegion / viewport-cull code paths against
 * a synthetic 2,500-announcement feed spread across the continental US
 * — i.e. the same shape the user has in prod where tapping the
 * Discoverable pill hard-crashed the iOS app. The test asserts that
 * (a) the map screen mounts without a pageerror, and (b) the
 * Discoverable pill can be tapped without surfacing the local
 * ErrorBoundary fallback ("Map failed to load").
 *
 * It does NOT prove the native iOS crash is gone — that needs a
 * device — but it does prove the JS path can chew through the
 * thousands-of-rows feed without throwing, which the previous fix
 * never verified.
 */

import { test, expect } from '@playwright/test';

const TEST_SESSION = {
  token: 'web-shim-discoverable-token',
  user: {
    id: 'web-shim-discoverable-user',
    email: 'discoverable@showbook.dev',
    name: 'Discoverable Shim',
    image: null,
  },
};

// A handful of past shows so the Past layer has data + the auto-fit runs.
const PAST_SHOWS = [
  {
    id: 'past-1',
    kind: 'concert',
    state: 'past',
    date: '2025-12-12T19:30:00.000Z',
    seat: 'GA',
    pricePaid: '85',
    ticketCount: 1,
    venue: {
      id: 'venue-bowery',
      name: 'Bowery Ballroom',
      city: 'New York',
      stateRegion: 'NY',
      latitude: 40.7204,
      longitude: -73.9934,
      photoUrl: null,
    },
    headlinerName: 'The Strokes',
    headlinerId: 'p1',
    headlinerImageUrl: null,
  },
];

// 2,500 discoverable announcements at synthetic venues spread across
// the continental US. The grid scatters them between roughly Seattle
// and Miami so fitRegion has to cope with a wide spread — the same
// shape that crashed prod.
function buildDiscoverableFeed(count: number) {
  const rows: unknown[] = [];
  for (let i = 0; i < count; i += 1) {
    // Pseudo-random lat/lng inside the continental US.
    const lat = 26 + ((i * 17) % 23); // 26..49
    const lng = -123 + ((i * 31) % 56); // -123..-67
    rows.push({
      id: `disc-${i}`,
      kind: i % 5 === 0 ? 'theatre' : 'concert',
      state: 'discoverable',
      date: '2026-08-01',
      seat: null,
      pricePaid: null,
      ticketCount: 1,
      venue: {
        id: `venue-${i % 800}`, // 800 unique venue ids → some clustering
        name: `Venue ${i % 800}`,
        city: 'Anytown',
        stateRegion: 'US',
        latitude: lat,
        longitude: lng,
        photoUrl: null,
        googlePlaceId: null,
      },
      headlinerName: `Headliner ${i}`,
      headlinerId: null,
      headlinerImageUrl: null,
    });
  }
  // A couple of pathological rows so the sanitiser earns its keep:
  // Null Island and an out-of-range latitude.
  rows.push({
    id: 'disc-null-island',
    kind: 'concert',
    state: 'discoverable',
    date: '2026-09-01',
    seat: null,
    pricePaid: null,
    ticketCount: 1,
    venue: {
      id: 'venue-null',
      name: 'Null Island',
      city: null,
      stateRegion: null,
      latitude: 0,
      longitude: 0,
      photoUrl: null,
      googlePlaceId: null,
    },
    headlinerName: 'NaN Energy',
    headlinerId: null,
    headlinerImageUrl: null,
  });
  rows.push({
    id: 'disc-out-of-range',
    kind: 'concert',
    state: 'discoverable',
    date: '2026-09-02',
    seat: null,
    pricePaid: null,
    ticketCount: 1,
    venue: {
      id: 'venue-bad',
      name: 'Bad Coord',
      city: null,
      stateRegion: null,
      latitude: 999,
      longitude: 9999,
      photoUrl: null,
      googlePlaceId: null,
    },
    headlinerName: 'Out of Bounds',
    headlinerId: null,
    headlinerImageUrl: null,
  });
  return rows;
}

test('Map tab survives switching to Discoverable with a 2.5k-row feed', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.addInitScript(
    ({ token, userJson }) => {
      window.localStorage.setItem('secureStore::showbook.auth.token', token);
      window.localStorage.setItem('secureStore::showbook.auth.user', userJson);
      window.localStorage.setItem(
        'secureStore::showbook.auth.firstRunComplete',
        'true',
      );
    },
    {
      token: TEST_SESSION.token,
      userJson: JSON.stringify(TEST_SESSION.user),
    },
  );

  const discoverableFeed = buildDiscoverableFeed(2500);

  await page.route('**/api/trpc/**', async (route) => {
    const url = route.request().url();
    if (url.includes('shows.listForMap')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ result: { data: { json: PAST_SHOWS } } }]),
      });
      return;
    }
    if (url.includes('discover.mapFeed')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { result: { data: { json: discoverableFeed } } },
        ]),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ result: { data: { json: [] } } }]),
    });
  });

  await page.goto('/(tabs)/map');

  // Wait for the discoverable pill (it includes the count once the
  // mapFeed warm-up resolves), which proves the screen mounted and
  // both queries hydrated.
  const discoverablePill = page.getByRole('button', {
    name: /^discoverable\s*\(\d+\)/i,
  });
  await expect(discoverablePill).toBeVisible({ timeout: 15_000 });

  await discoverablePill.click();

  // After the layer flip, the eyebrow at the top of the screen
  // shows the discoverable layer's venue count (`800 VENUES` for the
  // 800 unique venue ids in the fixture). Wait on it to confirm the
  // layer change propagated through the cluster/visibleClusters
  // pipeline without throwing.
  await expect(page.getByText(/^800 VENUES$/)).toBeVisible({
    timeout: 5_000,
  });

  // The local ErrorBoundary fallback would surface this title if any
  // descendant of the MapView threw during the layer transition.
  await expect(page.getByText('Map failed to load')).toHaveCount(0);

  // And no JS pageerror should have fired while the 2.5k-row feed was
  // being clustered / rendered.
  expect(
    pageErrors,
    `pageerror events: ${pageErrors.join('\n')}`,
  ).toEqual([]);

  // Capture a screenshot so the PR has a visible record of the
  // marker-cap behaviour on the Discoverable layer.
  await page.screenshot({
    path: 'test-results/screenshots/map-discoverable-large-feed.png',
    fullPage: false,
  });
});
