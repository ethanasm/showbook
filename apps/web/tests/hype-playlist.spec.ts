/**
 * Phase 3 Playwright spec — Spotify hype playlist card on the
 * Setlist tab. This spec mocks the relevant tRPC endpoints
 * (existingPlaylist, connectionStatus, predictedSetlist) via a
 * single batch-aware interceptor so the real card renders against
 * a seeded ticketed show.
 *
 * Why batch-aware: the tRPC client uses `httpBatchLink`, which
 * concatenates several procs into one URL like `/api/trpc/a,b,c`.
 * A naive route pattern that only matches the first proc would
 * drop the rest of the batched response. We intercept ALL
 * `/api/trpc/*` requests, parse the proc list out of the URL, and
 * return a properly-shaped array.
 */

import { test, expect, type Page } from '@playwright/test';
import { loginAndSeedAsWorker, workerShowId } from './helpers/auth';

const STABLE_PREDICTION = {
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

interface MockOverrides {
  connectionStatus?:
    | { connected: false }
    | {
        connected: true;
        displayName: string | null;
        product: string | null;
        spotifyUserId: string | null;
      };
  existingPlaylist?: null | {
    playlistId: string;
    spotifyUrl: string;
    trackCount: number;
    durationMs: number;
  };
  /** When true, return STABLE_PREDICTION for setlistIntel.predictedSetlist. */
  predictionStable?: boolean;
}

/**
 * Single batch-aware tRPC interceptor. Parses the URL's proc list,
 * builds a response array entry-per-proc, and substitutes overrides
 * where present. Unhandled procs are passed through to the real
 * server (via a direct fetch).
 */
async function installTrpcMocks(page: Page, overrides: MockOverrides) {
  await page.route('**/api/trpc/**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/trpc/')) return route.continue();
    const procPath = url.pathname.slice('/api/trpc/'.length);
    const procs = procPath.split(',');
    const handled = procs.map((p) => overrideFor(p, overrides));
    // If every proc has an override, fulfill purely from mocks.
    if (handled.every((h) => h !== undefined)) {
      const body = procs.length === 1 ? handled[0] : handled;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
      return;
    }
    // Mixed batch — fetch from the real server, then patch in the
    // overrides at the right indices so we keep the live result for
    // any uncovered procs.
    const realResp = await fetch(route.request().url(), {
      method: route.request().method(),
      headers: await route.request().allHeaders(),
      body: route.request().postData() ?? undefined,
    });
    const text = await realResp.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return route.continue();
    }
    if (Array.isArray(parsed)) {
      for (let i = 0; i < procs.length; i += 1) {
        if (handled[i] !== undefined) parsed[i] = handled[i];
      }
      await route.fulfill({
        status: realResp.status,
        contentType: 'application/json',
        body: JSON.stringify(parsed),
      });
      return;
    }
    // Single-proc batch response — overwrite the entire body if we
    // have an override for that one proc.
    if (procs.length === 1 && handled[0] !== undefined) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(handled[0]),
      });
      return;
    }
    await route.fulfill({
      status: realResp.status,
      contentType: 'application/json',
      body: text,
    });
  });
}

function wrapResult(json: unknown, meta?: unknown) {
  return { result: { data: { json, ...(meta ? { meta } : {}) } } };
}

function overrideFor(proc: string, overrides: MockOverrides): unknown {
  if (proc === 'spotify.connectionStatus' && overrides.connectionStatus) {
    return wrapResult(overrides.connectionStatus);
  }
  if (proc === 'spotify.existingPlaylist' && overrides.existingPlaylist !== undefined) {
    return wrapResult(overrides.existingPlaylist);
  }
  if (proc === 'setlistIntel.predictedSetlist' && overrides.predictionStable) {
    return wrapResult(STABLE_PREDICTION, {
      values: { 'core.0.lastPlayedDate': ['Date'] },
    });
  }
  return undefined;
}

async function gotoTicketedConcertSetlistTab(page: Page): Promise<string> {
  await loginAndSeedAsWorker(page);
  // The /api/test/show-id route accepts headliner + venueName for
  // concerts; Taylor Swift @ MSG is the seeded ticketed concert
  // with a committed date.
  const showId = await workerShowId(page, {
    headliner: 'Taylor Swift',
    venueName: 'Madison Square Garden',
    state: 'ticketed',
  });
  expect(showId, 'seeded concert show should exist').toBeTruthy();
  await page.goto(`/shows/${showId}?tab=setlist`);
  await expect(page.getByTestId(`show-tabs-${showId}`)).toBeVisible({ timeout: 15_000 });
  return showId!;
}

// The card renders inline only — section-scope locators kept from
// when a compact right-rail copy also mounted on ≥1200px viewports,
// so they're robust against any future reintroduction of a sibling
// render in the same SectionFrame.
function inlineCard(page: Page) {
  return page
    .getByTestId('show-section-hype-playlist')
    .getByTestId('hype-playlist-card-hype');
}
function inlinePrimary(page: Page) {
  return page
    .getByTestId('show-section-hype-playlist')
    .getByTestId('hype-card-hype-primary');
}

test.describe('Hype playlist card — pre-show variant', () => {
  test('renders the real hype card for a stable prediction', async ({ page }) => {
    await installTrpcMocks(page, {
      existingPlaylist: null,
      connectionStatus: { connected: false },
      predictionStable: true,
    });
    await gotoTicketedConcertSetlistTab(page);

    await expect(page.getByTestId('hype-playlist-placeholder')).toHaveCount(0);
    await expect(inlineCard(page)).toBeVisible({ timeout: 15_000 });
    await expect(
      page
        .getByTestId('show-section-hype-playlist')
        .getByText(/Hype playlist/i)
        .first(),
    ).toBeVisible();
  });

  test('tapping the card on a fresh account opens the Spotify connect modal', async ({ page }) => {
    await installTrpcMocks(page, {
      existingPlaylist: null,
      connectionStatus: { connected: false },
      predictionStable: true,
    });
    await gotoTicketedConcertSetlistTab(page);

    const primary = inlinePrimary(page);
    await expect(primary).toBeVisible({ timeout: 15_000 });
    await primary.click();

    // The connect modal surfaces — same component the import flow uses.
    await expect(page.getByTestId('spotify-connect-button')).toBeVisible({
      timeout: 5_000,
    });
  });

  test('opens existing playlist in a new tab when the row already exists', async ({ page }) => {
    await installTrpcMocks(page, {
      existingPlaylist: {
        playlistId: 'pl-existing',
        spotifyUrl: 'https://open.spotify.com/playlist/pl-existing',
        trackCount: 12,
        durationMs: 2_880_000,
      },
      connectionStatus: {
        connected: true,
        displayName: 'Test',
        product: 'premium',
        spotifyUserId: 'sp-1',
      },
      predictionStable: true,
    });

    await gotoTicketedConcertSetlistTab(page);

    await expect(inlineCard(page)).toHaveAttribute('data-existing', 'true', { timeout: 15_000 });

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

    await inlinePrimary(page).click();
    await expect.poll(() => opens.length, { timeout: 5_000 }).toBeGreaterThan(0);
    expect(opens[0]).toContain('pl-existing');
  });
});
