import { db } from '@showbook/db';
import { shows, showPerformers, enrichmentQueue } from '@showbook/db';
import { and, eq, isNull, lt, notInArray, sql, inArray } from 'drizzle-orm';
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

  // 2. Queue setlist enrichment for newly-past concerts with no setlist.
  // `setlists` (jsonb keyed by performerId) is the canonical column; the legacy
  // `setlist` text[] is no longer written by enrichment, so checking it here
  // would re-queue every past concert forever.
  const concertsNeedingSetlist = transitioned.filter(
    (s) => s.kind === 'concert' && !hasSetlist(s.setlists)
  );

  let queued = 0;
  if (concertsNeedingSetlist.length > 0) {
    // Skip shows already in the retry queue — `transitioned` only contains
    // newly-flipped rows, but a previous nightly run could have queued them
    // before the ticketed→past transition (manual edits) or this job could
    // have failed mid-flight. Avoid duplicates without needing a unique idx.
    const ids = concertsNeedingSetlist.map((s) => s.id);
    const alreadyQueuedRows = await db
      .select({ showId: enrichmentQueue.showId })
      .from(enrichmentQueue)
      .where(
        and(eq(enrichmentQueue.type, 'setlist'), inArray(enrichmentQueue.showId, ids))
      );
    const alreadyQueued = new Set(alreadyQueuedRows.map((r) => r.showId));
    const toQueue = concertsNeedingSetlist.filter((s) => !alreadyQueued.has(s.id));

    if (toQueue.length > 0) {
      await db.insert(enrichmentQueue).values(
        toQueue.map((s) => ({
          showId: s.id,
          type: 'setlist' as const,
          attempts: 0,
          maxAttempts: 14,
          nextRetry: new Date(),
        }))
      );
    }
    queued = toQueue.length;
  }

  // 3. Catch-up pass for past concerts that bypassed the
  // ticketed→past transition above. Gmail imports, manual entry of "I went
  // to this show last week", and any other path that creates a show
  // directly in `past` state never trigger the transition queue logic, so
  // their setlists were never fetched. Pick those up here.
  //
  // `setlists IS NULL` is deliberate (vs. `!hasSetlist`):
  //   - null         → never been processed by setlist-retry, eligible
  //   - {}           → setlist-retry exhausted retries (see give-up path),
  //                    don't re-queue
  //   - { perfId:.. }→ has setlist data, don't re-queue
  const alreadyQueuedAllRows = await db
    .select({ showId: enrichmentQueue.showId })
    .from(enrichmentQueue)
    .where(eq(enrichmentQueue.type, 'setlist'));
  const alreadyQueuedAll = alreadyQueuedAllRows.map((r) => r.showId);

  const headlinerShowIds = db
    .select({ showId: showPerformers.showId })
    .from(showPerformers)
    .where(eq(showPerformers.role, 'headliner'));

  const catchupConditions = [
    eq(shows.state, 'past'),
    eq(shows.kind, 'concert'),
    isNull(shows.setlists),
    sql`${shows.date} IS NOT NULL`,
    inArray(shows.id, headlinerShowIds),
  ];
  if (alreadyQueuedAll.length > 0) {
    catchupConditions.push(notInArray(shows.id, alreadyQueuedAll));
  }

  const catchupRows = await db
    .select({ id: shows.id })
    .from(shows)
    .where(and(...catchupConditions));

  let catchupQueued = 0;
  if (catchupRows.length > 0) {
    await db.insert(enrichmentQueue).values(
      catchupRows.map((s) => ({
        showId: s.id,
        type: 'setlist' as const,
        attempts: 0,
        maxAttempts: 14,
        nextRetry: new Date(),
      }))
    );
    catchupQueued = catchupRows.length;
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
