import PgBoss from 'pg-boss';
import { child, withTrace, flushObservability } from '@showbook/observability';
import {
  runDiscoverIngest,
  ingestVenue,
  ingestPerformer,
  ingestRegion,
} from './discover-ingest';
import { runDailyDigest } from './notifications';
import { runSetlistRetry } from './setlist-retry';
import { runShowsNightly } from './shows-nightly';
import { runBackfillPerformerImages } from './backfill-performer-images';
import { runBackfillVenuePhotos } from './backfill-venue-photos';
import { runPruneOrphanCatalog } from './prune-orphan-catalog';
import { runHealthCheck } from './health-check';
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
  BACKFILL_PERFORMER_IMAGES: 'backfill/performer-images',
  BACKFILL_VENUE_PHOTOS: 'backfill/venue-photos',
  PRUNE_ORPHAN_CATALOG: 'prune/orphan-catalog',
  HEALTH_CHECK: 'health/morning-check',
} as const;

const STALE_SCHEDULES = [
  'notifications/digest',
  'notifications/weekly-digest',
] as const;

const log = child({ component: 'jobs.registry' });

/**
 * Wrap a single pg-boss job execution with structured logging,
 * a Langfuse trace, timing, and observability flush. Errors are logged
 * and re-thrown so pg-boss applies its retry policy.
 */
async function runJob<T = unknown>(
  jobName: string,
  job: PgBoss.Job<T>,
  fn: () => Promise<unknown>,
): Promise<void> {
  const child = log.child({ job: jobName, jobId: job.id });
  const startedAt = Date.now();
  child.info({ event: 'job.start', data: job.data }, 'Job started');

  try {
    await withTrace(
      jobName,
      async () => {
        const result = await fn();
        child.info(
          {
            event: 'job.complete',
            durationMs: Date.now() - startedAt,
            result,
          },
          'Job complete',
        );
      },
      { tags: ['pg-boss'], metadata: { jobId: job.id, data: job.data } },
    );
  } catch (err) {
    child.error(
      {
        event: 'job.failed',
        err,
        durationMs: Date.now() - startedAt,
      },
      'Job failed',
    );
    throw err;
  } finally {
    await flushObservability();
  }
}

async function showsNightlyHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    await runJob(JOBS.SHOWS_NIGHTLY, job, async () => {
      const result = await runShowsNightly();
      log.info(
        {
          event: 'shows.nightly.summary',
          transitioned: result.transitioned,
          queued: result.queued,
          deleted: result.deleted,
        },
        'Shows nightly complete',
      );
      return result;
    });
  }
}

async function setlistRetryHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    await runJob(JOBS.SETLIST_RETRY, job, async () => {
      const result = await runSetlistRetry();
      log.info(
        {
          event: 'setlist.retry.summary',
          processed: result.processed,
          enriched: result.enriched,
          failed: result.failed,
          givenUp: result.givenUp,
        },
        'Setlist retry complete',
      );
      return result;
    });
  }
}

async function discoverIngestHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    await runJob(JOBS.DISCOVER_INGEST, job, async () => {
      const ingest = await runDiscoverIngest();
      log.info(
        {
          event: 'discover.ingest.tm.summary',
          phase1Events: ingest.phase1Events,
          phase2Events: ingest.phase2Events,
          phase3Events: ingest.phase3Events,
          pruned: ingest.pruned,
        },
        'Ticketmaster ingest complete',
      );

      try {
        const scrapers: ScrapersModule = await import('@showbook/scrapers');
        try {
          const scrape = await scrapers.runScrapers();
          log.info(
            {
              event: 'discover.ingest.scrapers.summary',
              attempted: scrape.attempted,
              succeeded: scrape.succeeded,
              failed: scrape.failed,
              eventsCreated: scrape.eventsCreated,
            },
            'Scrapers complete',
          );
        } finally {
          await scrapers.closeBrowser();
        }
      } catch (err) {
        log.error({ err, event: 'discover.ingest.scrapers.failed' }, 'Scrapers failed');
      }

      return ingest;
    });
  }
}

async function discoverIngestVenueHandler(
  jobs: PgBoss.Job<{ venueId: string }>[],
) {
  for (const job of jobs) {
    if (!job.data?.venueId) continue;
    await runJob(JOBS.DISCOVER_INGEST_VENUE, job, async () => {
      const { events } = await ingestVenue(job.data.venueId);
      log.info(
        { event: 'discover.ingest.venue.complete', venueId: job.data.venueId, events },
        'Venue ingest complete',
      );
      return { events };
    });
  }
}

async function discoverIngestPerformerHandler(
  jobs: PgBoss.Job<{ performerId: string }>[],
) {
  for (const job of jobs) {
    if (!job.data?.performerId) continue;
    await runJob(JOBS.DISCOVER_INGEST_PERFORMER, job, async () => {
      const { events } = await ingestPerformer(job.data.performerId);
      log.info(
        { event: 'discover.ingest.performer.complete', performerId: job.data.performerId, events },
        'Performer ingest complete',
      );
      return { events };
    });
  }
}

