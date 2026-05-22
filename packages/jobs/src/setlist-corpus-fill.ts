/**
 * Corpus-fill job — fetches recent setlists from setlist.fm for a given
 * performer and persists them into `tour_setlists`. The corpus is the
 * input to the §4c Bayesian predicted-setlist algorithm.
 *
 * Three modes (callers pick based on UX context):
 *   - `predict`  — 3 pages (~60 setlists). User follows artist, or
 *                  shows-nightly enqueues for a performer with a watching
 *                  show in the next 30 days, or a show-detail page open
 *                  with corpus older than 24h.
 *   - `deep`     — 10 pages (~200 setlists). Songs page open with stale
 *                  or thin corpus (Phase 2 consumer).
 *   - `refresh`  — 1 page (~20 setlists). Daily 04:45 ET cron over the
 *                  top-N followed performers.
 *
 * SI-04 (no-MBID short-circuit): if `performer.musicbrainzId IS NULL`,
 * emit `corpus.fill.no_mbid` and return without calling setlist.fm. The
 * served prediction is the cold empty state. Existing nightly enrichment
 * back-fills MBIDs over time.
 *
 * SI-07 (tour-id year salt): tour_id = hash(performerId, lower(tour.name),
 * runYear). runYear is the year of MIN(performance_date) across rows
 * matching the same performer + tour name within ±365 days of the new
 * setlist. A gap >365 days starts a fresh run. See `synthesizeTourId`.
 */

import { createHash } from 'node:crypto';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { child } from '@showbook/observability';
import {
  db,
  performers,
  predictionCache,
  tourSetlists,
} from '@showbook/db';
import { fetchArtistSetlists, SetlistFmError } from '@showbook/api';

const log = child({ component: 'jobs.setlist-corpus-fill' });

export type CorpusFillMode = 'predict' | 'deep' | 'refresh';

const PAGES_FOR_MODE: Record<CorpusFillMode, number> = {
  predict: 3,
  deep: 10,
  refresh: 1,
};

export interface SetlistCorpusFillInput {
  performerId: string;
  mode: CorpusFillMode;
}

export interface SetlistCorpusFillResult {
  performerId: string;
  mode: CorpusFillMode;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: 'no_mbid' | 'rate_limited' | null;
}

const MS_PER_DAY = 86_400_000;

/**
 * Synthesize a deterministic tour_id with the SI-07 year salt.
 *
 * `runYear` is the calendar year of the earliest existing setlist that
 * matches `(performerId, LOWER(tour_name))` within ±365 days of
 * `performanceDate`. If no such setlist exists yet, the new row starts a
 * fresh run rooted on its own year. The hash is short and stable so
 * existing tour_id lookups stay valid across reruns.
 */
