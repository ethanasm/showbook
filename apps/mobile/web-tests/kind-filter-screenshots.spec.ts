/**
 * Capture the header kind-filter feature on the Home, Shows, and Map tabs
 * for PR visual review. tRPC is mocked so the Expo web bundle renders a
 * representative logbook without a backend. Not part of the smoke gate —
 * this spec only exists to produce the PR-body screenshots.
 */

import { test, expect } from '@playwright/test';

const TEST_SESSION = {
  token: 'web-shim-kind-filter-token',
  user: {
    id: 'web-shim-kind-filter-user',
    email: 'kindfilter@showbook.dev',
    name: 'Kind Filter Shim',
    image: null,
  },
};

function performer(id: string, name: string) {
  return {
    performer: { id, name, imageUrl: null },
    role: 'headliner' as const,
    sortOrder: 0,
  };
}

function venue(id: string, name: string, city: string) {
  return { id, name, city };
}

// A small logbook spanning kinds + states. "Today" in the harness is
// 2026-06-06, so 06-20 onward are upcoming and the May/Apr/Mar shows are
// past. Comedy is past-only (so the filtered Home shows an empty Upcoming
// section); theatre + festival are upcoming-only.
const SAMPLE_SHOWS = [
  {
    id: 's1', kind: 'concert', state: 'ticketed', date: '2026-07-10',
    endDate: null, seat: 'Row F · 12', pricePaid: '85', productionName: null,
    coverImageUrl: null, ticketUrl: null, createdAt: '2026-05-01T00:00:00.000Z',
    venue: venue('v1', 'The Fillmore', 'San Francisco'),
    showPerformers: [performer('p1', 'Phoenix')],
  },
  {
    id: 's2', kind: 'concert', state: 'watching', date: '2026-08-15',
    endDate: null, seat: null, pricePaid: null, productionName: null,
    coverImageUrl: null, ticketUrl: null, createdAt: '2026-05-02T00:00:00.000Z',
    venue: venue('v2', 'Greek Theatre', 'Berkeley'),
    showPerformers: [performer('p2', 'Beach House')],
  },
  {
    id: 's3', kind: 'theatre', state: 'ticketed', date: '2026-06-20',
    endDate: null, seat: 'Orch C 4', pricePaid: '120', productionName: 'Hamilton',
    coverImageUrl: null, ticketUrl: null, createdAt: '2026-05-03T00:00:00.000Z',
    venue: venue('v3', 'Orpheum Theatre', 'San Francisco'),
    showPerformers: [],
  },
  {
    id: 's4', kind: 'festival', state: 'ticketed', date: '2026-07-25',
    endDate: '2026-07-27', seat: null, pricePaid: '399', productionName: 'Outside Lands',
    coverImageUrl: null, ticketUrl: null, createdAt: '2026-05-04T00:00:00.000Z',
    venue: venue('v4', 'Golden Gate Park', 'San Francisco'),
    showPerformers: [],
  },
  {
    id: 's5', kind: 'concert', state: 'past', date: '2026-05-01',
    endDate: null, seat: 'GA', pricePaid: '60', productionName: null,
    coverImageUrl: null, ticketUrl: null, createdAt: '2026-04-01T00:00:00.000Z',
    venue: venue('v1', 'The Fillmore', 'San Francisco'),
    showPerformers: [performer('p5', 'The National')],
  },
  {
    id: 's6', kind: 'comedy', state: 'past', date: '2026-03-15',
    endDate: null, seat: 'Table 4', pricePaid: '45', productionName: null,
    coverImageUrl: null, ticketUrl: null, createdAt: '2026-03-01T00:00:00.000Z',
    venue: venue('v5', "Cobb's Comedy Club", 'San Francisco'),
    showPerformers: [performer('p6', 'John Mulaney')],
  },
  {
    id: 's7', kind: 'concert', state: 'past', date: '2026-04-10',
    endDate: null, seat: 'GA', pricePaid: '40', productionName: null,
    coverImageUrl: null, ticketUrl: null, createdAt: '2026-03-20T00:00:00.000Z',
    venue: venue('v6', 'The Independent', 'San Francisco'),
    showPerformers: [performer('p7', 'Wednesday')],
  },
];

