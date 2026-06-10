/**
 * Lightweight pg-boss client for enqueuing jobs from tRPC mutations.
 *
 * This is a "send-only" instance, separate from the worker pool managed in
 * @showbook/jobs. They share the same Postgres queue tables, so jobs sent
 * from the API are picked up by handlers registered by the worker.
 */

import { PgBoss } from 'pg-boss';
import { db, sql } from '@showbook/db';
import { child } from '@showbook/observability';

const log = child({ component: 'api.job-queue' });

// Cache pg-boss on globalThis so Next.js HMR doesn't leak connection pools.
// pg-boss opens its own pool of ~5 connections per instance; without
// caching, a few module reloads exhaust Postgres's default 100-conn limit.
const globalForBoss = globalThis as unknown as {
  __showbookBoss?: PgBoss;
  __showbookBossStarting?: Promise<PgBoss>;
};

async function getSender(): Promise<PgBoss> {
  if (globalForBoss.__showbookBoss) return globalForBoss.__showbookBoss;
  if (globalForBoss.__showbookBossStarting) return globalForBoss.__showbookBossStarting;
  globalForBoss.__showbookBossStarting = (async () => {
    const instance = new PgBoss({
      connectionString: process.env.DATABASE_URL!,
      max: 2, // send-only client; we don't need a big pool
      // Critical: disable the timekeeper and the maintenance supervisor.
      // Both are global-by-design — pg-boss's timekeeper races every
      // boss instance's cron monitor against `pgboss.version.cron_on`,
      // and on `instance.start()` it also runs `setImmediate(() =>
      // onCron())`, which means the first tRPC enqueue after boot can
      // fire an out-of-band cron check before the primary boss's
      // monitor has caught up. That second cron path produced
      // duplicate SEND_IT inserts and a phantom `health/morning-check`
      // invocation on 2026-05-08 11:00:14 UTC (logged jobId not in
      // pgboss.job nor archive — the row was archived before the
      // primary boss ever saw it). The primary boss in
      // `@showbook/jobs` owns scheduling + supervision; this client
      // only needs `boss.send` / `boss.insert`, so opt out of both.
      schedule: false,
      supervise: false,
    });
    await instance.start();
    globalForBoss.__showbookBoss = instance;
    return instance;
  })();
  return globalForBoss.__showbookBossStarting;
}

export const JOB_NAMES = {
  INGEST_VENUE: 'discover/ingest-venue',
  INGEST_PERFORMER: 'discover/ingest-performer',
  INGEST_REGION: 'discover/ingest-region',
  PRUNE_ORPHAN_CATALOG: 'prune/orphan-catalog',
  SETLIST_RETRY: 'enrichment/setlist-retry',
  SETLIST_CORPUS_FILL: 'enrichment/setlist-corpus-fill',
  SETLIST_CORPUS_FILL_REFRESH: 'enrichment/setlist-corpus-fill-refresh',
  BACKFILL_PERFORMER_MBIDS: 'backfill/performer-mbids',
  BACKFILL_PERFORMER_TICKETMASTER_IDS: 'backfill/performer-ticketmaster-ids',
  BACKFILL_PERFORMER_SPOTIFY_IDS: 'backfill/performer-spotify-ids',
  BACKFILL_PERFORMER_WIKIDATA_IDS: 'backfill/performer-wikidata-ids',
  BACKFILL_SHOW_TICKET_URLS: 'backfill/show-ticket-urls',
} as const;

export type CorpusFillMode = 'predict' | 'deep' | 'refresh';

export async function enqueueIngestVenue(venueId: string): Promise<void> {
  try {
    const boss = await getSender();
    await boss.send(JOB_NAMES.INGEST_VENUE, { venueId });
  } catch (err) {
    // Don't fail the user-facing follow mutation if the queue is unavailable
    // — the weekly cron will catch up. Log loudly so we notice.
    log.error({ err, event: 'job_queue.enqueue.failed', queue: JOB_NAMES.INGEST_VENUE, venueId }, 'enqueueIngestVenue failed');
  }
}

export async function enqueueIngestPerformer(performerId: string): Promise<void> {
  try {
    const boss = await getSender();
    await boss.send(JOB_NAMES.INGEST_PERFORMER, { performerId });
  } catch (err) {
    log.error({ err, event: 'job_queue.enqueue.failed', queue: JOB_NAMES.INGEST_PERFORMER, performerId }, 'enqueueIngestPerformer failed');
  }
}

