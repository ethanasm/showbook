/**
 * Phase 11 §15l — real-time corpus refresh during multi-night runs.
 *
 * Every 3 hours during a detected multi-night run, refresh the
 * performer's corpus so the night-2 prediction includes night-1's
 * setlist (and so on). Without this, the operator would wait until
 * the 04:45 ET nightly corpus-fill to see updated predictions.
 *
 * Triggers:
 *   1. Find performers with a `watching` show in [now, now+1d].
 *   2. For each, load their corpus + run `detectMultiNightRun` against
 *      the show's venue.
 *   3. If a run is detected AND the latest corpus row is >12h old AND
 *      `last_watch_refresh_at` is null-or-stale (>21h), enqueue
 *      `setlist-corpus-fill` in `predict` mode and update the
 *      performer's `last_watch_refresh_at`.
 *
 * Per-performer dedup (NOT per-user) protects the global setlist.fm
 * rate limit. 21h window prevents the every-3h cron from re-firing
 * within the same calendar day.
 *
 * Schedule: every 3 hours.
 */

import './load-env-local';

import { and, eq, gte, lte, sql } from 'drizzle-orm';
import {
  db,
  performers,
  showPerformers,
  shows,
  tourSetlists,
} from '@showbook/db';
import { detectMultiNightRun, loadCorpusForPrediction } from '@showbook/api';
import { child } from '@showbook/observability';
import { getBoss } from './boss';
import { JOBS } from './registry';

const log = child({ component: 'jobs.setlist-tour-watch' });

const STALE_CORPUS_HOURS = 12;
const DEDUP_HOURS = 21;

export interface TourWatchSummary {
  attempted: number;
  refreshed: number;
  skippedNoRun: number;
  skippedFresh: number;
  failed: number;
}

export async function runSetlistTourWatch(): Promise<TourWatchSummary> {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Headliner performers in any user's `watching` show tonight or
  // tomorrow. The detector and refresh logic are per-performer (not
  // per-user) since the corpus is shared and the rate limit is global.
  const watchingRows = await db
    .select({
      performerId: performers.id,
      lastWatchRefreshAt: performers.lastWatchRefreshAt,
      showId: shows.id,
      showDate: shows.date,
      venueId: shows.venueId,
    })
    .from(shows)
    .innerJoin(showPerformers, eq(showPerformers.showId, shows.id))
    .innerJoin(performers, eq(performers.id, showPerformers.performerId))
    .where(
      and(
        eq(shows.state, 'watching'),
        eq(showPerformers.role, 'headliner'),
        gte(shows.date, formatDate(now)),
        lte(shows.date, formatDate(tomorrow)),
      ),
    );

  let attempted = 0;
  let refreshed = 0;
  let skippedNoRun = 0;
  let skippedFresh = 0;
  let failed = 0;

  const boss = await getBoss();
  const seenPerformers = new Set<string>();

  for (const row of watchingRows) {
    if (!row.showDate) continue;
    if (seenPerformers.has(row.performerId)) continue;
    seenPerformers.add(row.performerId);
    attempted += 1;

    try {
      const dedupCutoff = new Date(now.getTime() - DEDUP_HOURS * 60 * 60 * 1000);
      if (row.lastWatchRefreshAt && row.lastWatchRefreshAt > dedupCutoff) {
        skippedFresh += 1;
        continue;
      }

      const venueName = await loadVenueName(row.venueId);
      if (!venueName) {
        skippedNoRun += 1;
        continue;
      }

      const { setlists } = await loadCorpusForPrediction({
        performerId: row.performerId,
        targetDate: row.showDate,
      });

      const run = detectMultiNightRun({
        targetDate: row.showDate,
        targetVenue: venueName,
        corpus: setlists,
      });
      if (!run || run.priorNights < 1) {
        skippedNoRun += 1;
        continue;
      }

      const [latestRow] = await db
        .select({ latest: sql<string | null>`MAX(${tourSetlists.performanceDate})` })
        .from(tourSetlists)
        .where(eq(tourSetlists.performerId, row.performerId));
      const latestPerf = latestRow?.latest;
      if (!latestPerf) {
        skippedNoRun += 1;
        continue;
      }
      const hoursSinceLastSetlist =
        (now.getTime() - new Date(latestPerf).getTime()) / (60 * 60 * 1000);
      if (hoursSinceLastSetlist <= STALE_CORPUS_HOURS) {
        skippedFresh += 1;
        continue;
      }

      await boss.send(JOBS.SETLIST_CORPUS_FILL, {
        performerId: row.performerId,
        mode: 'predict',
      });
      await db
        .update(performers)
        .set({ lastWatchRefreshAt: now })
        .where(eq(performers.id, row.performerId));

      refreshed += 1;
      log.info(
        {
          event: 'setlist.tour_watch.refreshed',
          performerId: row.performerId,
          runStartDate: run.runStartDate,
          hoursSinceLastSetlist: Math.round(hoursSinceLastSetlist),
        },
        'tour-watch corpus refresh enqueued',
      );
    } catch (err) {
      failed += 1;
      log.error(
        {
          event: 'setlist.tour_watch.failed',
          err,
          performerId: row.performerId,
        },
        'tour-watch iteration failed',
      );
    }
  }

  log.info(
    {
      event: 'setlist.tour_watch.summary',
      attempted,
      refreshed,
      skippedNoRun,
      skippedFresh,
      failed,
    },
    'tour-watch sweep complete',
  );
  return { attempted, refreshed, skippedNoRun, skippedFresh, failed };
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function loadVenueName(venueId: string | null): Promise<string | null> {
  if (!venueId) return null;
  const { venues } = await import('@showbook/db');
  const [row] = await db
    .select({ name: venues.name })
    .from(venues)
    .where(eq(venues.id, venueId))
    .limit(1);
  return row?.name ?? null;
}