async function discoverIngestRegionHandler(
  jobs: PgBoss.Job<{ regionId: string }>[],
) {
  for (const job of jobs) {
    if (!job.data?.regionId) continue;
    await runJob(JOBS.DISCOVER_INGEST_REGION, job, async () => {
      const { events } = await ingestRegion(job.data.regionId);
      log.info(
        { event: 'discover.ingest.region.complete', regionId: job.data.regionId, events },
        'Region ingest complete',
      );
      return { events };
    });
  }
}

async function backfillPerformerImagesHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    await runJob(JOBS.BACKFILL_PERFORMER_IMAGES, job, async () => {
      const result = await runBackfillPerformerImages();
      log.info(
        {
          event: 'backfill.performer_images.summary',
          total: result.total,
          updated: result.updated,
          missing: result.missing,
          skipped: result.skipped,
          failed: result.failed,
        },
        'Performer image backfill complete',
      );
      return result;
    });
  }
}

async function backfillVenuePhotosHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    await runJob(JOBS.BACKFILL_VENUE_PHOTOS, job, async () => {
      const result = await runBackfillVenuePhotos();
      log.info(
        {
          event: 'backfill.venue_photos.summary',
          total: result.total,
          updated: result.updated,
          missing: result.missing,
          failed: result.failed,
        },
        'Venue photo backfill complete',
      );
      return result;
    });
  }
}

async function pruneOrphanCatalogHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    await runJob(JOBS.PRUNE_ORPHAN_CATALOG, job, async () => {
      const result = await runPruneOrphanCatalog();
      log.info(
        {
          event: 'prune.summary',
          announcements: result.announcements,
          venues: result.venues,
          performers: result.performers,
        },
        'Orphan catalog prune complete',
      );
      return result;
    });
  }
}

async function healthCheckHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    await runJob(JOBS.HEALTH_CHECK, job, async () => {
      const result = await runHealthCheck();
      // The orchestrator already emits health.check.summary; rebroadcast
      // the rolled-up status here so the registry-level `job.complete`
      // payload includes it for log consumers that key off jobName.
      return {
        status: result.status,
        okCount: result.okCount,
        warnCount: result.warnCount,
        failCount: result.failCount,
        unknownCount: result.unknownCount,
        emailSent: result.emailSent,
      };
    });
  }
}

async function notificationsDailyDigestHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    await runJob(JOBS.NOTIFICATIONS_DAILY_DIGEST, job, async () => {
      const result = await runDailyDigest();
      log.info(
        { event: 'notifications.digest.summary', sent: result.sent, skipped: result.skipped },
        'Daily digest complete',
      );
      return result;
    });
  }
}

export async function registerAllJobs(boss: PgBoss): Promise<void> {
  for (const stale of STALE_SCHEDULES) {
    try {
      await boss.unschedule(stale);
      log.info({ event: 'pgboss.unschedule_stale', name: stale }, 'Unscheduled stale cron');
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
  await boss.work(JOBS.BACKFILL_PERFORMER_IMAGES, backfillPerformerImagesHandler);
  await boss.work(JOBS.BACKFILL_VENUE_PHOTOS, backfillVenuePhotosHandler);
  await boss.work(JOBS.PRUNE_ORPHAN_CATALOG, pruneOrphanCatalogHandler);
  await boss.work(JOBS.HEALTH_CHECK, healthCheckHandler);

  // Backstop sweep for the orphan-cleanup triggers (0002 / 0014 / 0023 /
  // 0025). Runs before shows-nightly so the nightly transition operates on
  // the freshly pruned catalog.
  await boss.schedule(JOBS.PRUNE_ORPHAN_CATALOG, '30 2 * * *', {}, { tz: 'America/New_York' });
  await boss.schedule(JOBS.SHOWS_NIGHTLY, '0 3 * * *', {}, { tz: 'America/New_York' });
  await boss.schedule(JOBS.SETLIST_RETRY, '0 4 * * *', {}, { tz: 'America/New_York' });
  // Backfills run after setlist-retry so any MBIDs persisted on the setlist
  // pass are available when we look up TM attractions by name.
  await boss.schedule(JOBS.BACKFILL_PERFORMER_IMAGES, '30 5 * * *', {}, { tz: 'America/New_York' });
  await boss.schedule(JOBS.BACKFILL_VENUE_PHOTOS, '45 5 * * *', {}, { tz: 'America/New_York' });
  await boss.schedule(JOBS.DISCOVER_INGEST, '0 6 * * 1', {}, { tz: 'America/New_York' });
  // Health summary at 07:00 ET — runs after every overnight cron has had
  // a chance to complete (digest fires at 08:00) so missing summary
  // events are reliable signal, and lands one hour ahead of the digest
  // so the operator can intervene before users see the consequences.
  await boss.schedule(JOBS.HEALTH_CHECK, '0 7 * * *', {}, { tz: 'America/New_York' });
  await boss.schedule(JOBS.NOTIFICATIONS_DAILY_DIGEST, '0 8 * * *', {}, { tz: 'America/New_York' });

  log.info(
    { event: 'pgboss.registered', jobs: Object.values(JOBS) },
    'All jobs registered and scheduled',
  );
}