export async function enqueuePruneOrphanCatalog(): Promise<string | null> {
  const boss = await getSender();
  return await boss.send(JOB_NAMES.PRUNE_ORPHAN_CATALOG, {});
}

/**
 * Trigger the setlist-retry handler outside of its 04:00 ET cron — used by
 * the admin "Run setlist enrichment" button to process freshly-queued items
 * (e.g. Gmail imports) without waiting for the next nightly window.
 */
export async function enqueueSetlistRetry(): Promise<string | null> {
  try {
    const boss = await getSender();
    return await boss.send(JOB_NAMES.SETLIST_RETRY, {});
  } catch (err) {
    log.error(
      { err, event: 'job_queue.enqueue.failed', queue: JOB_NAMES.SETLIST_RETRY },
      'enqueueSetlistRetry failed',
    );
    return null;
  }
}

/**
 * Trigger a per-performer setlist corpus fill. The corpus is what powers
 * the predicted-setlist tab; without rows in `tour_setlists` the tab shows
 * the "We're pulling recent setlists" cold state. `mode` controls how many
 * setlist.fm pages we fetch — 'predict' (3 pages) is the default for a
 * manual operator trigger.
 */
export async function enqueueSetlistCorpusFill(
  performerId: string,
  mode: CorpusFillMode = 'predict',
): Promise<string | null> {
  try {
    const boss = await getSender();
    return await boss.send(JOB_NAMES.SETLIST_CORPUS_FILL, {
      performerId,
      mode,
    });
  } catch (err) {
    log.error(
      {
        err,
        event: 'job_queue.enqueue.failed',
        queue: JOB_NAMES.SETLIST_CORPUS_FILL,
        performerId,
        mode,
      },
      'enqueueSetlistCorpusFill failed',
    );
    return null;
  }
}

/**
 * Trigger the performer-MBID backfill outside its 04:30 ET cron — used
 * by the admin "Backfill performer MBIDs" button after a bulk import
 * leaves a pile of performers with `musicbrainz_id IS NULL`.
 */
export async function enqueueBackfillPerformerMbids(): Promise<string | null> {
  try {
    const boss = await getSender();
    return await boss.send(JOB_NAMES.BACKFILL_PERFORMER_MBIDS, {});
  } catch (err) {
    log.error(
      {
        err,
        event: 'job_queue.enqueue.failed',
        queue: JOB_NAMES.BACKFILL_PERFORMER_MBIDS,
      },
      'enqueueBackfillPerformerMbids failed',
    );
    return null;
  }
}

/**
 * Trigger the performer-Ticketmaster-id backfill outside its 06:00 ET
 * cron — used by the admin "Backfill performer Ticketmaster IDs"
 * button. Side-effect: fills MBID when TM exposes one and the row's
 * MBID is null.
 */
export async function enqueueBackfillPerformerTicketmasterIds(): Promise<
  string | null
> {
  try {
    const boss = await getSender();
    return await boss.send(JOB_NAMES.BACKFILL_PERFORMER_TICKETMASTER_IDS, {});
  } catch (err) {
    log.error(
      {
        err,
        event: 'job_queue.enqueue.failed',
        queue: JOB_NAMES.BACKFILL_PERFORMER_TICKETMASTER_IDS,
      },
      'enqueueBackfillPerformerTicketmasterIds failed',
    );
    return null;
  }
}

/**
 * Trigger the performer-Spotify-id backfill outside its 06:30 ET cron —
 * used by the admin "Backfill performer Spotify IDs" button to catch up
 * the pre-existing backlog created before the fire-and-forget hook in
 * `matchOrCreatePerformer` landed.
 */
export async function enqueueBackfillPerformerSpotifyIds(): Promise<
  string | null
> {
  try {
    const boss = await getSender();
    return await boss.send(JOB_NAMES.BACKFILL_PERFORMER_SPOTIFY_IDS, {});
  } catch (err) {
    log.error(
      {
        err,
        event: 'job_queue.enqueue.failed',
        queue: JOB_NAMES.BACKFILL_PERFORMER_SPOTIFY_IDS,
      },
      'enqueueBackfillPerformerSpotifyIds failed',
    );
    return null;
  }
}

