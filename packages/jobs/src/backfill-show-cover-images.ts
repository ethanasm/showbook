// `load-env-local` is a no-op when no .env.local is present (the prod
// container case), so it's safe to import unconditionally.
import './load-env-local';

import { db, shows, venues } from '@showbook/db';
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import {
  pickAttractionImage,
  searchAttractions,
  searchEvents,
  selectBestImage,
} from '@showbook/api';
import { child, flushObservability } from '@showbook/observability';

const log = child({ component: 'jobs.backfill-show-cover-images' });
const WAIT_MS = 250; // TM allows ~5 req/sec on the discovery API

export interface BackfillShowCoverImagesSummary {
  total: number;
  updated: number;
  missing: number;
  failed: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface CandidateRow {
  id: string;
  productionName: string | null;
  date: string | null;
  endDate: string | null;
  tmVenueId: string | null;
}

/**
 * Backfill `shows.cover_image_url` for production shows (theatre/festival)
 * that don't yet have one. Mirrors `backfill-performer-images` in shape.
 *
 * Strategy per show:
 *   1. If we have a venue+date, search TM events keyed by productionName,
 *      scoped to that venueId and date window. Use the first event's image.
 *   2. Otherwise (or as a fallback), search TM attractions by productionName
 *      and pick the best image off an exact (case-insensitive) name match.
 *
 * Run via pg-boss schedule (daily 06:00 ET — see registry.ts) or as a CLI:
 * `pnpm --filter @showbook/jobs exec tsx src/backfill-show-cover-images.ts`
 */
export async function runBackfillShowCoverImages(): Promise<BackfillShowCoverImagesSummary> {
  const rows: CandidateRow[] = await db
    .select({
      id: shows.id,
      productionName: shows.productionName,
      date: shows.date,
      endDate: shows.endDate,
      tmVenueId: venues.ticketmasterVenueId,
    })
    .from(shows)
    .leftJoin(venues, eq(shows.venueId, venues.id))
    .where(
      and(
        isNull(shows.coverImageUrl),
        or(eq(shows.kind, 'theatre'), eq(shows.kind, 'festival')),
        // productionName is what we'd search by — without it we have nothing.
        ne(sql`coalesce(${shows.productionName}, '')`, ''),
      ),
    );

  let updated = 0;
  let missing = 0;
  let failed = 0;

  // Cache lookups by productionName so multiple users with the same theatre
  // production share a single TM round-trip.
  const cache = new Map<string, string | null>();

  for (const [index, row] of rows.entries()) {
    if (!row.productionName) continue;
    if (index > 0) await sleep(WAIT_MS);

    const cacheKey = row.productionName.trim().toLowerCase();

    try {
      let imageUrl: string | null | undefined = cache.get(cacheKey);

      if (imageUrl === undefined) {
        imageUrl = null;

        // Path 1: event search scoped to venue+date
        if (row.date && row.tmVenueId) {
          try {
            const startDate = row.date;
            const endDate = row.endDate ?? row.date;
            const { events } = await searchEvents({
              keyword: row.productionName,
              venueId: row.tmVenueId,
              startDateTime: `${startDate}T00:00:00Z`,
              endDateTime: `${endDate}T23:59:59Z`,
              size: 1,
            });
            if (events[0]?.images) {
              imageUrl = selectBestImage(events[0].images);
            }
          } catch (err) {
            log.warn(
              { err, event: 'show.cover.event_search_failed', showId: row.id, productionName: row.productionName },
              'TM event search failed; will try attraction fallback',
            );
          }
        }

        // Path 2: attraction search. `pickAttractionImage` walks every
        // candidate that matches (exact-name first, then "<name> (...)"
        // variants) until it finds one with usable images. The earlier
        // `candidates.find` + single `selectBestImage` fell through when
        // TM returned a stale bare-name record with no art alongside a
        // suffixed record carrying the real poster — see the "Cabaret
        // at the Kit Kat Club" / "Cabaret at the Kit Kat Club (NY)"
        // case in 2026-05-21.
        if (!imageUrl) {
          const candidates = await searchAttractions(row.productionName);
          imageUrl = pickAttractionImage(candidates, row.productionName);
        }

        cache.set(cacheKey, imageUrl);
      }

      if (!imageUrl) {
        missing++;
        log.info(
          { event: 'show.cover.no_match', showId: row.id, productionName: row.productionName },
          'No TM match for production',
        );
        continue;
      }

      await db
        .update(shows)
        .set({ coverImageUrl: imageUrl })
        .where(eq(shows.id, row.id));
      updated++;
      log.info(
        { event: 'show.cover.updated', showId: row.id, productionName: row.productionName },
        'Updated show cover image',
      );
    } catch (err) {
      failed++;
      log.error(
        { err, event: 'show.cover.failed', showId: row.id, productionName: row.productionName },
        'Cover image lookup failed',
      );
    }
  }

  // Propagate any cover we found to sibling rows (same productionName) that
  // still have no cover — this catches shows added before this backfill ran
  // and avoids re-hitting TM for them.
  if (cache.size > 0) {
    const filledNames = [...cache.entries()]
      .filter(([, url]) => url !== null)
      .map(([name]) => name);
    if (filledNames.length > 0) {
      await db.execute(sql`
        update shows s
        set cover_image_url = src.cover_image_url
        from (
          select distinct on (lower(production_name))
            lower(production_name) as norm_name,
            cover_image_url
          from shows
          where cover_image_url is not null
            and production_name is not null
            and lower(production_name) = any(${filledNames})
          order by lower(production_name), updated_at desc nulls last
        ) src
        where s.cover_image_url is null
          and lower(s.production_name) = src.norm_name;
      `);
    }
  }

  log.info(
    { event: 'show.cover.done', total: rows.length, updated, missing, failed },
    'Backfill complete',
  );

  return { total: rows.length, updated, missing, failed };
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  runBackfillShowCoverImages()
    .then(async () => {
      await flushObservability();
      process.exit(0);
    })
    .catch(async (err) => {
      log.error({ err, event: 'show.cover.fatal' }, 'Backfill failed');
      await flushObservability();
      process.exit(1);
    });
}
