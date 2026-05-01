/**
 * Lightweight pg-boss client for enqueuing jobs from tRPC mutations.
 *
 * This is a "send-only" instance, separate from the worker pool managed in
 * @showbook/jobs. They share the same Postgres queue tables, so jobs sent
 * from the API are picked up by handlers registered by the worker.
 */

import PgBoss from 'pg-boss';
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
} as const;

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