// Map shape (shows.listForMap) — venue coords + flat headliner fields.
const MAP_SHOWS = SAMPLE_SHOWS.filter((s) => s.state === 'past').map((s) => ({
  id: s.id, kind: s.kind, state: s.state, date: s.date, seat: s.seat,
  pricePaid: s.pricePaid, ticketCount: 1,
  venue: {
    id: s.venue.id, name: s.venue.name, city: s.venue.city,
    stateRegion: 'CA',
    latitude: s.id === 's6' ? 37.7989 : 37.7840,
    longitude: s.id === 's6' ? -122.4079 : -122.4330,
    photoUrl: null,
  },
  headlinerName: s.showPerformers[0]?.performer.name ?? null,
  headlinerId: s.showPerformers[0]?.performer.id ?? null,
  headlinerImageUrl: null,
}));

function payloadFor(proc: string): unknown {
  if (proc.includes('shows.listForMap')) return MAP_SHOWS;
  if (proc.includes('shows.list')) return SAMPLE_SHOWS;
  if (proc.includes('preferences.get')) return { regions: [] };
  return [];
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ token, userJson }) => {
      window.localStorage.setItem('secureStore::showbook.auth.token', token);
      window.localStorage.setItem('secureStore::showbook.auth.user', userJson);
      window.localStorage.setItem('secureStore::showbook.auth.firstRunComplete', 'true');
    },
    { token: TEST_SESSION.token, userJson: JSON.stringify(TEST_SESSION.user) },
  );

  // httpBatchLink batches GET /api/trpc/<proc1,proc2,...>?batch=1&input=…
  // The response must be an array with one entry per batched procedure, in
  // order. Parse the comma-separated proc list out of the path and map each
  // to a payload so multi-proc batches resolve cleanly.
  await page.route('**/api/trpc/**', async (route) => {
    const url = new URL(route.request().url());
    const procPath = decodeURIComponent(url.pathname.split('/api/trpc/')[1] ?? '');
    const procs = procPath.split(',');
    const body = procs.map((proc) => ({
      result: { data: { json: payloadFor(proc) } },
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
});

test('home — default (hero + sections)', async ({ page }) => {
  await page.goto('/(tabs)');
  await expect(page.getByText('showbook').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Recently attended').first()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/screenshots/home-default.png' });
});

test('home — kind filter menu open', async ({ page }) => {
  await page.goto('/(tabs)');
  await expect(page.getByText('showbook').first()).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('home-filter-button').click();
  await expect(page.getByTestId('home-kind-menu')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/screenshots/home-menu-open.png' });
});

test('home — filtered to comedy (empty upcoming message)', async ({ page }) => {
  await page.goto('/(tabs)');
  await expect(page.getByText('showbook').first()).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('home-filter-button').click();
  await page.getByTestId('home-kind-option-comedy').click();
  await expect(page.getByText('No upcoming comedy shows.')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/screenshots/home-filtered-comedy.png' });
});

test('shows — filtered empty state with clear', async ({ page }) => {
  await page.goto('/(tabs)/shows');
  // Default bucket is Past; filter to festival (no past festival) → empty.
  await expect(page.getByTestId('shows-filter-button')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('shows-filter-button').click();
  await page.getByTestId('shows-kind-option-festival').click();
  await expect(page.getByText('Clear filter')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/screenshots/shows-filtered-empty.png' });
});

test('map — header filter (no kind pill strip)', async ({ page }) => {
  await page.goto('/(tabs)/map');
  await expect(page.getByTestId('map-filter-button')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('map-filter-button').click();
  await expect(page.getByTestId('map-kind-menu')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/screenshots/map-header-filter.png' });
});
