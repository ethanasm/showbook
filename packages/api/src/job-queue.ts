/**
 * Lightweight pg-boss client for enqueuing jobs from tRPC mutations.
 *
 * This is a "send-only" instance, separate from the worker pool managed in
 * @showbook/jobs. They share the same Postgres queue tables, so jobs sent
 * from the API are picked up by handlers registered by the worker.
 */

import PgBoss from 'pg-boss';

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
    console.error('[job-queue] enqueueIngestVenue failed:', err);
  }
}

export async function enqueueIngestPerformer(performerId: string): Promise<void> {
  try {
    const boss = await getSender();
    await boss.send(JOB_NAMES.INGEST_PERFORMER, { performerId });
  } catch (err) {
    console.error('[job-queue] enqueueIngestPerformer failed:', err);
  }
}

export async function enqueueIngestRegion(regionId: string): Promise<void> {
  try {
    const boss = await getSender();
    await boss.send(JOB_NAMES.INGEST_REGION, { regionId });
  } catch (err) {
    console.error('[job-queue] enqueueIngestRegion failed:', err);
  }
}