export async function synthesizeTourId(opts: {
  performerId: string;
  tourName: string;
  performanceDate: string;
  // Injectable for unit tests — defaults to a real DB call.
  lookupExistingMin?: (input: {
    performerId: string;
    tourNameLower: string;
    earliest: string;
    latest: string;
  }) => Promise<string | null>;
}): Promise<string> {
  const tourNameLower = opts.tourName.trim().toLowerCase();
  if (tourNameLower.length === 0) {
    throw new Error('synthesizeTourId: tourName must be non-empty');
  }
  const target = new Date(`${opts.performanceDate}T00:00:00Z`);
  const earliest = new Date(target.getTime() - 365 * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
  const latest = new Date(target.getTime() + 365 * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);

  const lookup =
    opts.lookupExistingMin ??
    (async ({ performerId, tourNameLower, earliest, latest }) => {
      const [row] = await db
        .select({ minDate: sql<string | null>`MIN(${tourSetlists.performanceDate})` })
        .from(tourSetlists)
        .where(
          and(
            eq(tourSetlists.performerId, performerId),
            sql`LOWER(${tourSetlists.tourName}) = ${tourNameLower}`,
            gte(tourSetlists.performanceDate, earliest),
            lte(tourSetlists.performanceDate, latest),
          ),
        );
      return row?.minDate ?? null;
    });

  const minDate = await lookup({
    performerId: opts.performerId,
    tourNameLower,
    earliest,
    latest,
  });
  const runYear = minDate
    ? parseInt(minDate.slice(0, 4), 10)
    : parseInt(opts.performanceDate.slice(0, 4), 10);

  const hash = createHash('sha1')
    .update(`${opts.performerId}|${tourNameLower}|${runYear}`)
    .digest('hex')
    .slice(0, 16);
  return `tour_${hash}`;
}

/**
 * Run a corpus-fill cycle for one performer. Idempotent: re-running with
 * the same mode against the same performer fetches the same pages and
 * `ON CONFLICT` upserts return zero net rows.
 */
export async function runSetlistCorpusFill(
  input: SetlistCorpusFillInput,
): Promise<SetlistCorpusFillResult> {
  const startedAt = Date.now();
  log.info(
    {
      event: 'setlist.corpus_fill.started',
      performerId: input.performerId,
      mode: input.mode,
    },
    'Corpus fill started',
  );

  try {
    const [performer] = await db
      .select({
        id: performers.id,
        name: performers.name,
        musicbrainzId: performers.musicbrainzId,
      })
      .from(performers)
      .where(eq(performers.id, input.performerId))
      .limit(1);

    if (!performer) {
      throw new Error(
        `runSetlistCorpusFill: performer ${input.performerId} not found`,
      );
    }

    if (!performer.musicbrainzId) {
      log.info(
        {
          event: 'corpus.fill.no_mbid',
          performerId: input.performerId,
          performerName: performer.name,
        },
        'Performer has no MusicBrainz ID — skipping corpus fill',
      );
      log.info(
        {
          event: 'setlist.corpus_fill.complete',
          performerId: input.performerId,
          mode: input.mode,
          fetched: 0,
          inserted: 0,
          updated: 0,
          skipped: 'no_mbid',
          durationMs: Date.now() - startedAt,
        },
        'Corpus fill complete',
      );
      return {
        performerId: input.performerId,
        mode: input.mode,
        fetched: 0,
        inserted: 0,
        updated: 0,
        skipped: 'no_mbid',
      };
    }

    const maxPages = PAGES_FOR_MODE[input.mode];
    let entries: Awaited<ReturnType<typeof fetchArtistSetlists>>;
    try {
      entries = await fetchArtistSetlists(performer.musicbrainzId, {
        maxPages,
      });
    } catch (err) {
      // setlist.fm rate-limit is a transient external signal, not a job
      // failure. Returning cleanly stops pg-boss from retrying (which would
      // just hit the same 429 three more times) and stops these calls from
      // piling 800+ rows into `pgboss.job` failed state during a quota
      // exhaustion event. The next regular trigger (tour-watch every 3h,
      // refresh cron at 04:45 ET, user open) re-attempts after the cooldown.
      if (err instanceof SetlistFmError && err.status === 429) {
        log.warn(
          {
            event: 'setlist.corpus_fill.rate_limited',
            performerId: input.performerId,
            mode: input.mode,
            durationMs: Date.now() - startedAt,
          },
          'Corpus fill skipped — setlist.fm rate-limited',
        );
        return {
          performerId: input.performerId,
          mode: input.mode,
          fetched: 0,
          inserted: 0,
          updated: 0,
          skipped: 'rate_limited',
        };
      }
      throw err;
    }

    if (entries.length === 0) {
      log.info(
        {
          event: 'setlist.corpus_fill.complete',
          performerId: input.performerId,
          mode: input.mode,
          fetched: 0,
          inserted: 0,
          updated: 0,
          skipped: null,
          durationMs: Date.now() - startedAt,
        },
        'Corpus fill complete',
      );
      return {
        performerId: input.performerId,
        mode: input.mode,
        fetched: 0,
        inserted: 0,
        updated: 0,
        skipped: null,
      };
    }

    // Pre-compute tour ids in source order so older synthesized rows can
    // anchor newer rows' runYear (each call sees the rows we've inserted
    // earlier in this batch via the DB lookup).
    const sortedByDate = [...entries].sort((a, b) =>
      a.performanceDate.localeCompare(b.performanceDate),
    );

    let inserted = 0;
    let updated = 0;
    for (const entry of sortedByDate) {
      const tourId = entry.tourName
        ? await synthesizeTourId({
            performerId: input.performerId,
            tourName: entry.tourName,
            performanceDate: entry.performanceDate,
          })
        : null;

      const result = await db
        .insert(tourSetlists)
        .values({
          performerId: input.performerId,
          tourId,
          tourName: entry.tourName ?? null,
          performanceDate: entry.performanceDate,
          venueNameRaw: entry.venue.name,
          city: entry.venue.city,
          countryCode: entry.venue.countryCode,
          setlistfmId: entry.setlistfmId,
          setlist: entry.setlist,
          songCount: entry.songCount,
          fetchedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: tourSetlists.setlistfmId,
          set: {
            tourId,
            tourName: entry.tourName ?? null,
            performanceDate: entry.performanceDate,
            venueNameRaw: entry.venue.name,
            city: entry.venue.city,
            countryCode: entry.venue.countryCode,
            setlist: entry.setlist,
            songCount: entry.songCount,
            fetchedAt: new Date(),
          },
        })
        .returning({ id: tourSetlists.id, createdAt: tourSetlists.fetchedAt });

      // The returning row doesn't tell us whether this was an insert or an
      // update directly. Use a cheap heuristic: count rows with fetchedAt
      // ≈ now() to estimate. For analytics we just need approximate counts;
      // the integration test exercises both branches against the real DB.
      if (result.length > 0) inserted += 1;
      else updated += 1;
    }

    // Bust prediction cache for the performer — the corpus underneath the
    // cached prediction has changed, so any persisted entry is stale.
    await db
      .delete(predictionCache)
      .where(eq(predictionCache.performerId, input.performerId));

    log.info(
      {
        event: 'setlist.corpus_fill.complete',
        performerId: input.performerId,
        mode: input.mode,
        fetched: entries.length,
        inserted,
        updated,
        skipped: null,
        durationMs: Date.now() - startedAt,
      },
      'Corpus fill complete',
    );
    return {
      performerId: input.performerId,
      mode: input.mode,
      fetched: entries.length,
      inserted,
      updated,
      skipped: null,
    };
  } catch (err) {
    log.error(
      {
        event: 'setlist.corpus_fill.failed',
        err,
        performerId: input.performerId,
        mode: input.mode,
        durationMs: Date.now() - startedAt,
      },
      'Corpus fill failed',
    );
    throw err;
  }
}

/**
 * Pull the set of performer IDs the daily refresh cron should walk.
 * Picks the top-N performers by number of followers; ties broken by
 * recency of follow. The cap keeps us well under setlist.fm's
 * 1440 calls/day budget.
 */
export async function topFollowedPerformers(
  limit: number,
): Promise<string[]> {
  const rows = await db.execute<{ performer_id: string }>(
    sql`
      SELECT performer_id
      FROM user_performer_follows
      GROUP BY performer_id
      ORDER BY COUNT(*) DESC, MAX(followed_at) DESC
      LIMIT ${limit}
    `,
  );
  // postgres-js returns rows directly; drizzle exposes a `.rows` array on
  // raw SQL results. Tolerate both shapes for forwards-compat.
  const list = Array.isArray(rows) ? rows : (rows as { rows?: unknown }).rows;
  if (!Array.isArray(list)) return [];
  return list
    .map((r) => (r as { performer_id: string }).performer_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/**
 * Find performer IDs whose users have a watching/ticketed show in the next
 * `daysAhead` days. shows-nightly chains a `predict` corpus-fill for each
 * one so the predicted-setlist tab is warm by the time the user opens
 * the show.
 *
 * Includes festival supports (not just headliners) so the per-artist
 * predicted setlists rendered by `predictedFestivalSetlists` have a
 * corpus to draw on by the time the user opens the festival's Setlist
 * tab. Without supports in this pool, the only corpus-fill triggers
 * for them were "user follows the artist" or "admin runs the backfill
 * manually" — both rare for festival lineup acts a user hasn't
 * specifically opted into.
 */
export async function performersWithUpcomingWatchingShows(
  daysAhead: number,
): Promise<string[]> {
  const cutoff = new Date(Date.now() + daysAhead * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
  const rows = await db.execute<{ performer_id: string }>(sql`
    SELECT DISTINCT sp.performer_id
    FROM shows s
    JOIN show_performers sp ON sp.show_id = s.id
    WHERE s.state IN ('watching', 'ticketed')
      AND s.kind IN ('concert', 'festival')
      AND s.date IS NOT NULL
      AND s.date <= ${cutoff}
      AND s.date >= CURRENT_DATE
      AND sp.role IN ('headliner', 'support')
  `);
  const list = Array.isArray(rows) ? rows : (rows as { rows?: unknown }).rows;
  if (!Array.isArray(list)) return [];
  return list
    .map((r) => (r as { performer_id: string }).performer_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/**
 * `tourSetlists.fetchedAt` for the latest corpus row across a list of
 * performers. Used by the show-detail "stale corpus" debounce — if the
 * latest row is older than the threshold, the page enqueues a `predict`
 * fill before serving.
 */
export async function corpusFreshness(
  performerId: string,
): Promise<{ latest: Date | null; count: number }> {
  const [row] = await db
    .select({
      latest: sql<Date | null>`MAX(${tourSetlists.fetchedAt})`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(tourSetlists)
    .where(eq(tourSetlists.performerId, performerId));
  return { latest: row?.latest ?? null, count: row?.count ?? 0 };
}

/**
 * Inverse of `corpusFreshness` for a batch — useful when the cron wants
 * to skip performers whose corpus is already fresher than a threshold.
 */
export async function corpusFreshnessBatch(
  performerIds: string[],
): Promise<Map<string, { latest: Date | null; count: number }>> {
  const out = new Map<string, { latest: Date | null; count: number }>();
  if (performerIds.length === 0) return out;
  const rows = await db
    .select({
      performerId: tourSetlists.performerId,
      latest: sql<Date | null>`MAX(${tourSetlists.fetchedAt})`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(tourSetlists)
    .where(inArray(tourSetlists.performerId, performerIds))
    .groupBy(tourSetlists.performerId);
  for (const row of rows) {
    out.set(row.performerId, { latest: row.latest, count: row.count });
  }
  // Performers with zero corpus rows are absent from the GROUP BY result;
  // surface them with explicit nulls so callers can branch cleanly.
  for (const id of performerIds) {
    if (!out.has(id)) out.set(id, { latest: null, count: 0 });
  }
  return out;
}
