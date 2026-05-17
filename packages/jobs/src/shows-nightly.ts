import { db } from '@showbook/db';
import { shows, showPerformers, enrichmentQueue } from '@showbook/db';
import { and, eq, isNull, lt, sql, inArray } from 'drizzle-orm';
import {
  type PerformerSetlistsMap,
  normalizePerformerSetlist,
  setlistTotalSongs,
} from '@showbook/shared';

function hasSetlist(setlists: PerformerSetlistsMap | null | undefined): boolean {
  if (!setlists) return false;
  // Tolerate the legacy `Record<performerId, string[]>` shape that may still
  // be present on un-migrated rows: normalize each value before counting.
  for (const raw of Object.values(setlists)) {
    const normalized = normalizePerformerSetlist(raw);
    if (normalized && setlistTotalSongs(normalized) > 0) return true;
  }
  return false;
}

/**
 * Lineup performers for a set of shows whose role is part of the setlist-
 * eligible cohort (everything except theatre cast members). Festival
 * lineups land here in full so each artist enqueues independently.
 */
async function lineupPerformersForShows(
  showIds: string[],
): Promise<Array<{ showId: string; performerId: string }>> {
  if (showIds.length === 0) return [];
  return db
    .select({
      showId: showPerformers.showId,
      performerId: showPerformers.performerId,
    })
    .from(showPerformers)
    .where(
      and(
        inArray(showPerformers.showId, showIds),
        inArray(showPerformers.role, ['headliner', 'support']),
      ),
    );
}

export async function runShowsNightly(): Promise<{
  transitioned: number;
  queued: number;
  catchupQueued: number;
  deleted: number;
}> {
  // 1. Transition ticketed → past where date < today
  const transitioned = await db
    .update(shows)
    .set({ state: 'past', updatedAt: new Date() })
    .where(and(eq(shows.state, 'ticketed'), lt(shows.date, sql`CURRENT_DATE`)))
    .returning();

  // 2. Queue setlist enrichment for newly-past shows missing setlists.
  // `setlists` (jsonb keyed by performerId) is the canonical column; the legacy
  // `setlist` text[] is no longer written by enrichment, so checking it here
  // would re-queue every past concert forever.
  //
  // Festivals participate here too — each lineup performer enqueues
  // separately so the setlist-retry job can give each artist an
  // independent 14-attempt budget. Theatre has no setlists.
  const showsNeedingSetlist = transitioned.filter(
    (s) =>
      (s.kind === 'concert' || s.kind === 'festival') && !hasSetlist(s.setlists),
  );

  let queued = 0;
  if (showsNeedingSetlist.length > 0) {
    const showIds = showsNeedingSetlist.map((s) => s.id);
    const lineup = await lineupPerformersForShows(showIds);
    if (lineup.length > 0) {
      // ON CONFLICT DO NOTHING leans on the
      // enrichment_queue_show_performer_type_uq unique index so a
      // previous run that already queued a subset is idempotent.
      const inserted = await db
        .insert(enrichmentQueue)
        .values(
          lineup.map((row) => ({
            showId: row.showId,
            performerId: row.performerId,
            type: 'setlist' as const,
            attempts: 0,
            maxAttempts: 14,
            nextRetry: new Date(),
          })),
        )
        .onConflictDoNothing()
        .returning({ id: enrichmentQueue.id });
      queued = inserted.length;
    }
  }

  // 3. Catch-up pass for past shows that bypassed the
  // ticketed→past transition above. Gmail imports, manual entry of "I went
  // to this show last week", and any other path that creates a show
  // directly in `past` state never trigger the transition queue logic, so
  // their setlists were never fetched. Pick those up here.
  //
  // `setlists IS NULL` is deliberate (vs. `!hasSetlist`):
  //   - null         → never been processed by setlist-retry, eligible
  //   - {}           → setlist-retry exhausted retries (see give-up path),
  //                    don't re-queue
  //   - { perfId:.. }→ at least one performer's setlist is populated;
  //                    any remaining missing performers are handled by
  //                    the LEFT JOIN below
  //
  // Find every (show, performer) pair that needs a queue row in one
  // shot: show is past with a date, performer is on the lineup
  // (headliner|support), no existing queue row for that pair, and the
  // performer is not already present in `setlists`. The `setlists ?
  // performer_id::text` check lets a festival that already enriched
  // some artists still pick up the rest on the next pass.
  const catchupRows = await db.execute<{
    show_id: string;
    performer_id: string;
  }>(sql`
    SELECT s.id AS show_id, sp.performer_id
    FROM shows s
    JOIN show_performers sp ON sp.show_id = s.id
    LEFT JOIN enrichment_queue eq
      ON eq.show_id = sp.show_id
      AND eq.performer_id = sp.performer_id
      AND eq.type = 'setlist'
    WHERE s.state = 'past'
      AND s.kind IN ('concert', 'festival')
      AND s.date IS NOT NULL
      AND sp.role IN ('headliner', 'support')
      AND eq.id IS NULL
      AND (
        s.setlists IS NULL
        OR (
          s.setlists != '{}'::jsonb
          AND NOT (s.setlists ? sp.performer_id::text)
        )
      )
  `);

  let catchupQueued = 0;
  if (catchupRows.length > 0) {
    const inserted = await db
      .insert(enrichmentQueue)
      .values(
        catchupRows.map((row) => ({
          showId: row.show_id,
          performerId: row.performer_id,
          type: 'setlist' as const,
          attempts: 0,
          maxAttempts: 14,
          nextRetry: new Date(),
        })),
      )
      .onConflictDoNothing()
      .returning({ id: enrichmentQueue.id });
    catchupQueued = inserted.length;
  }

  // 4. Delete expired watching shows
  const watchingToDelete = await db
    .select({ id: shows.id })
    .from(shows)
    .where(and(eq(shows.state, 'watching'), lt(shows.date, sql`CURRENT_DATE`)));

  let deleted = 0;

  if (watchingToDelete.length > 0) {
    const ids = watchingToDelete.map((s) => s.id);

    const deletedRows = await db
      .delete(shows)
      .where(inArray(shows.id, ids))
      .returning({ id: shows.id });

    deleted = deletedRows.length;
  }

  return {
    transitioned: transitioned.length,
    queued,
    catchupQueued,
    deleted,
  };
}
