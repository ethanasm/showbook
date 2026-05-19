/**
 * Warm-up + persister integration test.
 *
 * Composes `warmCacheForOfflineUse` with `attachQueryPersister` against
 * the in-memory `CacheStorage` to assert that after warm-up runs, the
 * storage layer has every key the screens will read on a cold start.
 *
 * This is the offline-mode equivalent of `outbox.integration.test.ts`:
 * unit tests verify each component in isolation, this one wires the
 * real cache stack end-to-end (sans React Native and sans SQLite).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';

import { createMemoryStorage } from '../../cache/memory-storage';
import { attachQueryPersister } from '../../cache/persister';
import { serializeQueryKey } from '../../cache/storage';
import {
  LAST_WARMUP_KEY,
  warmCacheForOfflineUse,
  type WarmupClientSurface,
} from '../../cache/warmup';

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function buildClient(): WarmupClientSurface {
  const make = (payload: unknown) => async (_input?: unknown) => payload;
  return {
    shows: {
      list: {
        query: make([
          {
            id: 's1',
            state: 'past',
            venue: { id: 'v1' },
            showPerformers: [{ performer: { id: 'p1' } }],
          },
        ]),
      },
      listForMap: { query: make([]) },
      detail: { query: make({ id: 's1', name: 'detail' }) },
      songBadges: { query: make({ badges: {}, titleToSongId: {} }) },
    },
    venues: {
      list: { query: make([{ id: 'v1', name: 'venue' }]) },
      followed: { query: make([]) },
      detail: { query: make({ id: 'v1', name: 'venue-detail' }) },
      upcomingAnnouncements: { query: make([]) },
      userShows: { query: make([]) },
    },
    performers: {
      list: { query: make([{ id: 'p1', name: 'performer' }]) },
      followed: { query: make([]) },
      detail: { query: make({ id: 'p1', name: 'performer-detail' }) },
      userShows: { query: make([]) },
    },
    media: {
      listForShow: { query: make([]) },
      listForVenue: { query: make([]) },
      listForPerformer: { query: make([]) },
    },
    preferences: { get: { query: make({ theme: 'system', regions: [] }) } },
    setlistIntel: {
      musicLayerV2Feature: { query: make({ enabled: false }) },
      predictedSetlist: { query: make({ style: 'cold' }) },
      trackPreviewsForShow: { query: make({ previews: {} }) },
    },
    spotify: {
      hypePlaylistFeature: { query: make({ enabled: false }) },
      connectionStatus: { query: make({ connected: false }) },
    },
    discover: {
      followedFeed: { query: make({ items: [] }) },
      followedArtistsFeed: { query: make({ items: [] }) },
      nearbyFeed: { query: make({ items: [] }) },
    },
  };
}

describe('warmup + persister integration', () => {
  it('every warm-up step lands in CacheStorage with the canonical key', async () => {
    const storage = createMemoryStorage();
    const qc = new QueryClient();
    const detach = attachQueryPersister(qc, { storage });

    const client = buildClient();
    await warmCacheForOfflineUse({ client, queryClient: qc, skipReplay: true });
    // The persister is event-driven (cache.subscribe → storage.set). Allow
    // a tick for the writes to land.
    await tick();

    // ────── Roots ──────
    assert.ok(await storage.get(serializeQueryKey(['mobile', 'shows.list'])));
    assert.ok(await storage.get(serializeQueryKey(['mobile', 'home', 'shows.list'])));
    assert.ok(await storage.get(serializeQueryKey(['mobile', 'shows.listForMap'])));
    assert.ok(await storage.get(serializeQueryKey(['mobile', 'venues', 'list'])));
    assert.ok(await storage.get(serializeQueryKey(['mobile', 'venues', 'followed'])));
    assert.ok(await storage.get(serializeQueryKey(['mobile', 'artists', 'list'])));
    assert.ok(await storage.get(serializeQueryKey(['mobile', 'artists', 'followed'])));

    // tRPC-native key shapes
    assert.ok(
      await storage.get(
        serializeQueryKey([
          ['preferences', 'get'],
          { input: undefined, type: 'query' },
        ]),
      ),
    );
    assert.ok(
      await storage.get(
        serializeQueryKey([
          ['setlistIntel', 'musicLayerV2Feature'],
          { input: undefined, type: 'query' },
        ]),
      ),
    );
    assert.ok(
      await storage.get(
        serializeQueryKey([
          ['spotify', 'hypePlaylistFeature'],
          { input: undefined, type: 'query' },
        ]),
      ),
    );
    assert.ok(
      await storage.get(
        serializeQueryKey([
          ['spotify', 'connectionStatus'],
          { input: undefined, type: 'query' },
        ]),
      ),
    );

    // ────── Per-show (past — full bundle including badges + previews) ──────
    assert.ok(
      await storage.get(
        serializeQueryKey([
          ['shows', 'detail'],
          { input: { showId: 's1' }, type: 'query' },
        ]),
      ),
    );
    assert.ok(
      await storage.get(
        serializeQueryKey([
          ['shows', 'songBadges'],
          { input: { showId: 's1' }, type: 'query' },
        ]),
      ),
    );
    assert.ok(
      await storage.get(
        serializeQueryKey([
          ['setlistIntel', 'trackPreviewsForShow'],
          { input: { showId: 's1' }, type: 'query' },
        ]),
      ),
    );

    // ────── Per-venue + per-performer (union of show/list/followed) ──────
    assert.ok(await storage.get(serializeQueryKey(['mobile', 'venue', 'v1', 'detail'])));
    assert.ok(
      await storage.get(serializeQueryKey(['mobile', 'venue', 'v1', 'upcoming'])),
    );
    assert.ok(await storage.get(serializeQueryKey(['mobile', 'venue', 'v1', 'shows'])));
    assert.ok(await storage.get(serializeQueryKey(['mobile', 'venue', 'v1', 'media'])));
    assert.ok(
      await storage.get(serializeQueryKey(['mobile', 'artist', 'p1', 'detail'])),
    );

    // ────── Last warmup sentinel ──────
    assert.ok(await storage.get(serializeQueryKey(LAST_WARMUP_KEY)));

    detach();
  });
});
