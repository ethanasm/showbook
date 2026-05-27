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
import { runBackfillPerformerSpotifyIds } from './backfill-performer-spotify-ids';
import { runBackfillVenuePhotos } from './backfill-venue-photos';
import { runBackfillShowCoverImages } from './backfill-show-cover-images';
import { runBackfillShowTicketUrls } from './backfill-show-ticket-urls';
import { runPruneOrphanCatalog } from './prune-orphan-catalog';
import { runPrunePastAnnouncements } from './prune-past-announcements';
import { runHealthCheck } from './health-check';
import {
  performersWithUpcomingWatchingShows,
  runSetlistCorpusFill,
  topFollowedPerformers,
  type CorpusFillMode,
} from './setlist-corpus-fill';
import { runSongIndexRebuild } from '@showbook/api';
import { runDailyBacktest } from './prediction-eval';
import { runSetlistStyleRefresh } from './setlist-style-refresh';
import { runSpotifyRecentlyPlayed } from './spotify-recently-played';
import { runYearEndSoundtrack } from './year-end-soundtrack';
import { runAlbumMetadataFill } from './album-metadata-fill';
import { runSetlistTourWatch } from './setlist-tour-watch';
import { runSpotifyPurgeRevokedTokens } from './spotify-purge-revoked-tokens';
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
  BACKFILL_PERFORMER_SPOTIFY_IDS: 'backfill/performer-spotify-ids',
  BACKFILL_VENUE_PHOTOS: 'backfill/venue-photos',
  BACKFILL_SHOW_COVER_IMAGES: 'backfill/show-cover-images',
  BACKFILL_SHOW_TICKET_URLS: 'backfill/show-ticket-urls',
  PRUNE_ORPHAN_CATALOG: 'prune/orphan-catalog',
  PRUNE_PAST_ANNOUNCEMENTS: 'prune/past-announcements',
  HEALTH_CHECK: 'health/morning-check',
  SETLIST_CORPUS_FILL: 'enrichment/setlist-corpus-fill',
  SETLIST_CORPUS_FILL_REFRESH: 'enrichment/setlist-corpus-fill-refresh',
  SONG_INDEX_REBUILD: 'enrichment/song-index-rebuild',
  EVAL_RUN_DAILY_BACKTEST: 'eval/run-daily-backtest',
  SETLIST_STYLE_REFRESH: 'enrichment/setlist-style-refresh',
  SPOTIFY_RECENTLY_PLAYED: 'spotify/recently-played',
  YEAR_END_SOUNDTRACK: 'spotify/year-end-soundtrack',
  ALBUM_METADATA_FILL: 'enrichment/album-metadata-fill',
  SETLIST_TOUR_WATCH: 'enrichment/setlist-tour-watch',
  SPOTIFY_PURGE_REVOKED_TOKENS: 'spotify/purge-revoked-tokens',
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

const log = child({ component: 'jobs.registry' });

const SCHEDULE_TZ = { tz: 'America/New_York' } as const;

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

// Summary log payload returned by a handler's `summary` callback.
// `event` + `msg` map onto pino's structured-fields + message-string
// signature; any other key becomes a structured field in Axiom.
type SummaryPayload = { event: string; msg: string } & Record<string, unknown>;

/**
 * Build a pg-boss batch handler from a single-job `run` function. Wraps
 * each job in `runJob` (which owns `job.start`/`job.complete`/`job.failed`
 * + Langfuse trace + observability flush), then — if `summary` is
 * provided — emits the per-job rollup log that production dashboards
 * filter on (`shows.nightly.summary`, `backfill.*.summary`, etc.).
 *
 * Use `skipWhen` to short-circuit jobs whose `job.data` is missing the
 * fields the handler needs (the per-id ingest queues do this so a
 * malformed enqueue doesn't crash the worker).
 */
