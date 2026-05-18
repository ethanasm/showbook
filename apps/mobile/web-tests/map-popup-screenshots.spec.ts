/**
 * Capture before/after screenshots of the Map tab venue popup so the
 * PR reviewer doesn't have to pull the branch and tap a pin.
 *
 * Run independently of the smoke suite — this spec mocks tRPC and is
 * only useful for the visual-review attachment workflow.
 */

import { test, expect } from '@playwright/test';

const TEST_SESSION = {
  token: 'web-shim-map-token',
  user: {
    id: 'web-shim-map-user',
    email: 'map@showbook.dev',
    name: 'Map Shim',
    image: null,
  },
};

const SAMPLE_SHOWS = [
  {
    id: 'show-1',
    kind: 'concert',
    state: 'past',
    date: '2025-12-12T19:30:00.000Z',
    seat: 'Row F · Seat 12',
    pricePaid: '85',
    ticketCount: 1,
    venue: {
      id: 'venue-1',
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
  {
    id: 'show-2',
    kind: 'concert',
    state: 'past',
    date: '2024-06-08T20:00:00.000Z',
    seat: 'GA',
    pricePaid: '60',
    ticketCount: 2,
    venue: {
      id: 'venue-1',
      name: 'Bowery Ballroom',
      city: 'New York',
      stateRegion: 'NY',
      latitude: 40.7204,
      longitude: -73.9934,
      photoUrl: null,
    },
    headlinerName: 'Vampire Weekend',
    headlinerId: 'p2',
    headlinerImageUrl: null,
  },
  {
    id: 'show-3',
    kind: 'comedy',
    state: 'past',
    date: '2024-02-14T22:00:00.000Z',
    seat: 'Table 4',
    pricePaid: '45',
    ticketCount: 2,
    venue: {
      id: 'venue-1',
      name: 'Bowery Ballroom',
      city: 'New York',
      stateRegion: 'NY',
      latitude: 40.7204,
      longitude: -73.9934,
      photoUrl: null,
    },
    headlinerName: 'John Mulaney',
    headlinerId: 'p3',
    headlinerImageUrl: null,
  },
];

test('map popup — capture sheet after tapping a pin', async ({ page }) => {
  // Seed the auth shim before any module loads so the auth gate
  // routes straight to the tab shell.
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

  // Mock the tRPC `shows.listForMap` query so the map has pins to tap.
  // httpBatchLink fetches GET /api/trpc/<procs>?batch=1&input=…. The
  // response is a JSON array of { result: { data: { json: … } } }
  // entries (superjson on the wire).
  await page.route('**/api/trpc/**', async (route) => {
    const url = route.request().url();
    if (url.includes('shows.listForMap')) {
      const body = [
        { result: { data: { json: SAMPLE_SHOWS } } },
      ];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
      return;
    }
    // Other tRPC procedures return empty payloads — we don't want them
    // to fail and surface error UI on top of the screenshot.
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ result: { data: { json: [] } } }]),
    });
  });

  await page.goto('/(tabs)/map');

  // Wait for the tab shell to settle, then click the first marker that
  // the web shim rendered. The shim turns Markers into pressables with
  // accessibility label "map marker".
  const marker = page.getByLabel('map marker').first();
  await expect(marker).toBeVisible({ timeout: 15_000 });
  await marker.click();

  // The venue sheet opens in a Modal — assert the venue title is in
  // the DOM to know the sheet rendered before we screenshot.
  await expect(page.getByText('Bowery Ballroom').first()).toBeVisible({
    timeout: 5_000,
  });

  // Give the slide animation a moment to settle.
  await page.waitForTimeout(500);

  await page.screenshot({
    path: 'test-results/screenshots/map-popup.png',
    fullPage: false,
  });
});
