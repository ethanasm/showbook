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
import { runBackfillPerformerMbids } from './backfill-performer-mbids';
import { runBackfillPerformerTicketmasterIds } from './backfill-performer-ticketmaster-ids';
import { runBackfillVenuePhotos } from './backfill-venue-photos';
import { runBackfillShowCoverImages } from './backfill-show-cover-images';
import { runPruneOrphanCatalog } from './prune-orphan-catalog';
import { runHealthCheck } from './health-check';
import {
  performersWithUpcomingWatchingShows,
  runSetlistCorpusFill,
  topFollowedPerformers,
  type CorpusFillMode,
} from './setlist-corpus-fill';
import { runSongIndexRebuild } from './song-index-rebuild';
import { runDailyBacktest } from './prediction-eval';
import { runSetlistStyleRefresh } from './setlist-style-refresh';
import { runSpotifyRecentlyPlayed } from './spotify-recently-played';
import { runYearEndSoundtrack } from './year-end-soundtrack';
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
  BACKFILL_PERFORMER_MBIDS: 'backfill/performer-mbids',
  BACKFILL_PERFORMER_TICKETMASTER_IDS: 'backfill/performer-ticketmaster-ids',
  BACKFILL_VENUE_PHOTOS: 'backfill/venue-photos',
  BACKFILL_SHOW_COVER_IMAGES: 'backfill/show-cover-images',
  PRUNE_ORPHAN_CATALOG: 'prune/orphan-catalog',
  HEALTH_CHECK: 'health/morning-check',
  SETLIST_CORPUS_FILL: 'enrichment/setlist-corpus-fill',
  SETLIST_CORPUS_FILL_REFRESH: 'enrichment/setlist-corpus-fill-refresh',
  SONG_INDEX_REBUILD: 'enrichment/song-index-rebuild',
  EVAL_RUN_DAILY_BACKTEST: 'eval/run-daily-backtest',
  SETLIST_STYLE_REFRESH: 'enrichment/setlist-style-refresh',
  SPOTIFY_RECENTLY_PLAYED: 'spotify/recently-played',
  YEAR_END_SOUNDTRACK: 'spotify/year-end-soundtrack',
} as const;

// pg-boss v10 ignores constructor-level retry/expiration options when
// `createQueue` runs without them (see plans.js create_queue: it INSERTs
// the queue row directly from the options arg). The previous setup
// relied on the constructor's `expireInHours: 23` and got the pg-boss
// default of 15 min instead — so when the web container was killed
// mid-job, the orphaned active row sat there for the full 15 min before
// expire-maintenance moved it to retry. We now set queue-level options
// explicitly and `updateQueue` so existing prod queues pick up the new
// values on next boot.
type QueueOptions = {
  expireInSeconds: number;
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
  // pg-boss v10 'singleton' policy: at most one job in `created | active`
  // state per queue at a time. Applied to every cron-driven queue so that
  // (a) if `boss.schedule` ever runs from more than one process (HMR
  // double-register, future multi-replica) the duplicate `boss.send` from
  // the second timekeeper is rejected at INSERT time instead of producing
  // two parallel runs, and (b) a long-running cron (e.g. a 75-min digest)
  // can't pile up tomorrow's run behind itself — the next firing is
  // suppressed until the active one drains. User-triggered queues
  // (FAST_INGEST + the per-performer corpus fill) stay on the default
  // 'standard' policy so multiple in-flight jobs for different
  // performers/venues run in parallel.
  policy?: 'standard' | 'singleton';
};

// Fast user-triggered ingests (Spotify import, follow, refresh-now). A
// killed handler should recover within minutes, not 15+. Default
// 'standard' policy — multiple in-flight jobs for different IDs are
// expected and desirable.
const FAST_INGEST: QueueOptions = {
  expireInSeconds: 300,
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
};

// Long batch jobs that are *user-triggered* (e.g. cron-refresh of
// performer corpus). Same retry profile as scheduled crons but
// standard policy so two different performers can refresh in parallel.
const LONG_BATCH: QueueOptions = {
  expireInSeconds: 1800,
  retryLimit: 2,
  retryDelay: 300,
  retryBackoff: true,
};

// Long batch jobs that are *cron-driven*. Singleton policy collapses any
// duplicate scheduling into one run.
const LONG_BATCH_CRON: QueueOptions = {
  ...LONG_BATCH,
  policy: 'singleton',
};