/**
 * Trigger the Wikidata-QID backfill outside its 07:15 ET cron — used by
 * the admin "Backfill performer Wikidata IDs" button to catch the backlog
 * of theatre cast / non-TM performers created before the fire-and-forget
 * `resolvePerformerWikidataId` hook in `matchOrCreatePerformer` landed.
 */
export async function enqueueBackfillPerformerWikidataIds(): Promise<
  string | null
> {
  try {
    const boss = await getSender();
    return await boss.send(JOB_NAMES.BACKFILL_PERFORMER_WIKIDATA_IDS, {});
  } catch (err) {
    log.error(
      {
        err,
        event: 'job_queue.enqueue.failed',
        queue: JOB_NAMES.BACKFILL_PERFORMER_WIKIDATA_IDS,
      },
      'enqueueBackfillPerformerWikidataIds failed',
    );
    return null;
  }
}

/**
 * Trigger the show-ticket-URL backfill outside its 06:45 ET cron — used
 * by the admin "Backfill show ticket URLs" button to catch the backlog
 * of future watching / ticketed shows whose `ticket_url` is null. The
 * inline `shows.create` TM enrichment now covers both watching and
 * ticketed shows, but rows imported before that change still need a
 * sweep, and the cron is the durable safety net for any future
 * ingestion path that doesn't write the column directly.
 */
export async function enqueueBackfillShowTicketUrls(): Promise<
  string | null
> {
  try {
    const boss = await getSender();
    return await boss.send(JOB_NAMES.BACKFILL_SHOW_TICKET_URLS, {});
  } catch (err) {
    log.error(
      {
        err,
        event: 'job_queue.enqueue.failed',
        queue: JOB_NAMES.BACKFILL_SHOW_TICKET_URLS,
      },
      'enqueueBackfillShowTicketUrls failed',
    );
    return null;
  }
}

/**
 * Trigger the daily corpus-fill refresh sweep outside its 04:45 ET cron —
 * top-500 followed performers plus every performer with a watching /
 * ticketed show in the next 30 days. Used by the admin "Refresh setlist
 * corpus (all upcoming)" button.
 */
export async function enqueueSetlistCorpusFillRefresh(): Promise<string | null> {
  try {
    const boss = await getSender();
    return await boss.send(JOB_NAMES.SETLIST_CORPUS_FILL_REFRESH, {});
  } catch (err) {
    log.error(
      {
        err,
        event: 'job_queue.enqueue.failed',
        queue: JOB_NAMES.SETLIST_CORPUS_FILL_REFRESH,
      },
      'enqueueSetlistCorpusFillRefresh failed',
    );
    return null;
  }
}

export async function enqueueIngestRegion(
  regionId: string,
): Promise<string | null> {
  try {
    const boss = await getSender();
    return await boss.send(JOB_NAMES.INGEST_REGION, { regionId });
  } catch (err) {
    log.error({ err, event: 'job_queue.enqueue.failed', queue: JOB_NAMES.INGEST_REGION, regionId }, 'enqueueIngestRegion failed');
    return null;
  }
}

/**
 * Returns true if there's a queued or in-flight ingest job for this region.
 * Used by the Near You tab to show a "Discovering shows…" indicator while
 * the region's first ingest is running. Pending = created | retry | active.
 */
export async function isRegionIngestPending(
  regionId: string,
): Promise<boolean> {
  try {
    const rows = await db.execute(
      sql`SELECT 1 FROM pgboss.job
          WHERE name = ${JOB_NAMES.INGEST_REGION}
            AND state IN ('created','retry','active')
            AND data->>'regionId' = ${regionId}
          LIMIT 1`,
    );
    return rows.length > 0;
  } catch (err) {
    log.error({ err, event: 'job_queue.poll.failed', regionId }, 'isRegionIngestPending failed');
    return false;
  }
}

export type PendingIngestCandidates = {
  venueIds: string[];
  performerIds: string[];
  regionIds: string[];
};

/**
 * Returns which of the candidate venue/performer/region IDs currently have a
 * queued or in-flight ingest job. Used by the Discover view to drive the
 * "ingesting…" indicator + progress for follow / add-region / refresh-now
 * actions. Pending = created | retry | active.
 *
 * Single SQL roundtrip; the active set is small (< a few hundred jobs even
 * during a refresh storm) so this scans pgboss.job by name+state and filters
 * candidates in JS rather than building IN-clauses.
 */
