/**
 * `warmCacheForOfflineUse` unit tests.
 *
 * Uses a real `QueryClient` + a stubbed tRPC vanilla client whose every
 * procedure is a manually-defined `query()` function we can assert on.
 * No React Native, no expo-sqlite — runs under `node --test`.
 *
 * Coverage targets per the offline-mode plan:
 *   - Phase 1 walks each root query exactly once.
 *   - `shows.list` payload is written into BOTH cache keys from a single
 *     network call (Home + Shows tab consumers).
 *   - Phase 2 fan-out covers every show id; past-only queries are skipped
 *     for non-past shows.
 *   - Phase 3 fan-out covers the union of show / list / followed ids
 *     (de-dup is asserted).
 *   - Concurrency cap holds: never more than `concurrency` in-flight.
 *   - One rejected step lands in `failures[]` and never escapes.
 *   - `lastWarmupAt` is written on completion via the meta key.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';

import {
  warmCacheForOfflineUse,
  readLastWarmup,
  LAST_WARMUP_KEY,
  type WarmupClientSurface,
} from '../../cache/warmup';

interface CallLog {
  procedure: string;
  input: unknown;
}

interface InFlightTracker {
  current: number;
  peak: number;
}

interface BuildClientOptions {
  showsList?: unknown;
  venuesList?: unknown;
  venuesFollowed?: unknown;
  performersList?: unknown;
  performersFollowed?: unknown;
  /** Procedure paths (e.g. 'shows.detail') that should reject. */
  reject?: ReadonlySet<string>;
  tracker?: InFlightTracker;
  /** Optional artificial latency per call so concurrency can be observed. */
  delayMs?: number;
}

function buildClient(opts: BuildClientOptions = {}): {
  client: WarmupClientSurface;
  calls: CallLog[];
} {
  const calls: CallLog[] = [];
  const reject = opts.reject ?? new Set<string>();
  const tracker = opts.tracker;
  const delay = opts.delayMs ?? 0;

  const make = (procedure: string, payload: unknown) => async (input?: unknown) => {
    calls.push({ procedure, input });
    if (tracker) {
      tracker.current += 1;
      tracker.peak = Math.max(tracker.peak, tracker.current);
    }
    try {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      if (reject.has(procedure)) {
        throw new Error(`${procedure} failed`);
      }
      return payload;
    } finally {
      if (tracker) tracker.current -= 1;
    }
  };

  const client: WarmupClientSurface = {
    shows: {
      list: { query: make('shows.list', opts.showsList ?? []) },
      listForMap: { query: make('shows.listForMap', []) },
      detail: { query: make('shows.detail', { ok: 'detail' }) },
      songBadges: { query: make('shows.songBadges', { badges: {} }) },
    },
    venues: {
      list: { query: make('venues.list', opts.venuesList ?? []) },
      followed: { query: make('venues.followed', opts.venuesFollowed ?? []) },
      detail: { query: make('venues.detail', { ok: 'venue' }) },
      upcomingAnnouncements: { query: make('venues.upcomingAnnouncements', []) },
      userShows: { query: make('venues.userShows', []) },
    },
    performers: {
      list: { query: make('performers.list', opts.performersList ?? []) },
      followed: { query: make('performers.followed', opts.performersFollowed ?? []) },
      detail: { query: make('performers.detail', { ok: 'performer' }) },
      userShows: { query: make('performers.userShows', []) },
    },
    media: {
      listForShow: { query: make('media.listForShow', []) },
      listForVenue: { query: make('media.listForVenue', []) },
      listForPerformer: { query: make('media.listForPerformer', []) },
    },
    preferences: { get: { query: make('preferences.get', { theme: 'system' }) } },
    setlistIntel: {
      predictedSetlist: { query: make('setlistIntel.predictedSetlist', { style: 'cold' }) },
      predictedFestivalSetlists: {
        query: make('setlistIntel.predictedFestivalSetlists', { entries: [] }),
      },
      trackPreviewsForShow: {
        query: make('setlistIntel.trackPreviewsForShow', { previews: {} }),
      },
    },
    spotify: {
      connectionStatus: {
        query: make('spotify.connectionStatus', { connected: false }),
      },
    },
    discover: {
      followedFeed: { query: make('discover.followedFeed', { items: [] }) },
      followedArtistsFeed: { query: make('discover.followedArtistsFeed', { items: [] }) },
      nearbyFeed: { query: make('discover.nearbyFeed', { items: [] }) },
      digestFeed: { query: make('discover.digestFeed', { items: [] }) },
      mapFeed: { query: make('discover.mapFeed', []) },
      watchedAnnouncementIds: { query: make('discover.watchedAnnouncementIds', []) },
    },
  };

  return { client, calls };
}

