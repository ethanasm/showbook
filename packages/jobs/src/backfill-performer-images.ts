// `load-env-local` is a no-op when no .env.local is present (the prod
// container case), so it's safe to import unconditionally even when this
// module is loaded from the registry inside Next.js. Local CLI invocations
// still get their .env.local merged.
import './load-env-local';

import { db, performers } from '@showbook/db';
import { eq, isNull, sql } from 'drizzle-orm';
import {
  searchAttractions,
  selectBestImage,
  getAttraction,
} from '@showbook/api';
import { child, flushObservability } from '@showbook/observability';

const log = child({ component: 'jobs.backfill-performer-images' });
const WAIT_MS = 250; // TM allows ~5 req/sec on the discovery API

export interface BackfillPerformerImagesSummary {
  total: number;
  updated: number;
  missing: number;
  skipped: number;
  failed: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Backfill `performers.image_url` for rows that don't yet have one.
 *
 * Strategy:
 *   1. If the row has a ticketmasterAttractionId, fetch the attraction
 *      directly and use selectBestImage. (Cheap, exact match.)
 *   2. Otherwise search TM attractions by name and pick the best
 *      case-insensitive name match. Skip if no exact match — we don't
 *      want to attach a wrong photo.
 *
 * Run via pg-boss schedule (daily 05:30 ET — see registry.ts) or as a CLI:
 * `pnpm --filter @showbook/jobs exec tsx src/backfill-performer-images.ts`
 */
export async function runBackfillPerformerImages(): Promise<BackfillPerformerImagesSummary> {
  const rows = await db
    .select({
      id: performers.id,
      name: performers.name,
      tmAttractionId: performers.ticketmasterAttractionId,
    })
    .from(performers)
    .where(isNull(performers.imageUrl));

  let updated = 0;
  let missing = 0;
  let skipped = 0;
  let failed = 0;

  for (const [index, performer] of rows.entries()) {
    if (index > 0) await sleep(WAIT_MS);

    try {
      let imageUrl: string | null = null;
      let tmIdToWrite: string | null = null;
      let musicbrainzIdToWrite: string | null = null;

      // Path 1: known TM attraction ID — fetch the attraction directly.
      if (performer.tmAttractionId) {
        const attraction = await getAttraction(performer.tmAttractionId);
        if (attraction) {
          imageUrl = selectBestImage(attraction.images);
          musicbrainzIdToWrite =
            attraction.externalLinks?.musicbrainz?.[0]?.id ?? null;
        }
      }

      // Path 2: search by name and pick an exact match.
      if (!imageUrl) {
        const candidates = await searchAttractions(performer.name);
        const target = normalizeName(performer.name);
        const match = candidates.find(
          (a) => normalizeName(a.name) === target,
        );

        if (match) {
          imageUrl = selectBestImage(match.images);
          tmIdToWrite = match.id;
          musicbrainzIdToWrite =
            match.externalLinks?.musicbrainz?.[0]?.id ?? null;
        }
      }

      if (!imageUrl) {
        missing++;
        log.info({ event: 'performer.image.no_match', performerId: performer.id, performerName: performer.name }, 'No TM match');
        continue;
      }

      const updates: Record<string, string> = { imageUrl };
      if (tmIdToWrite && !performer.tmAttractionId) {
        updates.ticketmasterAttractionId = tmIdToWrite;
      }
      if (musicbrainzIdToWrite) {
        // Conditional update via SQL — only set if currently null.
        // For simplicity, just include in the same set; matchOrCreatePerformer
        // handles conflicts on insert path. Here we're updating, so collisions
        // on the unique index (if any) would error. Keep it simple: we already
        // filtered on isNull(imageUrl), and many of these rows have no
        // musicbrainzId either. Wrap in try/catch to swallow rare conflicts.
        updates.musicbrainzId = musicbrainzIdToWrite;
      }

      try {
        await db
          .update(performers)
          .set(updates)
          .where(eq(performers.id, performer.id));
        updated++;
        log.info({ event: 'performer.image.updated', performerId: performer.id, performerName: performer.name }, 'Updated performer image');
      } catch (err) {
        // Likely a unique-constraint conflict on musicbrainzId — retry without
        // setting it.
        delete updates.musicbrainzId;
        await db
          .update(performers)
          .set(updates)
          .where(eq(performers.id, performer.id));
        updated++;
        log.warn({ err, event: 'performer.image.updated_image_only', performerId: performer.id, performerName: performer.name }, 'Updated image but skipped MBID write');
      }
    } catch (err) {
      failed++;
      log.error({ err, event: 'performer.image.failed', performerId: performer.id, performerName: performer.name }, 'Image lookup failed');
    }
  }

  // Performers can have duplicate rows for the same name (e.g. e2e seed
  // leakage). Once we know an image for a given name, propagate it to any
  // siblings. This is a no-op if no duplicates exist.
  await db.execute(sql`
    update performers p
    set image_url = src.image_url
    from (
      select distinct on (lower(name)) lower(name) as norm_name, image_url
      from performers
      where image_url is not null
      order by lower(name), created_at desc nulls last, name
    ) src
    where lower(p.name) = src.norm_name
      and p.image_url is null;
  `);

  log.info(
    { event: 'performer.image.done', total: rows.length, updated, missing, skipped, failed },
    'Backfill complete',
  );

  return { total: rows.length, updated, missing, skipped, failed };
}

// CLI entry point: run only when invoked directly (e.g. `tsx
// src/backfill-performer-images.ts`), not when imported by the registry.
const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  runBackfillPerformerImages()
    .then(async () => {
      await flushObservability();
      process.exit(0);
    })
    .catch(async (err) => {
      log.error({ err, event: 'performer.image.fatal' }, 'Backfill failed');
      await flushObservability();
      process.exit(1);
    });
}
