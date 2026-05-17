// `load-env-local` is a no-op when no .env.local is present (the prod
// container case), so it's safe to import unconditionally even when this
// module is loaded from the registry inside Next.js. Local CLI invocations
// still get their .env.local merged.
import './load-env-local';

import { db, performers } from '@showbook/db';
import { and, eq, isNull } from 'drizzle-orm';
import {
  searchAttractions,
  extractMusicbrainzId,
  isUniqueViolation,
} from '@showbook/api';
import { child, flushObservability } from '@showbook/observability';

const log = child({ component: 'jobs.backfill-performer-ticketmaster-ids' });
const WAIT_MS = 250; // TM allows ~5 req/sec on the discovery API

export interface BackfillPerformerTicketmasterIdsSummary {
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
 * Backfill `performers.ticketmaster_attraction_id` for rows that don't
 * yet have one. Calls TM Discovery's `/attractions` search per performer
 * and writes the first exact case-insensitive name match. If TM exposes
 * a MusicBrainz id via `externalLinks.musicbrainz` and the row's MBID
 * is null, that gets written too as a free side effect.
 *
 * Companion to `backfill-performer-mbids` (setlist.fm-based). The image
 * backfill also fills TM IDs as a side effect but only for performers
 * missing `image_url` — this job closes the gap for performers that
 * already have images.
 *
 * Safety invariants:
 *   - UPDATE WHERE includes `AND <col> IS NULL` so we never overwrite an
 *     id another writer set between SELECT and UPDATE.
 *   - `.set()` only includes fields we have non-null values for; no
 *     stray `NULL` writes.
 *   - MBID side-effect failures don't unwind the TM-id write.
 *
 * Scheduled at 06:00 ET — slots between `backfill-venue-photos`
 * (05:45) and `backfill-show-cover-images` (06:15). Also enqueue-able on
 * demand from the admin page. Run via pg-boss schedule or CLI:
 *   `pnpm --filter @showbook/jobs exec tsx src/backfill-performer-ticketmaster-ids.ts`
 */
export async function runBackfillPerformerTicketmasterIds(): Promise<BackfillPerformerTicketmasterIdsSummary> {
  const rows = await db
    .select({
      id: performers.id,
      name: performers.name,
      musicbrainzId: performers.musicbrainzId,
    })
    .from(performers)
    .where(isNull(performers.ticketmasterAttractionId));

  let updated = 0;
  let missing = 0;
  let skipped = 0;
  let failed = 0;

  for (const [index, performer] of rows.entries()) {
    if (index > 0) await sleep(WAIT_MS);

    try {
      const candidates = await searchAttractions(performer.name);
      const target = normalizeName(performer.name);
      const match = candidates.find((a) => normalizeName(a.name) === target);

      if (!match) {
        missing++;
        log.info(
          {
            event: 'performer.ticketmaster_id.no_match',
            performerId: performer.id,
            performerName: performer.name,
          },
          'No TM attraction match for performer',
        );
        continue;
      }

      try {
        const result = await db
          .update(performers)
          .set({ ticketmasterAttractionId: match.id })
          .where(
            and(
              eq(performers.id, performer.id),
              isNull(performers.ticketmasterAttractionId),
            ),
          )
          .returning({ id: performers.id });

        if (result.length === 0) {
          skipped++;
          log.warn(
            {
              event: 'performer.ticketmaster_id.conflict',
              performerId: performer.id,
              performerName: performer.name,
              tmId: match.id,
              reason: 'row_already_filled',
            },
            'TM ID set by another writer between SELECT and UPDATE',
          );
          continue;
        }

        updated++;
        log.info(
          {
            event: 'performer.ticketmaster_id.updated',
            performerId: performer.id,
            performerName: performer.name,
            tmId: match.id,
          },
          'Backfilled performer TM attraction id',
        );
      } catch (err) {
        if (isUniqueViolation(err)) {
          skipped++;
          log.warn(
            {
              event: 'performer.ticketmaster_id.conflict',
              performerId: performer.id,
              performerName: performer.name,
              tmId: match.id,
              reason: 'other_row_owns_id',
            },
            'TM ID already owned by another performer row — leaving this row null',
          );
          continue;
        }
        throw err;
      }

      // MBID side-effect: only when TM exposes one AND the row's MBID
      // is still null. Failures here must not unwind the TM-id write
      // that already counted as updated.
      const tmMbid = extractMusicbrainzId(match);
      if (tmMbid && performer.musicbrainzId == null) {
        try {
          await db
            .update(performers)
            .set({ musicbrainzId: tmMbid })
            .where(
              and(
                eq(performers.id, performer.id),
                isNull(performers.musicbrainzId),
              ),
            );
        } catch (err) {
          if (isUniqueViolation(err)) {
            log.warn(
              {
                event: 'performer.mbid.conflict',
                performerId: performer.id,
                performerName: performer.name,
                mbid: tmMbid,
                reason: 'other_row_owns_id',
              },
              'TM-derived MBID already owned by another performer row',
            );
          } else {
            log.error(
              {
                err,
                event: 'performer.mbid.failed',
                performerId: performer.id,
                performerName: performer.name,
                mbid: tmMbid,
              },
              'TM-derived MBID write failed (TM id write already succeeded)',
            );
          }
        }
      }
    } catch (err) {
      failed++;
      log.error(
        {
          err,
          event: 'performer.ticketmaster_id.failed',
          performerId: performer.id,
          performerName: performer.name,
        },
        'TM attraction lookup failed',
      );
    }
  }

  log.info(
    {
      event: 'performer.ticketmaster_id.done',
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
// src/backfill-performer-ticketmaster-ids.ts`), not when imported by
// the registry.
const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  runBackfillPerformerTicketmasterIds()
    .then(async () => {
      await flushObservability();
      process.exit(0);
    })
    .catch(async (err) => {
      log.error(
        { err, event: 'performer.ticketmaster_id.fatal' },
        'Backfill failed',
      );
      await flushObservability();
      process.exit(1);
    });
}