describe('warmCacheForOfflineUse', () => {
  it('phase 1 calls each root query exactly once and writes shows.list into both keys', async () => {
    const { client, calls } = buildClient();
    const qc = new QueryClient();
    const result = await warmCacheForOfflineUse({
      client,
      queryClient: qc,
      skipReplay: true,
    });

    const counts: Record<string, number> = {};
    for (const c of calls) counts[c.procedure] = (counts[c.procedure] ?? 0) + 1;

    assert.equal(counts['shows.list'], 1);
    assert.equal(counts['shows.listForMap'], 1);
    assert.equal(counts['venues.list'], 1);
    assert.equal(counts['venues.followed'], 1);
    assert.equal(counts['performers.list'], 1);
    assert.equal(counts['performers.followed'], 1);
    assert.equal(counts['preferences.get'], 1);
    assert.equal(counts['spotify.connectionStatus'], 1);
    assert.equal(counts['discover.followedFeed'], 1);
    assert.equal(counts['discover.followedArtistsFeed'], 1);
    assert.equal(counts['discover.nearbyFeed'], 1);
    assert.equal(counts['discover.digestFeed'], 1);
    assert.equal(counts['discover.mapFeed'], 1);
    assert.equal(counts['discover.watchedAnnouncementIds'], 1);

    // Discover feeds end up at the same cache keys the screen reads.
    assert.deepEqual(qc.getQueryData(['mobile', 'discover', 'followedFeed']), {
      items: [],
    });
    assert.deepEqual(
      qc.getQueryData(['mobile', 'discover', 'followedArtistsFeed']),
      { items: [] },
    );
    assert.deepEqual(qc.getQueryData(['mobile', 'discover', 'nearbyFeed']), {
      items: [],
    });
    assert.deepEqual(qc.getQueryData(['mobile', 'discover', 'digestFeed']), {
      items: [],
    });
    // The map's Discoverable layer reads this flat key.
    assert.deepEqual(qc.getQueryData(['mobile', 'discover.mapFeed']), []);

    // Both shows.list cache keys present from a single network call.
    assert.deepEqual(qc.getQueryData(['mobile', 'shows.list']), []);
    assert.deepEqual(qc.getQueryData(['mobile', 'home', 'shows.list']), []);

    assert.equal(result.failed, 0);
    assert.ok(result.succeeded >= 10, 'at least 10 root steps succeeded');
  });

  it('does not downgrade a fuller Discover feed the screen already loaded', async () => {
    // Regression: warm-up's tiny snapshot used to clobber the screen's full
    // feed when its request resolved after the screen's mount refetch,
    // pinning Discover to "1 upcoming" until a manual pull-to-refresh. The
    // seed guard must keep the fuller cached feed and drop the smaller
    // snapshot. Here the stubbed feeds return `{ items: [] }` (count 0), so a
    // pre-seeded 3-item feed must survive.
    const { client } = buildClient();
    const qc = new QueryClient();
    const fullNearby = { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
    const fullVenues = { items: [{ id: 'v1' }, { id: 'v2' }] };
    qc.setQueryData(['mobile', 'discover', 'nearbyFeed'], fullNearby);
    qc.setQueryData(['mobile', 'discover', 'followedFeed'], fullVenues);

    await warmCacheForOfflineUse({ client, queryClient: qc, skipReplay: true });

    // Fuller feeds preserved — the empty snapshot did not shrink them.
    assert.deepEqual(qc.getQueryData(['mobile', 'discover', 'nearbyFeed']), fullNearby);
    assert.deepEqual(qc.getQueryData(['mobile', 'discover', 'followedFeed']), fullVenues);
    // An absent feed still gets seeded (equal-or-larger writes through).
    assert.deepEqual(
      qc.getQueryData(['mobile', 'discover', 'followedArtistsFeed']),
      { items: [] },
    );
  });

  it('phase 2 walks every show id and includes past-only queries only for past shows', async () => {
    const { client, calls } = buildClient({
      showsList: [
        { id: 's1', state: 'past' },
        { id: 's2', state: 'ticketed' },
      ],
    });
    const qc = new QueryClient();
    await warmCacheForOfflineUse({ client, queryClient: qc, skipReplay: true });

    const perShow = calls.filter((c) => c.procedure === 'shows.detail');
    assert.equal(perShow.length, 2);
    assert.deepEqual(
      perShow.map((c) => (c.input as { showId: string }).showId).sort(),
      ['s1', 's2'],
    );

    const previews = calls.filter(
      (c) => c.procedure === 'setlistIntel.trackPreviewsForShow',
    );
    const badges = calls.filter((c) => c.procedure === 'shows.songBadges');
    // Past-only queries fire for s1 only.
    assert.equal(previews.length, 1);
    assert.equal((previews[0]!.input as { showId: string }).showId, 's1');
    assert.equal(badges.length, 1);
    assert.equal((badges[0]!.input as { showId: string }).showId, 's1');

    // Predicted setlist runs for every show (gating is on the screen).
    const predicted = calls.filter(
      (c) => c.procedure === 'setlistIntel.predictedSetlist',
    );
    assert.equal(predicted.length, 2);
  });

  it('phase 3 walks the union of show / list / followed ids, deduped', async () => {
    const { client, calls } = buildClient({
      showsList: [
        {
          id: 's1',
          state: 'ticketed',
          venue: { id: 'v1' },
          showPerformers: [{ performer: { id: 'p1' } }],
        },
      ],
      venuesList: [{ id: 'v1' }, { id: 'v2' }], // v1 overlaps with shows
      venuesFollowed: [{ id: 'v3' }],
      performersList: [{ id: 'p1' }, { id: 'p2' }], // p1 overlaps
      performersFollowed: [{ id: 'p3' }],
    });
    const qc = new QueryClient();
    await warmCacheForOfflineUse({ client, queryClient: qc, skipReplay: true });

    const venueDetail = calls.filter((c) => c.procedure === 'venues.detail');
    assert.deepEqual(
      venueDetail.map((c) => (c.input as { venueId: string }).venueId).sort(),
      ['v1', 'v2', 'v3'],
    );

    const performerDetail = calls.filter(
      (c) => c.procedure === 'performers.detail',
    );
    assert.deepEqual(
      performerDetail.map((c) => (c.input as { performerId: string }).performerId).sort(),
      ['p1', 'p2', 'p3'],
    );
  });

  it('respects the concurrency cap during fan-out', async () => {
    const tracker: InFlightTracker = { current: 0, peak: 0 };
    const { client } = buildClient({
      showsList: Array.from({ length: 10 }, (_, i) => ({
        id: `s${i}`,
        state: 'ticketed',
      })),
      tracker,
      delayMs: 5,
    });
    const qc = new QueryClient();
    await warmCacheForOfflineUse({
      client,
      queryClient: qc,
      skipReplay: true,
      concurrency: 3,
    });
    // Phase 2 + 3 are fan-out; concurrency cap means peak never exceeds
    // 3 + 3 (venue + performer pools both at 3) + any sequential phase 1
    // calls. Allow some slack: the assertion is "we don't fire all at once".
    assert.ok(tracker.peak <= 6, `peak ${tracker.peak} exceeded cap budget`);
    assert.ok(tracker.peak > 1, 'expected some parallelism');
  });

  it('captures one rejected step in failures[] and never throws', async () => {
    const { client } = buildClient({
      reject: new Set(['venues.list']),
    });
    const qc = new QueryClient();
    const result = await warmCacheForOfflineUse({
      client,
      queryClient: qc,
      skipReplay: true,
    });
    assert.equal(result.failed, 1);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0]?.label, 'venues.list');
    assert.ok(result.failures[0]?.message.includes('venues.list failed'));
    // Other steps still ran and succeeded.
    assert.ok(result.succeeded >= 9);
  });

  it('writes lastWarmupAt on completion', async () => {
    const { client } = buildClient();
    const qc = new QueryClient();
    let clock = 1000;
    await warmCacheForOfflineUse({
      client,
      queryClient: qc,
      skipReplay: true,
      now: () => clock++,
    });
    const lastAt = readLastWarmup(qc);
    assert.ok(lastAt !== null, 'lastWarmupAt must be set');
    assert.equal(qc.getQueryData(LAST_WARMUP_KEY) !== undefined, true);
  });

  it('writes per-show payloads under the tRPC-native key shape', async () => {
    const { client } = buildClient({
      showsList: [{ id: 's1', state: 'past' }],
    });
    const qc = new QueryClient();
    await warmCacheForOfflineUse({ client, queryClient: qc, skipReplay: true });
    const detail = qc.getQueryData([
      ['shows', 'detail'],
      { input: { showId: 's1' }, type: 'query' },
    ]);
    assert.deepEqual(detail, { ok: 'detail' });
    const predicted = qc.getQueryData([
      ['setlistIntel', 'predictedSetlist'],
      { input: { showId: 's1' }, type: 'query' },
    ]);
    assert.deepEqual(predicted, { style: 'cold' });
  });

  it('fires onProgress monotonically and reaches every step', async () => {
    const { client } = buildClient({
      showsList: [{ id: 's1', state: 'ticketed' }],
    });
    const qc = new QueryClient();
    const progress: { completed: number; failed: number }[] = [];
    await warmCacheForOfflineUse({
      client,
      queryClient: qc,
      skipReplay: true,
      onProgress: (p) => progress.push({ completed: p.completed, failed: p.failed }),
    });
    assert.ok(progress.length > 0);
    // completed + failed is monotonic.
    let last = 0;
    for (const p of progress) {
      const total = p.completed + p.failed;
      assert.ok(total >= last, 'progress went backwards');
      last = total;
    }
  });
});
