/**
 * Offline-cache warm-up.
 *
 * Walks the personal-logbook tRPC procedures the mobile app reads and writes
 * each result into the React Query cache via `setQueryData`. The persister
 * attached by `CacheBridge` then writes them to SQLite for free — anything
 * that lands in `query_cache` is available on next cold start, including
 * offline.
 *
 * Scope (per the offline-mode plan):
 *   Phase 1 — roots (serial):
 *     shows.list, shows.listForMap, venues.list, venues.followed,
 *     performers.list, performers.followed, preferences.get,
 *     spotify.connectionStatus,
 *     discover.followedFeed, discover.followedArtistsFeed,
 *     discover.nearbyFeed (added 2026-05-19 so the daily-digest
 *     deep-link into /discover renders meaningfully on a cold
 *     offline start instead of dropping straight to
 *     OfflineEmptyState), discover.mapFeed (the map's
 *     "Discoverable" layer).
 *   Phase 2 — per-show fan-out (concurrency-capped):
 *     shows.detail, media.listForShow, setlistIntel.predictedSetlist for
 *     every show; songBadges + trackPreviewsForShow only for past shows.
 *   Phase 3 — per-venue + per-performer fan-out:
 *     venues.detail, upcomingAnnouncements, userShows, media.listForVenue
 *     for every venue id in show payloads / lists / followed.
 *     performers.detail, userShows, media.listForPerformer for every
 *     performer id in show lineups / lists / followed.
 *
 * Every step is best-effort: a single failure lands in `result.failures[]`
 * and `onProgress.failed++`, the loop never throws. `replayOutboxOnce` runs
 * before phase 1 so a queued follow doesn't get clobbered by a fresh
 * `venues.followed` payload.
 *
 * Last-synced timestamp is stored in `query_cache` under
 * `['mobile', 'meta', 'lastWarmupAt']` so we don't need a v3 schema.
 */

import type { QueryClient, QueryKey } from '@tanstack/react-query';

import { getCacheOutbox } from './db';
import { replayOutboxOnce, type OutboxDispatch } from '../network';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// The tRPC vanilla client is richly typed against `AppRouter`. Re-stating
// every shape here would either import server-only types (`@showbook/api`
// pulls in Node deps) or drift out of sync. Instead we describe a permissive
// surface and use lightweight runtime guards (`Array.isArray`, optional
// chaining) inside the body to extract the few fields the fan-out planner
// needs.
//
// The `query` parameter is typed `any` — not `unknown` — so a real tRPC
// procedure with a specific input contract (e.g. `(input: { showId: string })
// => Promise<ShowDetail>`) is structurally assignable to this surface.
// `unknown` would force contravariance and break the cast. This is the
// canonical boundary case where `any` is appropriate.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInputQuery = { query: (input?: any) => Promise<unknown> };

export interface WarmupClientSurface {
  shows: {
    list: AnyInputQuery;
    listForMap: AnyInputQuery;
    detail: AnyInputQuery;
    songBadges: AnyInputQuery;
  };
  venues: {
    list: AnyInputQuery;
    followed: AnyInputQuery;
    detail: AnyInputQuery;
    upcomingAnnouncements: AnyInputQuery;
    userShows: AnyInputQuery;
  };
  performers: {
    list: AnyInputQuery;
    followed: AnyInputQuery;
    detail: AnyInputQuery;
    userShows: AnyInputQuery;
  };
  media: {
    listForShow: AnyInputQuery;
    listForVenue: AnyInputQuery;
    listForPerformer: AnyInputQuery;
  };
  preferences: { get: AnyInputQuery };
  setlistIntel: {
    predictedSetlist: AnyInputQuery;
    predictedFestivalSetlists: AnyInputQuery;
    trackPreviewsForShow: AnyInputQuery;
  };
  spotify: {
    connectionStatus: AnyInputQuery;
  };
  discover: {
    followedFeed: AnyInputQuery;
    followedArtistsFeed: AnyInputQuery;
    nearbyFeed: AnyInputQuery;
    mapFeed: AnyInputQuery;
    watchedAnnouncementIds: AnyInputQuery;
  };
}

// Minimal row shape the planner reads. The real payload has many more
// fields; we only need the id + state + nested ids to drive the fan-out.
interface ShowsListRow {
  id: string;
  state?: string;
  kind?: string;
  venue?: { id?: string | null } | null;
  showPerformers?: ReadonlyArray<{ performer?: { id?: string | null } | null }> | null;
}

