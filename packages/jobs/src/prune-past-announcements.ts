import { db, sql } from '@showbook/db';

export type PrunePastAnnouncementsResult = {
  announcements: number;
};

/**
 * Deletes announcements whose showDate is before today. These are
 * advertised events that already happened, so they have no place in
 * Discover, in any followed-venue or followed-artist feed, or in
 * region search. The orphan-prune backstop preserves announcements
 * whose headliner, support performer, or venue is followed, so past
 * announcements would otherwise pile up indefinitely.
 *
 * Safe because:
 * - The discover query already filters `showDate >= CURRENT_DATE`
 *   (defense in depth between prune runs).
 * - `show_announcement_links.announcement_id` is ON DELETE CASCADE,
 *   so cascading drops only the link row — a user's `shows` row that
 *   was created from this announcement stays intact.
 */
export async function runPrunePastAnnouncements(): Promise<PrunePastAnnouncementsResult> {
  const deleted = await db.execute(sql`
    DELETE FROM announcements
    WHERE show_date < CURRENT_DATE
    RETURNING id
  `);
  return { announcements: deleted.length };
}
