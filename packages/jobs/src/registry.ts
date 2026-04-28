import PgBoss from 'pg-boss';
import {
  runDiscoverIngest,
  ingestVenue,
  ingestPerformer,
} from './discover-ingest';
import {
  runNotificationDigest,
  runWeeklyDiscoveryDigest,
} from './notifications';
import { runSetlistRetry } from './setlist-retry';
import { runShowsNightly } from './shows-nightly';
import { runScrapers, closeBrowser } from '@showbook/scrapers';

export const JOBS = {
  SHOWS_NIGHTLY: 'shows/nightly',
  SETLIST_RETRY: 'enrichment/setlist-retry',
  DISCOVER_INGEST: 'discover/ingest',
  DISCOVER_INGEST_VENUE: 'discover/ingest-venue',
  DISCOVER_INGEST_PERFORMER: 'discover/ingest-performer',
  NOTIFICATIONS_DIGEST: 'notifications/digest',
  NOTIFICATIONS_WEEKLY_DIGEST: 'notifications/weekly-digest',
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

/**
 * Weekly discovery ingestion + scraping + per-user digest, chained.
 * The digest is sent immediately after both data sources have run so it
 * reflects everything discovered this week.
 */
async function discoverIngestHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    console.log(`[${JOBS.DISCOVER_INGEST}] Running weekly discovery ingestion...`, job.id);
    try {
      const ingest = await runDiscoverIngest();
      console.log(
        `[${JOBS.DISCOVER_INGEST}] TM: ${ingest.phase1Events} venue events, ` +
        `${ingest.phase2Events} region events, ${ingest.phase3Events} performer events, ` +
        `${ingest.pruned} pruned`,
      );

      try {
        const scrape = await runScrapers();
        console.log(
          `[${JOBS.DISCOVER_INGEST}] Scrapers: attempted=${scrape.attempted} ` +
          `succeeded=${scrape.succeeded} failed=${scrape.failed} created=${scrape.eventsCreated}`,
        );
      } catch (err) {
        console.error(`[${JOBS.DISCOVER_INGEST}] Scrapers failed:`, err);
      } finally {
        await closeBrowser();
      }

      const digest = await runWeeklyDiscoveryDigest({
        ingestionRunStart: ingest.ingestionRunStart,
      });
      console.log(
        `[${JOBS.NOTIFICATIONS_WEEKLY_DIGEST}] Sent: ${digest.sent}, skipped: ${digest.skipped}`,
      );
    } catch (error) {
      console.error(`[${JOBS.DISCOVER_INGEST}] Fatal error:`, error);
      throw error;
    }
  }
}

async function discoverIngestVenueHandler(
  jobs: PgBoss.Job<{ venueId: string }>[],
) {
  for (const job of jobs) {
    if (!job.data?.venueId) continue;
    try {
      const { events } = await ingestVenue(job.data.venueId);
      console.log(
        `[${JOBS.DISCOVER_INGEST_VENUE}] venue=${job.data.venueId} created=${events}`,
      );
    } catch (err) {
      console.error(
        `[${JOBS.DISCOVER_INGEST_VENUE}] error venue=${job.data.venueId}:`,
        err,
      );
      throw err;
    }
  }
}

async function discoverIngestPerformerHandler(
  jobs: PgBoss.Job<{ performerId: string }>[],
) {
  for (const job of jobs) {
    if (!job.data?.performerId) continue;
    try {
      const { events } = await ingestPerformer(job.data.performerId);
      console.log(
        `[${JOBS.DISCOVER_INGEST_PERFORMER}] performer=${job.data.performerId} created=${events}`,
      );
    } catch (err) {
      console.error(
        `[${JOBS.DISCOVER_INGEST_PERFORMER}] error performer=${job.data.performerId}:`,
        err,
      );
      throw err;
    }
  }
}

async function notificationsDigestHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    console.log(`[${JOBS.NOTIFICATIONS_DIGEST}] Running show-day reminder...`, job.id);
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
  await boss.work(JOBS.SHOWS_NIGHTLY, showsNightlyHandler);
  await boss.work(JOBS.SETLIST_RETRY, setlistRetryHandler);
  await boss.work(JOBS.DISCOVER_INGEST, discoverIngestHandler);
  await boss.work(JOBS.DISCOVER_INGEST_VENUE, discoverIngestVenueHandler);
  await boss.work(JOBS.DISCOVER_INGEST_PERFORMER, discoverIngestPerformerHandler);
  await boss.work(JOBS.NOTIFICATIONS_DIGEST, notificationsDigestHandler);

  await boss.schedule(JOBS.SHOWS_NIGHTLY, '0 3 * * *', {}, { tz: 'America/New_York' });
  await boss.schedule(JOBS.SETLIST_RETRY, '0 4 * * *', {}, { tz: 'America/New_York' });
  // Weekly Monday 6 AM ET. Sends one digest email per user immediately after.
  await boss.schedule(JOBS.DISCOVER_INGEST, '0 6 * * 1', {}, { tz: 'America/New_York' });
  // Hourly check; runNotificationDigest now only handles show-day reminders.
  await boss.schedule(JOBS.NOTIFICATIONS_DIGEST, '0 * * * *', {}, { tz: 'America/New_York' });

  console.log('All jobs registered and scheduled');
}