interface IdRow {
  id: string;
}

function asShowsList(value: unknown): readonly ShowsListRow[] {
  if (!Array.isArray(value)) return [];
  return value as readonly ShowsListRow[];
}

function asIdRows(value: unknown): readonly IdRow[] {
  if (!Array.isArray(value)) return [];
  return value as readonly IdRow[];
}

export interface WarmupProgress {
  total: number;
  completed: number;
  failed: number;
  currentLabel: string | null;
}

export interface WarmupFailure {
  label: string;
  message: string;
}

export interface WarmupResult {
  startedAt: number;
  finishedAt: number;
  total: number;
  succeeded: number;
  failed: number;
  failures: WarmupFailure[];
}

export interface WarmupOptions {
  client: WarmupClientSurface;
  queryClient: QueryClient;
  onProgress?: (p: WarmupProgress) => void;
  /** Max in-flight per fan-out batch. Default 4. */
  concurrency?: number;
  /** Test injection: tRPC dispatcher used by the pre-flight outbox drain. */
  dispatch?: OutboxDispatch;
  /** Test injection: skip the outbox drain. Default false. */
  skipReplay?: boolean;
  /** Test injection: monotonic clock. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Meta key (last sync)
// ---------------------------------------------------------------------------

export const LAST_WARMUP_KEY: QueryKey = ['mobile', 'meta', 'lastWarmupAt'];

interface LastWarmupRecord {
  at: number;
}

export function readLastWarmup(qc: QueryClient): number | null {
  const v = qc.getQueryData<LastWarmupRecord>(LAST_WARMUP_KEY);
  return v?.at ?? null;
}

export function writeLastWarmup(qc: QueryClient, at: number): void {
  qc.setQueryData<LastWarmupRecord>(LAST_WARMUP_KEY, { at });
}

// ---------------------------------------------------------------------------
// Key shapes
// ---------------------------------------------------------------------------
//
// Mobile screens read queries through two paths:
//
//   1. `useCachedQuery` with a hand-rolled `['mobile', ...]` key
//      (Home / Shows / Venues / Artists list + detail screens).
//   2. `trpc.<router>.<proc>.useQuery(input)` whose underlying key is the
//      tRPC-native shape `[[router, proc], { input, type: 'query' }]`
//      (Show detail tabs, Spotify cards, preferences.get on the Me tab).
//
// `setQueryData` is keyed exactly so the read side picks up our write.
// We write into BOTH shapes when both readers exist (today: `shows.list`
// is read at `['mobile', 'shows.list']` AND `['mobile', 'home', 'shows.list']`).

function trpcKey(path: readonly string[], input: unknown): QueryKey {
  // Matches the @trpc/react-query key shape: `[ [router, ...proc], { input, type } ]`.
  // For input-less procedures, callers pass `undefined`.
  return [[...path], { input, type: 'query' }] as QueryKey;
}

// ---------------------------------------------------------------------------
// Discover-feed seed guard
// ---------------------------------------------------------------------------
//
// The Discover screen and this warm-up both write the same three feed cache
// keys, but at different page sizes: the screen fetches the FULL set
// (`limit: 100` / default `perRegionLimit`) on focus, while warm-up fetches a
// deliberately tiny snapshot (`limit: 12` / `perRegionLimit: 8`) so a cold
// offline open renders *something* without bloating the persisted cache.
//
// Writing the snapshot unconditionally *raced* the screen's own fetch: when
// warm-up's request resolved AFTER the screen's full refetch (warm-up reaches
// the nearbyFeed step only after ~10 serial phase-1 calls, so this was the
// common case on a quick tab tap), the small snapshot clobbered the full feed
// back to "1 upcoming" — and nothing re-triggered a fetch, so the user was
// stuck until a manual pull-to-refresh. That's the regression #496's
// `refetchOnMount: 'always'` couldn't fix, because the clobber happens after
// the mount refetch already won.
//
// The guard: seed only when the snapshot wouldn't SHRINK what's already
// cached. A first seed (empty cache) and a legitimate refresh (snapshot
// equal-or-larger) both write; a smaller snapshot landing on top of the
// screen's full feed is dropped. Warm-up keeps its offline-seeding job
// without ever downgrading the live screen.

function feedItemCount(value: unknown): number {
  if (value && typeof value === 'object' && 'items' in value) {
    const items = (value as { items?: unknown }).items;
    return Array.isArray(items) ? items.length : 0;
  }
  return 0;
}

function seedDiscoverFeed(
  qc: QueryClient,
  key: QueryKey,
  data: unknown,
): void {
  if (feedItemCount(data) >= feedItemCount(qc.getQueryData(key))) {
    qc.setQueryData(key, data);
  }
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function runWithConcurrency<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  limit: number,
): Promise<void> {
  if (tasks.length === 0) return;
  const effective = Math.max(1, Math.min(limit, tasks.length));
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < effective; i++) {
    workers.push(
      (async () => {
        while (cursor < tasks.length) {
          const my = cursor++;
          const task = tasks[my];
          if (task) await task();
        }
      })(),
    );
  }
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function warmCacheForOfflineUse(
  opts: WarmupOptions,
): Promise<WarmupResult> {
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const failures: WarmupFailure[] = [];
  let completed = 0;
  let failed = 0;
  const concurrency = opts.concurrency ?? 4;

  // ──────────────── Pre-flight: drain pending writes first ────────────────
  //
  // Without this, a queued `venues.follow` (optimistic, awaiting the network)
  // gets clobbered by phase 1's `venues.followed` payload — the user sees the
  // venue revert from "following" to "not following" until the next refresh.
  if (!opts.skipReplay) {
    try {
      const outbox = getCacheOutbox();
      const dispatch = opts.dispatch;
      if (dispatch) {
        await replayOutboxOnce({ outbox, dispatch });
      }
      // When no dispatcher is provided we skip replay rather than fabricating
      // a no-op dispatch — the real call path always provides one via the
      // OfflineBridge in `_layout.tsx`. Tests that exercise the replay path
      // pass a dispatch stub; the production "fire and forget" warm-up runs
      // after the OfflineBridge has already mounted, so its reconnect-replay
      // covers the same ground.
    } catch {
      // Outbox failures must not block warm-up.
    }
  }

  // Build the task list so `total` is accurate from the first onProgress.
  // Phase 1 + phase 2/3 fan-outs are interleaved as data arrives.
  const emit = (label: string | null): void => {
    opts.onProgress?.({
      total: completed + failed + (label ? 1 : 0),
      completed,
      failed,
      currentLabel: label,
    });
  };

  async function step<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    emit(label);
    try {
      const value = await fn();
      completed += 1;
      opts.onProgress?.({
        total: completed + failed,
        completed,
        failed,
        currentLabel: null,
      });
      return value;
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ label, message });
      opts.onProgress?.({
        total: completed + failed,
        completed,
        failed,
        currentLabel: null,
      });
      return null;
    }
  }

  const c = opts.client;
  const qc = opts.queryClient;

  // ──────────────── Phase 1: roots (serial) ────────────────

  const showsList = await step('shows.list', async () => {
    // `shows.list` accepts an optional filter object — pass an empty one
    // so the Zod input validator (`z.object({...}).optional()` fields)
    // accepts the call. Calling `.query()` with no argument sends the
    // bare `null` superjson envelope, which the server rejects as
    // `expected: object, code: invalid_type` and floods Axiom with
    // `trpc.error` log lines.
    const data = await c.shows.list.query({});
    // `shows.list` is read under two keys today (Home + Shows tab). Write
    // both from the single network call. If the two screens consolidate
    // later, dropping the second `setQueryData` here is a one-line change.
    qc.setQueryData(['mobile', 'shows.list'], data);
    qc.setQueryData(['mobile', 'home', 'shows.list'], data);
    return data;
  });

  await step('shows.listForMap', async () => {
    const data = await c.shows.listForMap.query();
    qc.setQueryData(['mobile', 'shows.listForMap'], data);
    return data;
  });

  // The map's "Discoverable" layer reads this — same key the screen's
  // useCachedQuery uses — so a cold offline open can plot announcements.
  await step('discover.mapFeed', async () => {
    const data = await c.discover.mapFeed.query();
    qc.setQueryData(['mobile', 'discover.mapFeed'], data);
    return data;
  });

  const venuesList = await step('venues.list', async () => {
    const data = await c.venues.list.query();
    qc.setQueryData(['mobile', 'venues', 'list'], data);
    return data;
  });

  const venuesFollowed = await step('venues.followed', async () => {
    const data = await c.venues.followed.query();
    qc.setQueryData(['mobile', 'venues', 'followed'], data);
    return data;
  });

  const performersList = await step('performers.list', async () => {
    const data = await c.performers.list.query();
    qc.setQueryData(['mobile', 'artists', 'list'], data);
    return data;
  });

  const performersFollowed = await step('performers.followed', async () => {
    const data = await c.performers.followed.query();
    qc.setQueryData(['mobile', 'artists', 'followed'], data);
    return data;
  });

  await step('preferences.get', async () => {
    const data = await c.preferences.get.query();
    qc.setQueryData(trpcKey(['preferences', 'get'], undefined), data);
    return data;
  });

  await step('spotify.connectionStatus', async () => {
    const data = await c.spotify.connectionStatus.query();
    qc.setQueryData(trpcKey(['spotify', 'connectionStatus'], undefined), data);
    return data;
  });

  // Discover feeds — a deliberately small snapshot so a cold offline open
  // (e.g. the daily-digest deep-link into /discover) renders *something*
  // without bloating warm-up. These write the same query keys the Discover
  // screen reads, but with far smaller page sizes than the screen's own
  // fetch (`followedFeed`/`followedArtistsFeed` `limit: 12` vs the screen's
  // `100`; `nearbyFeed` `perRegionLimit: 8` vs the screen's default `2500`).
  // The screen treats this as a placeholder and refetches the full set on
  // focus — so the user sees the cached rows instantly and the bulk fills in
  // automatically online, rather than being pinned to "8 venues" until a
  // manual refresh. `seedDiscoverFeed` keeps this snapshot from clobbering
  // the screen's full feed when warm-up's request loses the race and resolves
  // after it (see the guard's docblock above).
  await step('discover.followedFeed', async () => {
    const data = await c.discover.followedFeed.query({ limit: 12 });
    seedDiscoverFeed(qc, ['mobile', 'discover', 'followedFeed'], data);
    return data;
  });

  await step('discover.followedArtistsFeed', async () => {
    const data = await c.discover.followedArtistsFeed.query({ limit: 12 });
    seedDiscoverFeed(qc, ['mobile', 'discover', 'followedArtistsFeed'], data);
    return data;
  });

  await step('discover.nearbyFeed', async () => {
    const data = await c.discover.nearbyFeed.query({ perRegionLimit: 8 });
    seedDiscoverFeed(qc, ['mobile', 'discover', 'nearbyFeed'], data);
    return data;
  });

  // Seed the watched-event set so the per-row watch icon renders the
  // right state on a cold offline open — without it the icon flickers
  // from "Follow" to "Watching" once the query refetches online.
  await step('discover.watchedAnnouncementIds', async () => {
    const data = await c.discover.watchedAnnouncementIds.query();
    qc.setQueryData(['mobile', 'discover', 'watchedAnnouncementIds'], data);
    return data;
  });

  // ──────────────── Phase 2: per-show fan-out ────────────────

  const shows = asShowsList(showsList);
  const showTasks: Array<() => Promise<unknown>> = [];
  for (const show of shows) {
    const showId = show.id;
    if (!showId) continue;
    showTasks.push(() =>
      step(`shows.detail:${showId}`, async () => {
        const data = await c.shows.detail.query({ showId });
        qc.setQueryData(trpcKey(['shows', 'detail'], { showId }), data);
        return data;
      }),
    );
    showTasks.push(() =>
      step(`media.listForShow:${showId}`, async () => {
        const data = await c.media.listForShow.query({ showId });
        qc.setQueryData(trpcKey(['media', 'listForShow'], { showId }), data);
        return data;
      }),
    );
    if (show.kind === 'festival') {
      showTasks.push(() =>
        step(`setlistIntel.predictedFestivalSetlists:${showId}`, async () => {
          const data = await c.setlistIntel.predictedFestivalSetlists.query({
            showId,
          });
          qc.setQueryData(
            trpcKey(['setlistIntel', 'predictedFestivalSetlists'], { showId }),
            data,
          );
          return data;
        }),
      );
    } else {
      showTasks.push(() =>
        step(`setlistIntel.predictedSetlist:${showId}`, async () => {
          const data = await c.setlistIntel.predictedSetlist.query({ showId });
          qc.setQueryData(trpcKey(['setlistIntel', 'predictedSetlist'], { showId }), data);
          return data;
        }),
      );
    }
    if (show.state === 'past') {
      showTasks.push(() =>
        step(`shows.songBadges:${showId}`, async () => {
          const data = await c.shows.songBadges.query({ showId });
          qc.setQueryData(trpcKey(['shows', 'songBadges'], { showId }), data);
          return data;
        }),
      );
      showTasks.push(() =>
        step(`setlistIntel.trackPreviewsForShow:${showId}`, async () => {
          const data = await c.setlistIntel.trackPreviewsForShow.query({ showId });
          qc.setQueryData(trpcKey(['setlistIntel', 'trackPreviewsForShow'], { showId }), data);
          return data;
        }),
      );
    }
  }
  await runWithConcurrency(showTasks, concurrency);

  // ──────────────── Phase 3: per-venue + per-performer fan-out ────────────────

  const venueIds = new Set<string>();
  for (const s of shows) if (s.venue?.id) venueIds.add(s.venue.id);
  for (const v of asIdRows(venuesList)) if (v.id) venueIds.add(v.id);
  for (const v of asIdRows(venuesFollowed)) if (v.id) venueIds.add(v.id);

  const performerIds = new Set<string>();
  for (const s of shows) {
    if (Array.isArray(s.showPerformers)) {
      for (const sp of s.showPerformers) {
        const id = sp?.performer?.id;
        if (id) performerIds.add(id);
      }
    }
  }
  for (const p of asIdRows(performersList)) if (p.id) performerIds.add(p.id);
  for (const p of asIdRows(performersFollowed)) if (p.id) performerIds.add(p.id);

  const venueTasks: Array<() => Promise<unknown>> = [];
  for (const venueId of venueIds) {
    venueTasks.push(() =>
      step(`venues.detail:${venueId}`, async () => {
        const data = await c.venues.detail.query({ venueId });
        qc.setQueryData(['mobile', 'venue', venueId, 'detail'], data);
        return data;
      }),
    );
    venueTasks.push(() =>
      step(`venues.upcomingAnnouncements:${venueId}`, async () => {
        const data = await c.venues.upcomingAnnouncements.query({ venueId, limit: 25 });
        qc.setQueryData(['mobile', 'venue', venueId, 'upcoming'], data);
        return data;
      }),
    );
    venueTasks.push(() =>
      step(`venues.userShows:${venueId}`, async () => {
        const data = await c.venues.userShows.query({ venueId });
        qc.setQueryData(['mobile', 'venue', venueId, 'shows'], data);
        return data;
      }),
    );
    venueTasks.push(() =>
      step(`media.listForVenue:${venueId}`, async () => {
        const data = await c.media.listForVenue.query({ venueId });
        qc.setQueryData(['mobile', 'venue', venueId, 'media'], data);
        return data;
      }),
    );
  }

  const performerTasks: Array<() => Promise<unknown>> = [];
  for (const performerId of performerIds) {
    performerTasks.push(() =>
      step(`performers.detail:${performerId}`, async () => {
        const data = await c.performers.detail.query({ performerId });
        qc.setQueryData(['mobile', 'artist', performerId, 'detail'], data);
        return data;
      }),
    );
    performerTasks.push(() =>
      step(`performers.userShows:${performerId}`, async () => {
        const data = await c.performers.userShows.query({ performerId });
        qc.setQueryData(['mobile', 'artist', performerId, 'shows'], data);
        return data;
      }),
    );
    performerTasks.push(() =>
      step(`media.listForPerformer:${performerId}`, async () => {
        const data = await c.media.listForPerformer.query({ performerId });
        qc.setQueryData(['mobile', 'artist', performerId, 'media'], data);
        return data;
      }),
    );
  }

  await Promise.all([
    runWithConcurrency(venueTasks, concurrency),
    runWithConcurrency(performerTasks, concurrency),
  ]);

  // ──────────────── Finalise ────────────────

  const finishedAt = now();
  writeLastWarmup(qc, finishedAt);

  return {
    startedAt,
    finishedAt,
    total: completed + failed,
    succeeded: completed,
    failed,
    failures,
  };
}
