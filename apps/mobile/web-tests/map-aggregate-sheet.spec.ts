/**
 * Verifies (and screenshots) the multi-venue *aggregate* sheet on the Map
 * tab. Several distinct venues sit within one grid cell, so they collapse
 * into a single aggregate marker. Tapping that marker must now open a sheet
 * that:
 *   - summarises the area ("N venues"),
 *   - lists every show across all venues in the cluster,
 *   - exposes a per-venue filter rail, and
 *   - offers an explicit "Zoom in on map" affordance.
 *
 * Before this change, tapping an aggregate only nudged the camera, which
 * left tightly-clustered (or coincident) venues permanently un-openable.
 *
 * Mocks tRPC — only useful for the visual-review / regression workflow,
 * not part of the smoke gate.
 */

import { test, expect } from '@playwright/test';

const TEST_SESSION = {
  token: 'web-shim-map-agg-token',
  user: {
    id: 'web-shim-map-agg-user',
    email: 'map-agg@showbook.dev',
    name: 'Map Agg Shim',
    image: null,
  },
};

// Three venues within ~30m of each other (well inside one grid cell at any
// zoom the auto-fit produces) so they always cluster into one aggregate.
const VENUE_A = {
  id: 'venue-a',
  name: 'Soda Bar',
  city: 'San Francisco',
  stateRegion: 'CA',
  latitude: 37.7694,
  longitude: -122.4196,
  photoUrl: null,
};
const VENUE_B = {
  id: 'venue-b',
  name: 'The Chapel',
  city: 'San Francisco',
  stateRegion: 'CA',
  latitude: 37.7696,
  longitude: -122.4198,
  photoUrl: null,
};
const VENUE_C = {
  id: 'venue-c',
  name: 'Bottom of the Hill',
  city: 'San Francisco',
  stateRegion: 'CA',
  latitude: 37.7692,
  longitude: -122.4194,
  photoUrl: null,
};

const SAMPLE_SHOWS = [
  {
    id: 'show-a1',
    kind: 'concert',
    state: 'past',
    date: '2025-11-02T03:30:00.000Z',
    seat: 'GA',
    pricePaid: '40',
    ticketCount: 1,
    venue: VENUE_A,
    headlinerName: 'Beach Fossils',
    headlinerId: 'p-a1',
    headlinerImageUrl: null,
  },
  {
    id: 'show-a2',
    kind: 'concert',
    state: 'past',
    date: '2024-09-20T03:00:00.000Z',
    seat: 'GA',
    pricePaid: '35',
    ticketCount: 2,
    venue: VENUE_A,
    headlinerName: 'Wednesday',
    headlinerId: 'p-a2',
    headlinerImageUrl: null,
  },
  {
    id: 'show-b1',
    kind: 'comedy',
    state: 'past',
    date: '2025-03-14T03:00:00.000Z',
    seat: 'Balcony',
    pricePaid: '55',
    ticketCount: 2,
    venue: VENUE_B,
    headlinerName: 'Tig Notaro',
    headlinerId: 'p-b1',
    headlinerImageUrl: null,
  },
  {
    id: 'show-c1',
    kind: 'concert',
    state: 'past',
    date: '2024-12-31T04:00:00.000Z',
    seat: 'GA',
    pricePaid: '50',
    ticketCount: 1,
    venue: VENUE_C,
    headlinerName: 'Thee Oh Sees',
    headlinerId: 'p-c1',
    headlinerImageUrl: null,
  },
];

test('map aggregate — tapping a cluster opens the filterable venue sheet', async ({
  page,
}) => {
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

  await page.route('**/api/trpc/**', async (route) => {
    const url = route.request().url();
    if (url.includes('shows.listForMap')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ result: { data: { json: SAMPLE_SHOWS } } }]),
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

  // The three nearby venues collapse into a single aggregate marker. The
  // web shim renders markers as pressables labelled "map marker".
  const marker = page.getByLabel('map marker').first();
  await expect(marker).toBeVisible({ timeout: 15_000 });
  await marker.click();

  // Aggregate header summarises the cluster, not a single venue.
  await expect(page.getByText('3 venues').first()).toBeVisible({
    timeout: 5_000,
  });
  // The filter rail carries an "All venues" chip plus each venue.
  await expect(page.getByText('All venues').first()).toBeVisible();
  await expect(page.getByText('Soda Bar').first()).toBeVisible();
  await expect(page.getByText('The Chapel').first()).toBeVisible();
  // The zoom affordance is present for aggregates.
  await expect(page.getByText('Zoom in on map').first()).toBeVisible();
  // And every cluster show is listed (cross-venue).
  await expect(page.getByText('Beach Fossils').first()).toBeVisible();
  await expect(page.getByText('Tig Notaro').first()).toBeVisible();

  await page.waitForTimeout(500);
  await page.screenshot({
    path: 'test-results/screenshots/map-aggregate-sheet.png',
    fullPage: false,
  });

  // Filtering by a single venue narrows the list to that venue's shows.
  await page.getByText('Soda Bar').first().click();
  await expect(page.getByText('Beach Fossils').first()).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText('Wednesday').first()).toBeVisible();
  // A show from a different venue should no longer be in the list.
  await expect(page.getByText('Tig Notaro')).toHaveCount(0);

  await page.waitForTimeout(400);
  await page.screenshot({
    path: 'test-results/screenshots/map-aggregate-sheet-filtered.png',
    fullPage: false,
  });
});
