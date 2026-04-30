import { and, eq, lte } from 'drizzle-orm';
import { db, enrichmentQueue, shows, showPerformers, performers } from '@showbook/db';
import { searchArtist, searchSetlist } from '@showbook/api';
import type { PerformerSetlistsMap } from '@showbook/shared';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function runSetlistRetry(): Promise<{
  processed: number;
  enriched: number;
  failed: number;
  givenUp: number;
}> {
  const counts = { processed: 0, enriched: 0, failed: 0, givenUp: 0 };

  // 1. Get all queue items ready for retry
  const queueItems = await db
    .select()
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
      await db.delete(enrichmentQueue).where(eq(enrichmentQueue.id, item.id));
      counts.givenUp++;
      continue;
    }

    counts.processed++;

    try {
      // 2a. Look up the show
      const [show] = await db
        .select({ date: shows.date })
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

      // 2b. Look up the headliner performer
      const [headlinerRow] = await db
        .select({
          performerId: showPerformers.performerId,
          name: performers.name,
          musicbrainzId: performers.musicbrainzId,
        })
        .from(showPerformers)
        .innerJoin(performers, eq(showPerformers.performerId, performers.id))
        .where(
          and(
            eq(showPerformers.showId, item.showId),
            eq(showPerformers.role, 'headliner'),
          ),
        )
        .orderBy(showPerformers.sortOrder)
        .limit(1);

      if (!headlinerRow) {
        await incrementAttempts(item.id, item.attempts, 'No headliner performer found for show');
        counts.failed++;
        continue;
      }

      // 2c/2d. Resolve MBID
      let mbid = headlinerRow.musicbrainzId;

      if (!mbid) {
        // Try to find the artist on setlist.fm
        const artists = await searchArtist(headlinerRow.name);
        if (artists.length > 0) {
          mbid = artists[0]!.mbid;
          // Persist the MBID for future lookups
          await db
            .update(performers)
            .set({ musicbrainzId: mbid })
            .where(eq(performers.id, headlinerRow.performerId));
        }
      }

      // 2e. Still no MBID
      if (!mbid) {
        await incrementAttempts(
          item.id,
          item.attempts,
          `Could not find setlist.fm MBID for "${headlinerRow.name}"`,
        );
        counts.failed++;
        continue;
      }

      // 2f. Search for the setlist
      const result = await searchSetlist(mbid, show.date);

      if (result) {
        // 2g. Found — update the show and delete the queue entry atomically.
        // Without a transaction, a crash between the two writes leaves the
        // queue entry orphaned (queued forever) or the setlist saved while
        // the queue still re-tries it.
        const setlistsUpdate: PerformerSetlistsMap = {
          [headlinerRow.performerId]: result.setlist,
        };
        await db.transaction(async (tx) => {
          await tx
            .update(shows)
            .set({
              setlists: setlistsUpdate,
              tourName: result.tourName ?? undefined,
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
          await db.delete(enrichmentQueue).where(eq(enrichmentQueue.id, item.id));
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