function defineJobHandler<TData = unknown, TResult = unknown>(spec: {
  name: string;
  run: (job: PgBoss.Job<TData>) => Promise<TResult>;
  summary?: (result: TResult) => SummaryPayload;
  skipWhen?: (job: PgBoss.Job<TData>) => boolean;
}): PgBoss.WorkHandler<TData> {
  return async (jobs: PgBoss.Job<TData>[]) => {
    for (const job of jobs) {
      if (spec.skipWhen?.(job)) continue;
      await runJob(spec.name, job, async () => {
        const result = await spec.run(job);
        if (spec.summary) {
          const { event, msg, ...fields } = spec.summary(result);
          log.info({ event, ...fields }, msg);
        }
        return result;
      });
    }
  };
}

// `PgBoss.WorkHandler<T>` is invariant in `T`, so a table of mixed
// per-job-data shapes can't tighten the storage type beyond `any` — we
// rely on the per-entry `defineJobHandler` call to keep `run`/`summary`
// type-safe inside each entry.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWorkHandler = PgBoss.WorkHandler<any>;

type JobEntry = {
  name: string;
  queueOptions: QueueOptions;
  handler: AnyWorkHandler;
  // Cron expression, evaluated in America/New_York. Omit for queues
  // that are only enqueued on demand (the per-id ingest queues,
  // setlist-corpus-fill, song-index-rebuild).
  schedule?: string;
};

