import { db, sql } from '@showbook/db';

export type PrunePastAnnouncementsResult = {
  announcements: number;
};

/**
 * Deletes announcements whose LAST performance is before today. These
 * are advertised events that already happened, so they have no place
 * in Discover, in any followed-venue or followed-artist feed, or in
 * region search. The orphan-prune backstop preserves announcements
 * whose headliner, support performer, or venue is followed, so past
 * announcements would otherwise pile up indefinitely.
 *
 * `showDate` is pinned to a run's FIRST night, so comparing it alone
 * deletes an in-progress multi-night run (or festival) the morning
 * after it opens — silently undoing the read-path fix that keeps
 * those runs visible (`stillUpcoming()` in the discover router).
 * `COALESCE(run_end_date, show_date)` is the run's last night, and
 * falls back to `show_date` for single-night announcements — the same
 * predicate the discover-ingest Phase 4 cleanup uses.
 *
 * Safe because:
 * - The discover queries already filter on the same window via
 *   `stillUpcoming()` (defense in depth between prune runs).
 * - `show_announcement_links.announcement_id` is ON DELETE CASCADE,
 *   so cascading drops only the link row — a user's `shows` row that
 *   was created from this announcement stays intact.
 */
export async function runPrunePastAnnouncements(): Promise<PrunePastAnnouncementsResult> {
  const deleted = await db.execute(sql`
    DELETE FROM announcements
    WHERE COALESCE(run_end_date, show_date) < CURRENT_DATE
    RETURNING id
  `);
  return { announcements: deleted.length };
}
