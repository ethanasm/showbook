import PgBoss from 'pg-boss';
import {
  runDiscoverIngest,
  ingestVenue,
  ingestPerformer,
  ingestRegion,
} from './discover-ingest';
import { runDailyDigest } from './notifications';
import { runSetlistRetry } from './setlist-retry';
import { runShowsNightly } from './shows-nightly';
// @showbook/scrapers pulls in Playwright, which the Next.js dev server
// tries to bundle. Import it lazily inside the handler so it stays out of
// the web app's static dependency graph.
type ScrapersModule = typeof import('@showbook/scrapers');

export const JOBS = {
  SHOWS_NIGHTLY: 'shows/nightly',
  SETLIST_RETRY: 'enrichment/setlist-retry',
  DISCOVER_INGEST: 'discover/ingest',
  DISCOVER_INGEST_VENUE: 'discover/ingest-venue',
  DISCOVER_INGEST_PERFORMER: 'discover/ingest-performer',
  DISCOVER_INGEST_REGION: 'discover/ingest-region',
  NOTIFICATIONS_DAILY_DIGEST: 'notifications/daily-digest',
} as const;

// Pre-1.0 cron names that have been removed and must be unscheduled on startup
// so we don't keep firing handlers that no longer exist.
const STALE_SCHEDULES = [
  'notifications/digest',
  'notifications/weekly-digest',
] as const;

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
 * Weekly discovery ingestion + scraping. Announcements land in the DB and
 * the daily digest job picks them up via discoveredAt > lastDigestSentAt.
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
        const scrapers: ScrapersModule = await import('@showbook/scrapers');
        try {
          const scrape = await scrapers.runScrapers();
          console.log(
            `[${JOBS.DISCOVER_INGEST}] Scrapers: attempted=${scrape.attempted} ` +
            `succeeded=${scrape.succeeded} failed=${scrape.failed} created=${scrape.eventsCreated}`,
          );
        } finally {
          await scrapers.closeBrowser();
        }
      } catch (err) {
        console.error(`[${JOBS.DISCOVER_INGEST}] Scrapers failed:`, err);
      }
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

async function discoverIngestRegionHandler(
  jobs: PgBoss.Job<{ regionId: string }>[],
) {
  for (const job of jobs) {
    if (!job.data?.regionId) continue;
    try {
      const { events } = await ingestRegion(job.data.regionId);
      console.log(
        `[${JOBS.DISCOVER_INGEST_REGION}] region=${job.data.regionId} created=${events}`,
      );
    } catch (err) {
      console.error(
        `[${JOBS.DISCOVER_INGEST_REGION}] error region=${job.data.regionId}:`,
        err,
      );
      throw err;
    }
  }
}

async function notificationsDailyDigestHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    console.log(`[${JOBS.NOTIFICATIONS_DAILY_DIGEST}] Running daily digest...`, job.id);
    try {
      const result = await runDailyDigest();
      console.log(
        `[${JOBS.NOTIFICATIONS_DAILY_DIGEST}] Complete: ${result.sent} sent, ${result.skipped} skipped`,
      );
    } catch (error) {
      console.error(`[${JOBS.NOTIFICATIONS_DAILY_DIGEST}] Fatal error:`, error);
      throw error;
    }
  }
}

export async function registerAllJobs(boss: PgBoss): Promise<void> {
  // Idempotently remove pre-1.0 schedules. The 0012 migration also runs a
  // SQL DELETE against pgboss.schedule, but this guards against fresh DBs
  // restored from a snapshot that predates the migration.
  for (const stale of STALE_SCHEDULES) {
    try {
      await boss.unschedule(stale);
    } catch {
      // unschedule throws if no schedule exists — safe to ignore
    }
  }

  for (const name of Object.values(JOBS)) {
    await boss.createQueue(name);
  }

  await boss.work(JOBS.SHOWS_NIGHTLY, showsNightlyHandler);
  await boss.work(JOBS.SETLIST_RETRY, setlistRetryHandler);
  await boss.work(JOBS.DISCOVER_INGEST, discoverIngestHandler);
  await boss.work(JOBS.DISCOVER_INGEST_VENUE, discoverIngestVenueHandler);
  await boss.work(JOBS.DISCOVER_INGEST_PERFORMER, discoverIngestPerformerHandler);
  await boss.work(JOBS.DISCOVER_INGEST_REGION, discoverIngestRegionHandler);
  await boss.work(JOBS.NOTIFICATIONS_DAILY_DIGEST, notificationsDailyDigestHandler);

  await boss.schedule(JOBS.SHOWS_NIGHTLY, '0 3 * * *', {}, { tz: 'America/New_York' });
  await boss.schedule(JOBS.SETLIST_RETRY, '0 4 * * *', {}, { tz: 'America/New_York' });
  await boss.schedule(JOBS.DISCOVER_INGEST, '0 6 * * 1', {}, { tz: 'America/New_York' });
  await boss.schedule(JOBS.NOTIFICATIONS_DAILY_DIGEST, '0 8 * * *', {}, { tz: 'America/New_York' });

  console.log('All jobs registered and scheduled');
}
