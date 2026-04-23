import PgBoss from 'pg-boss';
import { runDiscoverIngest } from './discover-ingest';
import { runNotificationDigest } from './notifications';
import { runSetlistRetry } from './setlist-retry';
import { runShowsNightly } from './shows-nightly';

// Job names
export const JOBS = {
  SHOWS_NIGHTLY: 'shows/nightly',
  SETLIST_RETRY: 'enrichment/setlist-retry',
  DISCOVER_INGEST: 'discover/ingest',
  NOTIFICATIONS_DIGEST: 'notifications/digest',
} as const;

async function showsNightlyHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    console.log(`[${JOBS.SHOWS_NIGHTLY}] Running nightly state transitions...`, job.id);
    const result = await runShowsNightly();
    console.log(
      `[${JOBS.SHOWS_NIGHTLY}] Done: ${result.transitioned} transitioned, ${result.queued} queued for enrichment, ${result.deleted} deleted`
    );
  }
}

async function setlistRetryHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    console.log(`[${JOBS.SETLIST_RETRY}] Starting setlist enrichment retry...`, job.id);
    try {
      const result = await runSetlistRetry();
      console.log(
        `[${JOBS.SETLIST_RETRY}] Complete: ${result.processed} processed, ` +
        `${result.enriched} enriched, ${result.failed} failed, ${result.givenUp} given up`,
      );
    } catch (error) {
      console.error(`[${JOBS.SETLIST_RETRY}] Fatal error:`, error);
      throw error;
    }
  }
}

async function discoverIngestHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    console.log(`[${JOBS.DISCOVER_INGEST}] Running discovery ingestion...`, job.id);
    try {
      const result = await runDiscoverIngest();
      console.log(
        `[${JOBS.DISCOVER_INGEST}] Complete: ${result.phase1Events} venue events, ` +
        `${result.phase2Events} region events, ${result.pruned} pruned`,
      );
    } catch (error) {
      console.error(`[${JOBS.DISCOVER_INGEST}] Fatal error:`, error);
      throw error;
    }
  }
}

async function notificationsDigestHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    console.log(`[${JOBS.NOTIFICATIONS_DIGEST}] Running notification digest...`, job.id);
    try {
      const result = await runNotificationDigest();
      console.log(
        `[${JOBS.NOTIFICATIONS_DIGEST}] Complete: ${result.sent} sent, ${result.skipped} skipped`,
      );
    } catch (error) {
      console.error(`[${JOBS.NOTIFICATIONS_DIGEST}] Fatal error:`, error);
      throw error;
    }
  }
}

export async function registerAllJobs(boss: PgBoss): Promise<void> {
  // Register handlers
  await boss.work(JOBS.SHOWS_NIGHTLY, showsNightlyHandler);
  await boss.work(JOBS.SETLIST_RETRY, setlistRetryHandler);
  await boss.work(JOBS.DISCOVER_INGEST, discoverIngestHandler);
  await boss.work(JOBS.NOTIFICATIONS_DIGEST, notificationsDigestHandler);

  // Schedule cron jobs
  await boss.schedule(JOBS.SHOWS_NIGHTLY, '0 3 * * *', {}, { tz: 'America/New_York' });
  await boss.schedule(JOBS.SETLIST_RETRY, '0 4 * * *', {}, { tz: 'America/New_York' });
  await boss.schedule(JOBS.DISCOVER_INGEST, '0 2 * * *', {}, { tz: 'America/New_York' });
  // Digest runs hourly; each run checks which users have digestTime matching the current hour
  await boss.schedule(JOBS.NOTIFICATIONS_DIGEST, '0 * * * *', {}, { tz: 'America/New_York' });

  console.log('All jobs registered and scheduled');
}
