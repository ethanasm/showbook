import { db } from '@showbook/db';
import {
  shows,
  showPerformers,
  showAnnouncementLinks,
  enrichmentQueue,
} from '@showbook/db';
import { and, eq, lt, sql, inArray } from 'drizzle-orm';

export async function runShowsNightly(): Promise<{
  transitioned: number;
  queued: number;
  deleted: number;
}> {
  // 1. Transition ticketed → past where date < today
  const transitioned = await db
    .update(shows)
    .set({ state: 'past', updatedAt: new Date() })
    .where(and(eq(shows.state, 'ticketed'), lt(shows.date, sql`CURRENT_DATE`)))
    .returning();

  // 2. Queue setlist enrichment for newly-past concerts with no setlist
  const concertsNeedingSetlist = transitioned.filter(
    (s) => s.kind === 'concert' && !s.setlist
  );

  if (concertsNeedingSetlist.length > 0) {
    await db.insert(enrichmentQueue).values(
      concertsNeedingSetlist.map((s) => ({
        showId: s.id,
        type: 'setlist' as const,
        attempts: 0,
        maxAttempts: 14,
        nextRetry: new Date(),
      }))
    );
  }

  // 3. Delete expired watching shows
  const watchingToDelete = await db
    .select({ id: shows.id })
    .from(shows)
    .where(and(eq(shows.state, 'watching'), lt(shows.date, sql`CURRENT_DATE`)));

  let deleted = 0;

  if (watchingToDelete.length > 0) {
    const ids = watchingToDelete.map((s) => s.id);

    // Delete show_performers rows first (no cascade on FK)
    await db.delete(showPerformers).where(inArray(showPerformers.showId, ids));

    // Delete show_announcement_links (has cascade but be explicit)
    await db
      .delete(showAnnouncementLinks)
      .where(inArray(showAnnouncementLinks.showId, ids));

    // Delete the shows themselves
    const deletedRows = await db
      .delete(shows)
      .where(inArray(shows.id, ids))
      .returning({ id: shows.id });

    deleted = deletedRows.length;
  }

  return {
    transitioned: transitioned.length,
    queued: concertsNeedingSetlist.length,
    deleted,
  };
}
