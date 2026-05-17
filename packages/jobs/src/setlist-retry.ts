import { and, eq, lte, sql } from 'drizzle-orm';
import { db, enrichmentQueue, shows, performers } from '@showbook/db';
import { fetchSetlistForPerformer } from '@showbook/api';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Give up on this (show, performer) entry. Drop the queue row and write
 * an empty per-performer marker into `shows.setlists` so the
 * shows-nightly catch-up pass treats this performer as "checked, no
 * setlist found" instead of re-queueing forever.
 *
 * The marker is `{ sections: [] }` keyed by performerId — the frontend's
 * `hasSetlist` helper already treats an empty section list as "no
 * setlist", so the UI is unchanged. The catch-up query uses the JSONB
 * `?` operator to test for key presence, so any value (empty or full)
 * for the performer key blocks re-queueing.
 *
 * jsonb_set with `create_missing=true` and `coalesce` on the existing
 * map handles the first-marker-on-a-fresh-show case atomically, and
 * preserves sibling performers' setlists (a festival mid-run with
 * another artist already populated).
 */
async function giveUp(queueId: string, showId: string, performerId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(shows)
      .set({
        setlists: sql`jsonb_set(coalesce(${shows.setlists}, '{}'::jsonb), ARRAY[${performerId}], '{"sections":[]}'::jsonb, true)`,
      })
      .where(eq(shows.id, showId));
    await tx.delete(enrichmentQueue).where(eq(enrichmentQueue.id, queueId));
  });
}

export async function runSetlistRetry(): Promise<{
  processed: number;
  enriched: number;
  failed: number;
  givenUp: number;
}> {
  const counts = { processed: 0, enriched: 0, failed: 0, givenUp: 0 };

  // 1. Get all queue items ready for retry
  const queueItems = await db
    .select({
      id: enrichmentQueue.id,
      showId: enrichmentQueue.showId,
      performerId: enrichmentQueue.performerId,
      attempts: enrichmentQueue.attempts,
      maxAttempts: enrichmentQueue.maxAttempts,
    })
    .from(enrichmentQueue)
    .where(
      and(
        eq(enrichmentQueue.type, 'setlist'),
        lte(enrichmentQueue.nextRetry, new Date()),
      ),
    );

  // 2. Process each item sequentially (rate limiting)
  for (const item of queueItems) {
    // Skip items that have exhausted attempts (shouldn't be in the query, but safety check)
    if (item.attempts >= item.maxAttempts) {
      await giveUp(item.id, item.showId, item.performerId);
      counts.givenUp++;
      continue;
    }

    counts.processed++;

    try {
      // 2a. Look up the show
      const [show] = await db
        .select({ date: shows.date, tourName: shows.tourName })
        .from(shows)
        .where(eq(shows.id, item.showId));

      if (!show) {
        // Show was deleted; remove queue entry
        await db.delete(enrichmentQueue).where(eq(enrichmentQueue.id, item.id));
        counts.failed++;
        continue;
      }

      if (!show.date) {
        // Dateless watching shows can't have setlists looked up — skip and
        // remove from the queue. They'll be re-queued if/when a date is set.
        await db.delete(enrichmentQueue).where(eq(enrichmentQueue.id, item.id));
        counts.failed++;
        continue;
      }

      // 2b. Look up the specific performer this queue row targets.
      const [performerRow] = await db
        .select({
          id: performers.id,
          name: performers.name,
          musicbrainzId: performers.musicbrainzId,
        })
        .from(performers)
        .where(eq(performers.id, item.performerId))
        .limit(1);

      if (!performerRow) {
        // Performer was deleted — queue row is unprocessable.
        await db.delete(enrichmentQueue).where(eq(enrichmentQueue.id, item.id));
        counts.failed++;
        continue;
      }

      // 2c-f. Resolve MBID (persisting on first hit) and look up the setlist.
      const result = await fetchSetlistForPerformer({
        performerId: performerRow.id,
        performerName: performerRow.name,
        performerMbid: performerRow.musicbrainzId,
        date: show.date,
      });

      if (result) {
        // 2g. Found — merge this performer's setlist into the show's
        // `setlists` map and delete the queue entry atomically. jsonb_set
        // with coalesce keeps any sibling performer's setlist (a
        // festival mid-run with another artist already populated) and
        // initializes the map for a first-time write.
        //
        // tourName only gets written if the show doesn't already have one
        // — a festival's "tour" is meaningless, and overwriting the
        // headliner's tour with a support act's tour name would be wrong.
        const performerIdKey = performerRow.id;
        const setlistJson = JSON.stringify(result.setlist);
        await db.transaction(async (tx) => {
          await tx
            .update(shows)
            .set({
              setlists: sql`jsonb_set(coalesce(${shows.setlists}, '{}'::jsonb), ARRAY[${performerIdKey}], ${setlistJson}::jsonb, true)`,
              ...(result.tourName && !show.tourName
                ? { tourName: result.tourName }
                : {}),
            })
            .where(eq(shows.id, item.showId));
          await tx.delete(enrichmentQueue).where(eq(enrichmentQueue.id, item.id));
        });
        counts.enriched++;
      } else {
        // 2h. Not found — increment attempts
        const newAttempts = item.attempts + 1;

        if (newAttempts >= item.maxAttempts) {
          // Give up
          await giveUp(item.id, item.showId, item.performerId);
          counts.givenUp++;
        } else {
          await incrementAttempts(item.id, item.attempts, 'Setlist not found on setlist.fm');
          counts.failed++;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await incrementAttempts(item.id, item.attempts, message);
      counts.failed++;
    }
  }

  return counts;
}

async function incrementAttempts(
  queueId: string,
  currentAttempts: number,
  errorMessage: string,
): Promise<void> {
  await db
    .update(enrichmentQueue)
    .set({
      attempts: currentAttempts + 1,
      nextRetry: new Date(Date.now() + ONE_DAY_MS),
      lastError: errorMessage,
    })
    .where(eq(enrichmentQueue.id, queueId));
}
