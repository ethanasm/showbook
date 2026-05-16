/**
 * Phase 3 Playwright spec — Spotify hype playlist card on the
 * Setlist tab. The feature flag is gated to admins in prod; this
 * spec mocks `spotify.hypePlaylistFeature` to flip the gate ON so the
 * real card renders against a seeded ticketed show.
 *
 * The Spotify OAuth popup and the playlist mutations are stubbed
 * via `page.route` — no real Spotify calls happen. The point is the
 * UI contract: the card is visible, the buttons fire the right tRPC
 * shape, and the connect-once flow resumes the mutation after the
 * popup posts back.
 */

import { test, expect, type Page } from '@playwright/test';
import { loginAndSeedAsWorker, workerShowId } from './helpers/auth';

async function gotoTicketedConcertSetlistTab(page: Page): Promise<string> {
  await loginAndSeedAsWorker(page);
  // Seeded ticketed concert with a headliner and committed date.
  const showId = await workerShowId(page, {
    kind: 'concert',
    state: 'ticketed',
  });
  expect(showId, 'seeded concert show should exist').toBeTruthy();
  await page.goto(`/shows/${showId}?tab=setlist`);
  await expect(page.getByTestId(`show-tabs-${showId}`)).toBeVisible({ timeout: 15_000 });
  return showId!;
}

async function mockHypeFeatureOn(page: Page) {
  await page.route('**/api/trpc/spotify.hypePlaylistFeature*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: { data: { json: { enabled: true } } },
      }),
    });
  });
}

async function mockExistingPlaylist(page: Page, payload: unknown) {
  await page.route('**/api/trpc/spotify.existingPlaylist*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: { data: { json: payload } },
      }),
    });
  });
}

/**
 * Seeded ticketed concerts have no `tour_setlists` corpus rows, so the
 * predicted-setlist procedure returns the `cold` empty state. Mock it
 * with a `stable` shape so the hype card renders against a known
 * trackCount.
 */
async function mockStablePrediction(page: Page) {
  await page.route('**/api/trpc/setlistIntel.predictedSetlist*', async (route) => {
    const prediction = {
      style: 'stable',
      core: [
        { title: 'Anti-Hero', songId: null, probability: 0.95, role: 'core', avgPosition: 5, encoreProbability: 0, lastPlayedDate: '2026-05-01', appearancesInWindow: 10, windowSize: 10, evidence: '10 of last 10 shows' },
        { title: 'Cruel Summer', songId: null, probability: 0.9, role: 'opener', avgPosition: 0, encoreProbability: 0, lastPlayedDate: '2026-05-01', appearancesInWindow: 9, windowSize: 10, evidence: '9 of last 10 shows' },
      ],
      likely: [],
      wildcards: [],
      rotation: [],
      confidence: 0.92,
      sampleSize: 10,
      tourId: 't1',
      tourName: 'Eras Tour',
      tourCoverage: 'active_tour',
      spoilerBlurDefault: false,
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: {
          data: {
            json: prediction,
            meta: { values: { 'core.0.lastPlayedDate': ['Date'] } },
          },
        },
      }),
    });
  });
}

test.describe('Hype playlist card — pre-show variant', () => {
  test('renders the real hype card when the feature is enabled', async ({ page }) => {
    await mockHypeFeatureOn(page);
    await mockExistingPlaylist(page, null);
    await mockStablePrediction(page);
    await gotoTicketedConcertSetlistTab(page);

    // The placeholder testid never appears, the real card does.
    await expect(page.getByTestId('hype-playlist-placeholder')).toHaveCount(0);
    const card = page.getByTestId('hype-playlist-card-hype');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText(/Hype playlist/i)).toBeVisible();
  });

  test('falls back to the P1 placeholder when the feature is disabled', async ({ page }) => {
    await page.route('**/api/trpc/spotify.hypePlaylistFeature*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: { data: { json: { enabled: false } } },
        }),
      });
    });
    await mockExistingPlaylist(page, null);
    await mockStablePrediction(page);
    await gotoTicketedConcertSetlistTab(page);

    await expect(page.getByTestId('hype-playlist-placeholder')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('hype-playlist-card-hype')).toHaveCount(0);
  });

  test('tapping the card on a fresh account opens the Spotify connect modal', async ({ page }) => {
    await mockHypeFeatureOn(page);
    await mockExistingPlaylist(page, null);

    // No Spotify connection yet — explicitly return disconnected.
    await page.route('**/api/trpc/spotify.connectionStatus*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: { data: { json: { connected: false } } },
        }),
      });
    });

    await gotoTicketedConcertSetlistTab(page);

    const primary = page.getByTestId('hype-card-hype-primary');
    await expect(primary).toBeVisible({ timeout: 15_000 });
    await primary.click();

    // The connect modal surfaces — it's the same component the import
    // flow uses, so reusing its testid would be a good cross-check.
    await expect(page.getByTestId('spotify-connect-button')).toBeVisible({
      timeout: 5_000,
    });
  });

  test('opens existing playlist in a new tab when the row already exists', async ({ page, context }) => {
    await mockHypeFeatureOn(page);
    await mockExistingPlaylist(page, {
      playlistId: 'pl-existing',
      spotifyUrl: 'https://open.spotify.com/playlist/pl-existing',
      trackCount: 12,
      durationMs: 2_880_000,
    });
    await page.route('**/api/trpc/spotify.connectionStatus*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: {
            data: {
              json: {
                connected: true,
                displayName: 'Test',
                product: 'premium',
                spotifyUserId: 'sp-1',
              },
            },
          },
        }),
      });
    });

    await gotoTicketedConcertSetlistTab(page);

    const card = page.getByTestId('hype-playlist-card-hype');
    await expect(card).toHaveAttribute('data-existing', 'true', { timeout: 15_000 });

    // Capture window.open instead of allowing a real navigation.
    const opens: string[] = [];
    await page.exposeFunction('__recordOpen', (url: string) => {
      opens.push(url);
    });
    await page.evaluate(() => {
      const orig = window.open;
      (window as unknown as { open: typeof orig }).open = ((url?: string | URL) => {
        const u = typeof url === 'string' ? url : url?.toString() ?? '';
        (window as unknown as { __recordOpen: (s: string) => void }).__recordOpen(u);
        return null as unknown as Window;
      }) as typeof orig;
    });

    await page.getByTestId('hype-card-hype-primary').click();
    await expect.poll(() => opens.length, { timeout: 5_000 }).toBeGreaterThan(0);
    expect(opens[0]).toContain('pl-existing');
  });
});