const JOBS_TABLE: JobEntry[] = [
  // Drop past-dated announcements before the orphan sweep so the
  // orphan-prune sees a freshly-pruned set (a past announcement whose
  // performer is followed would otherwise be "preserved" forever).
  {
    name: JOBS.PRUNE_PAST_ANNOUNCEMENTS,
    queueOptions: LONG_BATCH_CRON,
    schedule: '0 2 * * *',
    handler: defineJobHandler({
      name: JOBS.PRUNE_PAST_ANNOUNCEMENTS,
      run: () => runPrunePastAnnouncements(),
      summary: (r) => ({
        event: 'prune.past_announcements.summary',
        msg: 'Past announcements prune complete',
        announcements: r.announcements,
      }),
    }),
  },
  // Backstop sweep for the orphan-cleanup triggers (0002 / 0014 / 0023 /
  // 0025). Runs before shows-nightly so the nightly transition operates
  // on the freshly pruned catalog.
  {
    name: JOBS.PRUNE_ORPHAN_CATALOG,
    queueOptions: LONG_BATCH_CRON,
    schedule: '30 2 * * *',
    handler: defineJobHandler({
      name: JOBS.PRUNE_ORPHAN_CATALOG,
      run: () => runPruneOrphanCatalog(),
      summary: (r) => ({
        event: 'prune.summary',
        msg: 'Orphan catalog prune complete',
        announcements: r.announcements,
        venues: r.venues,
        performers: r.performers,
      }),
    }),
  },
  // Phase 11 §15m — album-metadata-fill at 02:30 ET nightly, before the
  // 04:45 ET corpus-fill refresh so album-drop synthetic rows reference
  // fresh `albums.fetched_at` signatures.
  {
    name: JOBS.ALBUM_METADATA_FILL,
    queueOptions: LONG_BATCH_CRON,
    schedule: '30 2 * * *',
    handler: defineJobHandler({
      name: JOBS.ALBUM_METADATA_FILL,
      run: () => runAlbumMetadataFill(),
      summary: (r) => ({
        event: 'album_metadata_fill.summary',
        msg: 'album-metadata-fill complete',
        attempted: r.attempted,
        performersUpdated: r.performersUpdated,
        albumsUpserted: r.albumsUpserted,
        failed: r.failed,
      }),
    }),
  },
  // Prediction-eval back-test at 03:00 ET. Runs against `tour_setlists`
  // already on disk (no external API calls); the corpus-fill refresh at
  // 04:45 ET later that morning brings fresh setlists in for *tomorrow's*
  // back-test. Phase 4 ships this in shadow mode — no release gate yet.
  {
    name: JOBS.EVAL_RUN_DAILY_BACKTEST,
    queueOptions: LONG_BATCH_CRON,
    schedule: '0 3 * * *',
    handler: defineJobHandler({
      name: JOBS.EVAL_RUN_DAILY_BACKTEST,
      run: () => runDailyBacktest({}),
      summary: (r) => ({
        event: 'eval.run.summary',
        msg: 'Prediction-eval back-test complete',
        runId: r.runId,
        windowDays: r.windowDays,
        evaluatedShows: r.evaluatedShows,
        predictionCount: r.predictionCount,
        brierScore: r.brierScore,
        precisionTop10: r.precisionTop10,
        recallTop15: r.recallTop15,
        calibrationError: r.calibrationError,
      }),
    }),
  },
  {
    name: JOBS.SHOWS_NIGHTLY,
    queueOptions: LONG_BATCH_CRON,
    schedule: '0 3 * * *',
    handler: defineJobHandler({
      name: JOBS.SHOWS_NIGHTLY,
      run: () => runShowsNightly(),
      summary: (r) => ({
        event: 'shows.nightly.summary',
        msg: 'Shows nightly complete',
        transitioned: r.transitioned,
        queued: r.queued,
        catchupQueued: r.catchupQueued,
        deleted: r.deleted,
      }),
    }),
  },
  // Setlist-style refresh at 03:30 ET — runs after the eval back-test
  // (which only consumes the *current* stored styles) and before the
  // corpus-fill refresh (which doesn't depend on styles). Three-runs-
  // to-disagree on seed entries; auto-applies on first run for new
  // performers.
  {
    name: JOBS.SETLIST_STYLE_REFRESH,
    queueOptions: LONG_BATCH_CRON,
    schedule: '30 3 * * *',
    handler: defineJobHandler({
      name: JOBS.SETLIST_STYLE_REFRESH,
      run: () => runSetlistStyleRefresh(),
    }),
  },
  {
    name: JOBS.SETLIST_RETRY,
    queueOptions: LONG_BATCH_CRON,
    schedule: '0 4 * * *',
    handler: defineJobHandler({
      name: JOBS.SETLIST_RETRY,
      run: () => runSetlistRetry(),
      summary: (r) => ({
        event: 'setlist.retry.summary',
        msg: 'Setlist retry complete',
        processed: r.processed,
        enriched: r.enriched,
        failed: r.failed,
        givenUp: r.givenUp,
      }),
    }),
  },
  // MBID backfill at 04:30 ET — between setlist-retry (04:00) and the
  // corpus-fill refresh (04:45) so freshly-resolved MBIDs are visible to
  // the same morning's corpus-fill pass. Closes the gap for Gmail /
  // manual-entry performers whose `musicbrainz_id IS NULL` because the
  // LLM extractor never had one to supply.
  {
    name: JOBS.BACKFILL_PERFORMER_MBIDS,
    queueOptions: LONG_BATCH_CRON,
    schedule: '30 4 * * *',
    handler: defineJobHandler({
      name: JOBS.BACKFILL_PERFORMER_MBIDS,
      run: () => runBackfillPerformerMbids(),
      summary: (r) => ({
        event: 'backfill.performer_mbids.summary',
        msg: 'Performer MBID backfill complete',
        total: r.total,
        updated: r.updated,
        missing: r.missing,
        skipped: r.skipped,
        failed: r.failed,
      }),
    }),
  },
  // Daily corpus refresh at 04:45 ET — late enough that the prior
  // night's setlists are likely on setlist.fm, early enough to be done
  // before the 05:30 backfill jobs need stable performer rows.
  {
    name: JOBS.SETLIST_CORPUS_FILL_REFRESH,
    queueOptions: LONG_BATCH_CRON,
    schedule: '45 4 * * *',
    handler: defineJobHandler({
      name: JOBS.SETLIST_CORPUS_FILL_REFRESH,
      run: async () => {
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
        return { processed, failed, total: queue.length };
      },
      summary: (r) => ({
        event: 'setlist.corpus_fill.refresh.summary',
        msg: 'corpus-fill daily refresh complete',
        processed: r.processed,
        failed: r.failed,
        total: r.total,
      }),
    }),
  },
  // Backfills run after setlist-retry so any MBIDs persisted on the setlist
  // pass are available when we look up TM attractions by name.
  {
    name: JOBS.BACKFILL_PERFORMER_IMAGES,
    queueOptions: LONG_BATCH_CRON,
    schedule: '30 5 * * *',
    handler: defineJobHandler({
      name: JOBS.BACKFILL_PERFORMER_IMAGES,
      run: () => runBackfillPerformerImages(),
      summary: (r) => ({
        event: 'backfill.performer_images.summary',
        msg: 'Performer image backfill complete',
        total: r.total,
        updated: r.updated,
        missing: r.missing,
        skipped: r.skipped,
        failed: r.failed,
      }),
    }),
  },
  {
    name: JOBS.BACKFILL_VENUE_PHOTOS,
    queueOptions: LONG_BATCH_CRON,
    schedule: '45 5 * * *',
    handler: defineJobHandler({
      name: JOBS.BACKFILL_VENUE_PHOTOS,
      run: () => runBackfillVenuePhotos(),
      summary: (r) => ({
        event: 'backfill.venue_photos.summary',
        msg: 'Venue photo backfill complete',
        total: r.total,
        updated: r.updated,
        missing: r.missing,
        failed: r.failed,
      }),
    }),
  },
  // Performer TM-id backfill at 06:00 ET — slotted between venue-photos
  // (05:45) and show-cover-images (06:15). Catches performers that
  // already have images (so the 05:30 image backfill skipped them) but
  // are still missing a TM attraction id.
  {
    name: JOBS.BACKFILL_PERFORMER_TICKETMASTER_IDS,
    queueOptions: LONG_BATCH_CRON,
    schedule: '0 6 * * *',
    handler: defineJobHandler({
      name: JOBS.BACKFILL_PERFORMER_TICKETMASTER_IDS,
      run: () => runBackfillPerformerTicketmasterIds(),
      summary: (r) => ({
        event: 'backfill.performer_ticketmaster_ids.summary',
        msg: 'Performer Ticketmaster ID backfill complete',
        total: r.total,
        updated: r.updated,
        missing: r.missing,
        skipped: r.skipped,
        failed: r.failed,
      }),
    }),
  },
  // Catches up Spotify catalog ids for any performer whose inline
  // fire-and-forget resolver (in matchOrCreatePerformer) failed or never
  // ran. Scheduled at 06:30 ET — after the TM-id backfill so any
  // TM-derived MBIDs are in place, before the morning digest at 08:00 ET.
  {
    name: JOBS.BACKFILL_PERFORMER_SPOTIFY_IDS,
    queueOptions: LONG_BATCH_CRON,
    schedule: '30 6 * * *',
    handler: defineJobHandler({
      name: JOBS.BACKFILL_PERFORMER_SPOTIFY_IDS,
      run: () => runBackfillPerformerSpotifyIds(),
      summary: (r) => ({
        event: 'backfill.performer_spotify_ids.summary',
        msg: 'Performer Spotify ID backfill complete',
        total: r.total,
        updated: r.updated,
        missing: r.missing,
        skipped: r.skipped,
        failed: r.failed,
      }),
    }),
  },
  {
    name: JOBS.BACKFILL_SHOW_COVER_IMAGES,
    queueOptions: LONG_BATCH_CRON,
    schedule: '15 6 * * *',
    handler: defineJobHandler({
      name: JOBS.BACKFILL_SHOW_COVER_IMAGES,
      run: () => runBackfillShowCoverImages(),
      summary: (r) => ({
        event: 'backfill.show_cover_images.summary',
        msg: 'Show cover image backfill complete',
        total: r.total,
        updated: r.updated,
        missing: r.missing,
        failed: r.failed,
      }),
    }),
  },
  // Slotted at 06:45 ET so it lands after backfill-show-cover-images
  // (06:15) but before the discover-ingest weekly cron (Mon 06:00 → so
  // most days the slot is empty). Fills `ticket_url` for future shows
  // that landed via Gmail / Eventbrite / setlist.fm imports and missed
  // the inline TM enrichment.
  {
    name: JOBS.BACKFILL_SHOW_TICKET_URLS,
    queueOptions: LONG_BATCH_CRON,
    schedule: '45 6 * * *',
    handler: defineJobHandler({
      name: JOBS.BACKFILL_SHOW_TICKET_URLS,
      run: () => runBackfillShowTicketUrls(),
      summary: (r) => ({
        event: 'backfill.show_ticket_urls.summary',
        msg: 'Show ticket URL backfill complete',
        total: r.total,
        updated: r.updated,
        missing: r.missing,
        failed: r.failed,
      }),
    }),
  },
  {
    name: JOBS.DISCOVER_INGEST,
    queueOptions: LONG_BATCH_CRON,
    schedule: '0 6 * * 1',
    handler: defineJobHandler({
      name: JOBS.DISCOVER_INGEST,
      run: async () => {
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
      },
    }),
  },
  // Health summary at 07:00 ET — runs after every overnight cron has had
  // a chance to complete (digest fires at 08:00) so missing summary
  // events are reliable signal, and lands one hour ahead of the digest
  // so the operator can intervene before users see the consequences.
  {
    name: JOBS.HEALTH_CHECK,
    queueOptions: LONG_BATCH_CRON,
    schedule: '0 7 * * *',
    handler: defineJobHandler({
      name: JOBS.HEALTH_CHECK,
      run: async () => {
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
      },
    }),
  },
  {
    name: JOBS.NOTIFICATIONS_DAILY_DIGEST,
    queueOptions: LONG_BATCH_CRON,
    schedule: '0 8 * * *',
    handler: defineJobHandler({
      name: JOBS.NOTIFICATIONS_DAILY_DIGEST,
      run: () => runDailyDigest(),
      summary: (r) => ({
        event: 'notifications.digest.summary',
        msg: 'Daily digest complete',
        sent: r.sent,
        skipped: r.skipped,
      }),
    }),
  },
  // Phase 7 — recently-played priming-stat sweep at 09:00 ET nightly,
  // settling each show's prep/post counts 6h post-show.
  {
    name: JOBS.SPOTIFY_RECENTLY_PLAYED,
    queueOptions: LONG_BATCH_CRON,
    schedule: '0 9 * * *',
    handler: defineJobHandler({
      name: JOBS.SPOTIFY_RECENTLY_PLAYED,
      run: () => runSpotifyRecentlyPlayed(),
      summary: (r) => ({
        event: 'spotify.recently_played.summary',
        msg: 'Recently-played sweep complete',
        attempted: r.attempted,
        matched: r.matched,
        noMatch: r.noMatch,
        failed: r.failed,
      }),
    }),
  },
  // Phase 7 — year-end soundtrack on Dec 31 at 03:00 ET. Idempotent
  // against the users.spotify_year_playlists map so re-runs overwrite
  // instead of creating duplicates.
  {
    name: JOBS.YEAR_END_SOUNDTRACK,
    queueOptions: LONG_BATCH_CRON,
    schedule: '0 3 31 12 *',
    handler: defineJobHandler({
      name: JOBS.YEAR_END_SOUNDTRACK,
      run: () => runYearEndSoundtrack(),
      summary: (r) => ({
        event: 'year_end_soundtrack.summary',
        msg: 'Year-end soundtrack sweep complete',
        attempted: r.attempted,
        built: r.built,
        reused: r.reused,
        skipped: r.skipped,
        failed: r.failed,
        year: r.year,
      }),
    }),
  },
  // Phase 11 §15l — every-3h tour-watch sweep. Per-performer dedup via
  // `last_watch_refresh_at` keeps the same performer from firing twice in
  // a calendar day even if the cron lands eight times.
  {
    name: JOBS.SETLIST_TOUR_WATCH,
    queueOptions: LONG_BATCH_CRON,
    schedule: '0 */3 * * *',
    handler: defineJobHandler({
      name: JOBS.SETLIST_TOUR_WATCH,
      run: () => runSetlistTourWatch(),
      summary: (r) => ({
        event: 'setlist.tour_watch.summary',
        msg: 'tour-watch sweep complete',
        attempted: r.attempted,
        refreshed: r.refreshed,
        skippedNoRun: r.skippedNoRun,
        skippedFresh: r.skippedFresh,
        failed: r.failed,
      }),
    }),
  },
  // SI-10 — purge revoked Spotify tokens older than 30 days. Weekly on
  // Sunday 02:00 ET, well clear of the morning digest window.
  {
    name: JOBS.SPOTIFY_PURGE_REVOKED_TOKENS,
    queueOptions: LONG_BATCH_CRON,
    schedule: '0 2 * * 0',
    handler: defineJobHandler({
      name: JOBS.SPOTIFY_PURGE_REVOKED_TOKENS,
      run: () => runSpotifyPurgeRevokedTokens(),
    }),
  },
  // User-triggered ingests — no schedule.
  {
    name: JOBS.DISCOVER_INGEST_VENUE,
    queueOptions: FAST_INGEST,
    handler: defineJobHandler<{ venueId: string }, { events: number }>({
      name: JOBS.DISCOVER_INGEST_VENUE,
      skipWhen: (job) => !job.data?.venueId,
      run: async (job) => {
        const { events } = await ingestVenue(job.data.venueId);
        return { events };
      },
      summary: (r) => ({
        event: 'discover.ingest.venue.complete',
        msg: 'Venue ingest complete',
        events: r.events,
      }),
    }),
  },
  {
    name: JOBS.DISCOVER_INGEST_PERFORMER,
    queueOptions: FAST_INGEST,
    handler: defineJobHandler<{ performerId: string }, { events: number }>({
      name: JOBS.DISCOVER_INGEST_PERFORMER,
      skipWhen: (job) => !job.data?.performerId,
      run: async (job) => {
        const { events } = await ingestPerformer(job.data.performerId);
        return { events };
      },
      summary: (r) => ({
        event: 'discover.ingest.performer.complete',
        msg: 'Performer ingest complete',
        events: r.events,
      }),
    }),
  },
  {
    name: JOBS.DISCOVER_INGEST_REGION,
    queueOptions: FAST_INGEST,
    handler: defineJobHandler<{ regionId: string }, { events: number }>({
      name: JOBS.DISCOVER_INGEST_REGION,
      skipWhen: (job) => !job.data?.regionId,
      run: async (job) => {
        const { events } = await ingestRegion(job.data.regionId);
        return { events };
      },
      summary: (r) => ({
        event: 'discover.ingest.region.complete',
        msg: 'Region ingest complete',
        events: r.events,
      }),
    }),
  },
  // Per-performer corpus fill is user-triggered (follow / show-detail
  // open) so fast turnaround matters and parallel runs across different
  // performers are expected. The daily refresh cron schedules through a
  // separate queue with the singleton cron profile.
  {
    name: JOBS.SETLIST_CORPUS_FILL,
    queueOptions: FAST_INGEST,
    handler: defineJobHandler<{ performerId: string; mode: CorpusFillMode }>({
      name: JOBS.SETLIST_CORPUS_FILL,
      skipWhen: (job) => !job.data?.performerId,
      run: async (job) => {
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
      },
    }),
  },
  // Song-index rebuild is invoked both as a cron and inline after a
  // corpus-fill. Keep 'standard' so the inline-chained rebuild can run
  // alongside ad-hoc admin rebuilds; the cron itself is rare and brief.
  {
    name: JOBS.SONG_INDEX_REBUILD,
    queueOptions: LONG_BATCH,
    handler: defineJobHandler<{
      performerId?: string;
      showIds?: string[];
      tourSetlistIds?: string[];
    }>({
      name: JOBS.SONG_INDEX_REBUILD,
      run: (job) => runSongIndexRebuild(job.data ?? {}),
    }),
  },
];

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

  for (const entry of JOBS_TABLE) {
    const opts = { name: entry.name, ...entry.queueOptions };
    await boss.createQueue(entry.name, opts);
    // create_queue is ON CONFLICT DO NOTHING, so existing queues keep
    // whatever options they were originally created with. Force-apply
    // the current options every boot.
    await boss.updateQueue(entry.name, opts);
  }

  for (const entry of JOBS_TABLE) {
    await boss.work(entry.name, entry.handler);
  }

  for (const entry of JOBS_TABLE) {
    if (entry.schedule) {
      await boss.schedule(entry.name, entry.schedule, {}, SCHEDULE_TZ);
    }
  }

  log.info(
    { event: 'pgboss.registered', jobs: Object.values(JOBS) },
    'All jobs registered and scheduled',
  );
}