export async function getPendingIngests(
  candidates: PendingIngestCandidates,
): Promise<PendingIngestCandidates> {
  const total =
    candidates.venueIds.length +
    candidates.performerIds.length +
    candidates.regionIds.length;
  if (total === 0) {
    return { venueIds: [], performerIds: [], regionIds: [] };
  }
  try {
    const rows = await db.execute<{
      name: string;
      venue_id: string | null;
      performer_id: string | null;
      region_id: string | null;
    }>(
      sql`SELECT name,
                 data->>'venueId' AS venue_id,
                 data->>'performerId' AS performer_id,
                 data->>'regionId' AS region_id
            FROM pgboss.job
            WHERE name IN (${JOB_NAMES.INGEST_VENUE},
                           ${JOB_NAMES.INGEST_PERFORMER},
                           ${JOB_NAMES.INGEST_REGION})
              AND state IN ('created','retry','active')`,
    );

    const venueSet = new Set(candidates.venueIds);
    const performerSet = new Set(candidates.performerIds);
    const regionSet = new Set(candidates.regionIds);
    const pendingVenues = new Set<string>();
    const pendingPerformers = new Set<string>();
    const pendingRegions = new Set<string>();

    for (const r of rows) {
      if (
        r.name === JOB_NAMES.INGEST_VENUE &&
        r.venue_id &&
        venueSet.has(r.venue_id)
      ) {
        pendingVenues.add(r.venue_id);
      } else if (
        r.name === JOB_NAMES.INGEST_PERFORMER &&
        r.performer_id &&
        performerSet.has(r.performer_id)
      ) {
        pendingPerformers.add(r.performer_id);
      } else if (
        r.name === JOB_NAMES.INGEST_REGION &&
        r.region_id &&
        regionSet.has(r.region_id)
      ) {
        pendingRegions.add(r.region_id);
      }
    }

    return {
      venueIds: [...pendingVenues],
      performerIds: [...pendingPerformers],
      regionIds: [...pendingRegions],
    };
  } catch (err) {
    log.error({ err, event: 'job_queue.poll.failed' }, 'getPendingIngests failed');
    return { venueIds: [], performerIds: [], regionIds: [] };
  }
}

/**
 * Of `performerIds`, return the subset that already had a
 * `setlist-corpus-fill` job enqueued within `withinHours`.
 *
 * Debounces the festival lazy corpus-fill: `predictedFestivalSetlists`
 * isn't cached at the procedure level, so without this guard every
 * festival page open re-enqueues a 3-page `predict` fill for every cold
 * lineup artist. On 2026-05-21 that uncontrolled fan-out put ~480 fills
 * onto the setlist.fm 1440/day budget in one morning and cascaded into
 * 866 failed pg-boss rows.
 *
 * Scans the corpus-fill partition of `pgboss.job` by name + created_on
 * and filters candidates in JS — same shape as `getPendingIngests`. The
 * 6h default window sits well inside pg-boss's 24h archive threshold, so
 * a recent job is always still in `pgboss.job` (not yet in the archive).
 */
export async function performersWithRecentCorpusFill(
  performerIds: string[],
  withinHours = 6,
): Promise<Set<string>> {
  if (performerIds.length === 0) return new Set();
  try {
    // Bind as an ISO string, not a Date — postgres-js encodes bind
    // params via Buffer.byteLength, which throws on a Date instance.
    const sinceIso = new Date(
      Date.now() - withinHours * 60 * 60 * 1000,
    ).toISOString();
    const rows = await db.execute<{ performer_id: string | null }>(
      sql`SELECT DISTINCT data->>'performerId' AS performer_id
            FROM pgboss.job
            WHERE name = ${JOB_NAMES.SETLIST_CORPUS_FILL}
              AND created_on > ${sinceIso}`,
    );
    const candidateSet = new Set(performerIds);
    const recent = new Set<string>();
    for (const r of rows) {
      if (r.performer_id && candidateSet.has(r.performer_id)) {
        recent.add(r.performer_id);
      }
    }
    return recent;
  } catch (err) {
    log.error(
      { err, event: 'job_queue.poll.failed' },
      'performersWithRecentCorpusFill failed',
    );
    // Fail open — a query blip shouldn't block enqueues. The setlist.fm
    // cooldown gate is the backstop against an actual rate-limit storm.
    return new Set();
  }
}