const QUEUE_OPTIONS: Record<string, QueueOptions> = {
  'shows/nightly': LONG_BATCH_CRON,
  'enrichment/setlist-retry': LONG_BATCH_CRON,
  'discover/ingest': LONG_BATCH_CRON,
  'discover/ingest-venue': FAST_INGEST,
  'discover/ingest-performer': FAST_INGEST,
  'discover/ingest-region': FAST_INGEST,
  'notifications/daily-digest': LONG_BATCH_CRON,
  'backfill/performer-images': LONG_BATCH_CRON,
  'backfill/performer-mbids': LONG_BATCH_CRON,
  'backfill/performer-ticketmaster-ids': LONG_BATCH_CRON,
  'backfill/venue-photos': LONG_BATCH_CRON,
  'backfill/show-cover-images': LONG_BATCH_CRON,
  'prune/orphan-catalog': LONG_BATCH_CRON,
  'health/morning-check': LONG_BATCH_CRON,
  // Per-performer corpus fill is user-triggered (follow / show-detail
  // open) so fast turnaround matters and parallel runs across different
  // performers are expected. The daily refresh cron schedules through a
  // separate queue with the singleton cron profile.
  'enrichment/setlist-corpus-fill': FAST_INGEST,
  'enrichment/setlist-corpus-fill-refresh': LONG_BATCH_CRON,
  // Song-index rebuild is invoked both as a cron and inline after a
  // corpus-fill. Keep 'standard' so the inline-chained rebuild can run
  // alongside ad-hoc admin rebuilds; the cron itself is rare and brief.
  'enrichment/song-index-rebuild': LONG_BATCH,
  'eval/run-daily-backtest': LONG_BATCH_CRON,
  'enrichment/setlist-style-refresh': LONG_BATCH_CRON,
  'spotify/recently-played': LONG_BATCH_CRON,
  'spotify/year-end-soundtrack': LONG_BATCH_CRON,
};

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
          catchupQueued: result.catchupQueued,
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

async function backfillPerformerMbidsHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    await runJob(JOBS.BACKFILL_PERFORMER_MBIDS, job, async () => {
      const result = await runBackfillPerformerMbids();
      log.info(
        {
          event: 'backfill.performer_mbids.summary',
          total: result.total,
          updated: result.updated,
          missing: result.missing,
          skipped: result.skipped,
          failed: result.failed,
        },
        'Performer MBID backfill complete',
      );
      return result;
    });
  }
}

async function backfillPerformerTicketmasterIdsHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    await runJob(JOBS.BACKFILL_PERFORMER_TICKETMASTER_IDS, job, async () => {
      const result = await runBackfillPerformerTicketmasterIds();
      log.info(
        {
          event: 'backfill.performer_ticketmaster_ids.summary',
          total: result.total,
          updated: result.updated,
          missing: result.missing,
          skipped: result.skipped,
          failed: result.failed,
        },
        'Performer Ticketmaster ID backfill complete',
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

async function backfillShowCoverImagesHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    await runJob(JOBS.BACKFILL_SHOW_COVER_IMAGES, job, async () => {
      const result = await runBackfillShowCoverImages();
      log.info(
        {
          event: 'backfill.show_cover_images.summary',
          total: result.total,
          updated: result.updated,
          missing: result.missing,
          failed: result.failed,
        },
        'Show cover image backfill complete',
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

async function setlistCorpusFillHandler(
  jobs: PgBoss.Job<{ performerId: string; mode: CorpusFillMode }>[],
) {
  for (const job of jobs) {
    if (!job.data?.performerId) continue;
    await runJob(JOBS.SETLIST_CORPUS_FILL, job, async () => {
      const result = await runSetlistCorpusFill({
        performerId: job.data.performerId,
        mode: job.data.mode ?? 'predict',
      });
      // Chain a performer-scoped song-index rebuild so the freshly
      // ingested corpus is queryable for the algorithm. Inline-await
      // rather than enqueue: the index rebuild for a single performer is
      // fast and the caller (the show-detail page open / follow flow)
      // wants the data ready by the next read.
      if (result.fetched > 0) {
        await runSongIndexRebuild({ performerId: job.data.performerId });
      }
      return result;
    });
  }
}

async function setlistCorpusFillRefreshHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    await runJob(JOBS.SETLIST_CORPUS_FILL_REFRESH, job, async () => {
      // Two pools: the top-N followed performers (steady-state coverage)
      // and any performer with a `watching` or `ticketed` show in the
      // next 30 days (so a show-detail open inside that window finds a
      // warm corpus). Union and dedupe.
      const [followed, upcoming] = await Promise.all([
        topFollowedPerformers(500),
        performersWithUpcomingWatchingShows(30),
      ]);
      const queue = Array.from(new Set([...followed, ...upcoming]));
      let processed = 0;
      let failed = 0;
      for (const performerId of queue) {
        try {
          await runSetlistCorpusFill({ performerId, mode: 'refresh' });
          processed += 1;
        } catch (err) {
          // One bad performer shouldn't kill the whole cron; the job
          // wrapper already records the per-performer failure via
          // `setlist.corpus_fill.failed`.
          log.error(
            { event: 'setlist.corpus_fill.refresh.entry_failed', err, performerId },
            'corpus-fill refresh entry failed',
          );
          failed += 1;
        }
      }
      // Single matview refresh at the end of the cron (each per-performer
      // rebuild skipped it via skipMatviewRefresh).
      try {
        await runSongIndexRebuild({});
      } catch (err) {
        log.error(
          { event: 'setlist.corpus_fill.refresh.indexer_failed', err },
          'corpus-fill refresh indexer failed',
        );
      }
      log.info(
        {
          event: 'setlist.corpus_fill.refresh.summary',
          processed,
          failed,
          total: queue.length,
        },
        'corpus-fill daily refresh complete',
      );
      return { processed, failed, total: queue.length };
    });
  }
}

async function songIndexRebuildHandler(
  jobs: PgBoss.Job<{
    performerId?: string;
    showIds?: string[];
    tourSetlistIds?: string[];
  }>[],
) {
  for (const job of jobs) {
    await runJob(JOBS.SONG_INDEX_REBUILD, job, async () => {
      return runSongIndexRebuild(job.data ?? {});
    });
  }
}

async function evalRunDailyBacktestHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    await runJob(JOBS.EVAL_RUN_DAILY_BACKTEST, job, async () => {
      const result = await runDailyBacktest({});
      log.info(
        {
          event: 'eval.run.summary',
          runId: result.runId,
          windowDays: result.windowDays,
          evaluatedShows: result.evaluatedShows,
          predictionCount: result.predictionCount,
          brierScore: result.brierScore,
          precisionTop10: result.precisionTop10,
          recallTop15: result.recallTop15,
          calibrationError: result.calibrationError,
        },
        'Prediction-eval back-test complete',
      );
      return result;
    });
  }
}

async function setlistStyleRefreshHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    await runJob(JOBS.SETLIST_STYLE_REFRESH, job, async () => {
      const result = await runSetlistStyleRefresh();
      return result;
    });
  }
}

async function spotifyRecentlyPlayedHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    await runJob(JOBS.SPOTIFY_RECENTLY_PLAYED, job, async () => {
      const result = await runSpotifyRecentlyPlayed();
      log.info(
        {
          event: 'spotify.recently_played.summary',
          attempted: result.attempted,
          matched: result.matched,
          noMatch: result.noMatch,
          failed: result.failed,
        },
        'Recently-played sweep complete',
      );
      return result;
    });
  }
}

