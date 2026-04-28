/**
 * Lightweight pg-boss client for enqueuing jobs from tRPC mutations.
 *
 * This is a "send-only" instance, separate from the worker pool managed in
 * @showbook/jobs. They share the same Postgres queue tables, so jobs sent
 * from the API are picked up by handlers registered by the worker.
 */

import PgBoss from 'pg-boss';

let sender: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

async function getSender(): Promise<PgBoss> {
  if (sender) return sender;
  if (starting) return starting;
  starting = (async () => {
    const instance = new PgBoss({
      connectionString: process.env.DATABASE_URL!,
    });
    await instance.start();
    sender = instance;
    return instance;
  })();
  return starting;
}

export const JOB_NAMES = {
  INGEST_VENUE: 'discover/ingest-venue',
  INGEST_PERFORMER: 'discover/ingest-performer',
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
