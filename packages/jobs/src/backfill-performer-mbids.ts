// `load-env-local` is a no-op when no .env.local is present (the prod
// container case), so it's safe to import unconditionally even when this
// module is loaded from the registry inside Next.js. Local CLI invocations
// still get their .env.local merged.
import './load-env-local';

import { db, performers } from '@showbook/db';
import { and, eq, isNull } from 'drizzle-orm';
import { searchArtist, isUniqueViolation } from '@showbook/api';
import { child, flushObservability } from '@showbook/observability';

const log = child({ component: 'jobs.backfill-performer-mbids' });

export interface BackfillPerformerMbidsSummary {
  total: number;
  updated: number;
  missing: number;
  skipped: number;
  failed: number;
}

/**
 * Backfill `performers.musicbrainz_id` for rows that don't yet have one.
 *
 * The Gmail / manual-entry import paths can't supply an MBID at
 * creation time — the LLM extractor and free-text parser only have a
 * name to work with. The inline setlist-lookup in `shows.create`
 * persists an MBID as a side-effect, but only for past concerts. This
 * cron closes the gap for future / watching concerts so the
 * setlist-intel tab (and the corpus-fill cron at 04:45) can do useful
 * work the morning after a user adds a show.
 *
 * Strategy: for every performer with `musicbrainz_id IS NULL`, call
 * setlist.fm's `/search/artists` and pick the first match it has linked
 * to MusicBrainz. setlist.fm filters out entries with no mbid in
 * `searchArtist`, so any result is safe to write.
 *
 * Rate-limited by `setlistfm.ts`'s built-in 500ms `MIN_REQUEST_INTERVAL_MS`.
 * The free setlist.fm tier is ~1440 calls/day; corpus-fill refresh at
 * 04:45 ET typically eats 100-500/morning, so this job has headroom.
 *
 * Scheduled at 04:30 ET — between `setlist-retry` (04:00) and
 * `setlist-corpus-fill-refresh` (04:45) so the corpus-fill cron can
 * pick up freshly-resolved MBIDs the same morning. Run via pg-boss
 * schedule or CLI:
 *   `pnpm --filter @showbook/jobs exec tsx src/backfill-performer-mbids.ts`
 */
export async function runBackfillPerformerMbids(): Promise<BackfillPerformerMbidsSummary> {
  const rows = await db
    .select({
      id: performers.id,
      name: performers.name,
    })
    .from(performers)
    .where(isNull(performers.musicbrainzId));

  let updated = 0;
  let missing = 0;
  let skipped = 0;
  let failed = 0;

  for (const performer of rows) {
    try {
      const artists = await searchArtist(performer.name);
      if (artists.length === 0) {
        missing++;
        log.info(
          {
            event: 'performer.mbid.no_match',
            performerId: performer.id,
            performerName: performer.name,
          },
          'No setlist.fm match for performer',
        );
        continue;
      }

      const mbid = artists[0]!.mbid;
      try {
        // Race guard: only write if the row's MBID is still null. The
        // SELECT above already filters, but the inline `shows.create`
        // MBID hop, manual operator action, or a concurrent
        // backfill-performer-images run can fill the column between
        // the SELECT and this UPDATE. `.returning` lets us tell the
        // race-loss case apart from a successful write.
        const result = await db
          .update(performers)
          .set({ musicbrainzId: mbid })
          .where(
            and(
              eq(performers.id, performer.id),
              isNull(performers.musicbrainzId),
            ),
          )
          .returning({ id: performers.id });
        if (result.length === 0) {
          skipped++;
          log.warn(
            {
              event: 'performer.mbid.conflict',
              performerId: performer.id,
              performerName: performer.name,
              mbid,
              reason: 'row_already_filled',
            },
            'MBID set by another writer between SELECT and UPDATE',
          );
          continue;
        }
        updated++;
        log.info(
          {
            event: 'performer.mbid.updated',
            performerId: performer.id,
            performerName: performer.name,
            mbid,
          },
          'Backfilled performer MBID via setlist.fm search',
        );
      } catch (err) {
        if (isUniqueViolation(err)) {
          // Another performer row already holds this MBID — duplicate-
          // performer cleanup is an operator merge, not a per-job task.
          // Log and move on so this performer keeps its null MBID
          // instead of erroring the whole batch.
          skipped++;
          log.warn(
            {
              event: 'performer.mbid.conflict',
              performerId: performer.id,
              performerName: performer.name,
              mbid,
              reason: 'other_row_owns_id',
            },
            'MBID already owned by another performer row — leaving this row null',
          );
        } else {
          throw err;
        }
      }
    } catch (err) {
      failed++;
      log.error(
        {
          err,
          event: 'performer.mbid.failed',
          performerId: performer.id,
          performerName: performer.name,
        },
        'MBID lookup failed',
      );
    }
  }

  log.info(
    {
      event: 'performer.mbid.done',
      total: rows.length,
      updated,
      missing,
      skipped,
      failed,
    },
    'Backfill complete',
  );

  return { total: rows.length, updated, missing, skipped, failed };
}

// CLI entry point: run only when invoked directly (e.g. `tsx
// src/backfill-performer-mbids.ts`), not when imported by the registry.
const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  runBackfillPerformerMbids()
    .then(async () => {
      await flushObservability();
      process.exit(0);
    })
    .catch(async (err) => {
      log.error({ err, event: 'performer.mbid.fatal' }, 'Backfill failed');
      await flushObservability();
      process.exit(1);
    });
}