async function yearEndSoundtrackHandler(jobs: PgBoss.Job[]) {
  for (const job of jobs) {
    await runJob(JOBS.YEAR_END_SOUNDTRACK, job, async () => {
      const result = await runYearEndSoundtrack();
      log.info(
        {
          event: 'year_end_soundtrack.summary',
          attempted: result.attempted,
          built: result.built,
          reused: result.reused,
          skipped: result.skipped,
          failed: result.failed,
          year: result.year,
        },
        'Year-end soundtrack sweep complete',
      );
      return result;
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

// Guard so a second invocation of `registerAllJobs` against the same
// boss instance is a no-op rather than re-registering every queue's
// worker on top of the existing one. Empirically (Axiom over
// 2026-05-01..05-08), every scheduled cron in prod fires two
// `job.start` events with two distinct jobIds — but only one row exists
// in `pgboss.job` per firing, and the "missing" jobIds are absent from
// `pgboss.archive` too. The shape matches "two `boss.work(name,
// handler)` workers polling the same queue, each receiving the same DB
// row through separate fetches." `boss.work` does not de-dupe by name,
// so a second `registerAllJobs` call would silently add a parallel
// worker for every queue.
//
// We don't yet know what's invoking `register()` (and therefore
// `registerAllJobs`) twice in the prod Next.js process — single
// container, single `pgboss.started` event per restart. The guard
// closes the bug regardless of the trigger and the
// `pgboss.register.duplicate` event surfaces the second call to Axiom
// so we can keep hunting the cause.
//
// The guard is keyed on the boss instance (WeakSet, not a module-level
// boolean) so each test that constructs a fake boss starts fresh. In
// prod `getBoss()` returns a process-wide singleton, so subsequent
// `register()` invocations against that same instance hit the guard.
const REGISTERED_INSTANCES = new WeakSet<object>();

export async function registerAllJobs(boss: PgBoss): Promise<void> {
  if (REGISTERED_INSTANCES.has(boss as unknown as object)) {
    log.warn(
      { event: 'pgboss.register.duplicate' },
      'registerAllJobs called more than once against this boss instance; second call ignored',
    );
    return;
  }
  REGISTERED_INSTANCES.add(boss as unknown as object);

  for (const name of Object.values(JOBS)) {
    const opts = { name, ...QUEUE_OPTIONS[name] };
    await boss.createQueue(name, opts);
    // create_queue is ON CONFLICT DO NOTHING, so existing queues keep
    // whatever options they were originally created with. Force-apply
    // the current options every boot.
    await boss.updateQueue(name, opts);
  }

  await boss.work(JOBS.SHOWS_NIGHTLY, showsNightlyHandler);
  await boss.work(JOBS.SETLIST_RETRY, setlistRetryHandler);
  await boss.work(JOBS.DISCOVER_INGEST, discoverIngestHandler);
  await boss.work(JOBS.DISCOVER_INGEST_VENUE, discoverIngestVenueHandler);
  await boss.work(JOBS.DISCOVER_INGEST_PERFORMER, discoverIngestPerformerHandler);
  await boss.work(JOBS.DISCOVER_INGEST_REGION, discoverIngestRegionHandler);
  await boss.work(JOBS.NOTIFICATIONS_DAILY_DIGEST, notificationsDailyDigestHandler);
  await boss.work(JOBS.BACKFILL_PERFORMER_IMAGES, backfillPerformerImagesHandler);
  await boss.work(JOBS.BACKFILL_PERFORMER_MBIDS, backfillPerformerMbidsHandler);
  await boss.work(
    JOBS.BACKFILL_PERFORMER_TICKETMASTER_IDS,
    backfillPerformerTicketmasterIdsHandler,
  );
  await boss.work(JOBS.BACKFILL_VENUE_PHOTOS, backfillVenuePhotosHandler);
  await boss.work(JOBS.BACKFILL_SHOW_COVER_IMAGES, backfillShowCoverImagesHandler);
  await boss.work(JOBS.PRUNE_ORPHAN_CATALOG, pruneOrphanCatalogHandler);
  await boss.work(JOBS.HEALTH_CHECK, healthCheckHandler);
  await boss.work(JOBS.SETLIST_CORPUS_FILL, setlistCorpusFillHandler);
  await boss.work(JOBS.SETLIST_CORPUS_FILL_REFRESH, setlistCorpusFillRefreshHandler);
  await boss.work(JOBS.SONG_INDEX_REBUILD, songIndexRebuildHandler);
  await boss.work(JOBS.EVAL_RUN_DAILY_BACKTEST, evalRunDailyBacktestHandler);
  await boss.work(JOBS.SETLIST_STYLE_REFRESH, setlistStyleRefreshHandler);
  await boss.work(JOBS.SPOTIFY_RECENTLY_PLAYED, spotifyRecentlyPlayedHandler);
  await boss.work(JOBS.YEAR_END_SOUNDTRACK, yearEndSoundtrackHandler);

  // Backstop sweep for the orphan-cleanup triggers (0002 / 0014 / 0023 /
  // 0025). Runs before shows-nightly so the nightly transition operates on
  // the freshly pruned catalog.
  await boss.schedule(JOBS.PRUNE_ORPHAN_CATALOG, '30 2 * * *', {}, { tz: 'America/New_York' });
  await boss.schedule(JOBS.SHOWS_NIGHTLY, '0 3 * * *', {}, { tz: 'America/New_York' });
  await boss.schedule(JOBS.SETLIST_RETRY, '0 4 * * *', {}, { tz: 'America/New_York' });
  // MBID backfill at 04:30 ET — between setlist-retry (04:00) and the
  // corpus-fill refresh (04:45) so freshly-resolved MBIDs are visible to
  // the same morning's corpus-fill pass. Closes the gap for Gmail /
  // manual-entry performers whose `musicbrainz_id IS NULL` because the
  // LLM extractor never had one to supply.
  await boss.schedule(JOBS.BACKFILL_PERFORMER_MBIDS, '30 4 * * *', {}, { tz: 'America/New_York' });
  // Backfills run after setlist-retry so any MBIDs persisted on the setlist
  // pass are available when we look up TM attractions by name.
  await boss.schedule(JOBS.BACKFILL_PERFORMER_IMAGES, '30 5 * * *', {}, { tz: 'America/New_York' });
  await boss.schedule(JOBS.BACKFILL_VENUE_PHOTOS, '45 5 * * *', {}, { tz: 'America/New_York' });
  // Performer TM-id backfill at 06:00 ET — slotted between venue-photos
  // (05:45) and show-cover-images (06:15). Catches performers that
  // already have images (so the 05:30 image backfill skipped them) but
  // are still missing a TM attraction id.
  await boss.schedule(JOBS.BACKFILL_PERFORMER_TICKETMASTER_IDS, '0 6 * * *', {}, { tz: 'America/New_York' });
  await boss.schedule(JOBS.BACKFILL_SHOW_COVER_IMAGES, '15 6 * * *', {}, { tz: 'America/New_York' });
  await boss.schedule(JOBS.DISCOVER_INGEST, '0 6 * * 1', {}, { tz: 'America/New_York' });
  // Health summary at 07:00 ET — runs after every overnight cron has had
  // a chance to complete (digest fires at 08:00) so missing summary
  // events are reliable signal, and lands one hour ahead of the digest
  // so the operator can intervene before users see the consequences.
  await boss.schedule(JOBS.HEALTH_CHECK, '0 7 * * *', {}, { tz: 'America/New_York' });
  // Daily corpus refresh at 04:45 ET — late enough that the prior
  // night's setlists are likely on setlist.fm, early enough to be done
  // before the 05:30 backfill jobs need stable performer rows.
  await boss.schedule(
    JOBS.SETLIST_CORPUS_FILL_REFRESH,
    '45 4 * * *',
    {},
    { tz: 'America/New_York' },
  );
  // Prediction-eval back-test at 03:00 ET. Runs against `tour_setlists`
  // already on disk (no external API calls); the corpus-fill refresh at
  // 04:45 ET later that morning brings fresh setlists in for *tomorrow's*
  // back-test. Phase 4 ships this in shadow mode — no release gate yet.
  await boss.schedule(JOBS.EVAL_RUN_DAILY_BACKTEST, '0 3 * * *', {}, { tz: 'America/New_York' });
  // Setlist-style refresh at 03:30 ET — runs after the eval back-test
  // (which only consumes the *current* stored styles) and before the
  // corpus-fill refresh (which doesn't depend on styles). Three-runs-
  // to-disagree on seed entries; auto-applies on first run for new
  // performers.
  await boss.schedule(JOBS.SETLIST_STYLE_REFRESH, '30 3 * * *', {}, { tz: 'America/New_York' });
  await boss.schedule(JOBS.NOTIFICATIONS_DAILY_DIGEST, '0 8 * * *', {}, { tz: 'America/New_York' });
  // Phase 7 — recently-played priming-stat sweep at 09:00 ET nightly,
  // settling each show's prep/post counts 6h post-show.
  await boss.schedule(JOBS.SPOTIFY_RECENTLY_PLAYED, '0 9 * * *', {}, { tz: 'America/New_York' });
  // Phase 7 — year-end soundtrack on Dec 31 at 03:00 ET. Idempotent
  // against the users.spotify_year_playlists map so re-runs overwrite
  // instead of creating duplicates.
  await boss.schedule(JOBS.YEAR_END_SOUNDTRACK, '0 3 31 12 *', {}, { tz: 'America/New_York' });

  log.info(
    { event: 'pgboss.registered', jobs: Object.values(JOBS) },
    'All jobs registered and scheduled',
  );
}
