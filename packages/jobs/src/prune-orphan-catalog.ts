import { db, sql } from '@showbook/db';

export type PruneOrphanCatalogResult = {
  announcements: number;
  venues: number;
  performers: number;
};

/**
 * Periodic backstop for the orphan-cleanup triggers in 0002 / 0014 / 0023 /
 * 0025. The triggers handle the common synchronous paths (unfollow, show
 * delete, region delete, user delete cascade), but anything that bypasses
 * them — direct SQL, future tables, a region-bbox preservation rule that
 * goes stale, a missed cascade — leaves catalog rows behind.
 *
 * Order matters: announcements first so the venue + performer sweeps see
 * their references freshly cleared.
 *
 * Re-uses the `announcement_has_preserver(uuid)` SQL function defined in
 * `packages/db/drizzle/0023_orphan_announcement_cleanup.sql` so the
 * preservation rules stay in one place.
 */
export async function runPruneOrphanCatalog(): Promise<PruneOrphanCatalogResult> {
  return db.transaction(async (tx) => {
    const ann = await tx.execute(sql`
      DELETE FROM announcements a
      WHERE NOT announcement_has_preserver(a.id)
      RETURNING a.id
    `);

    const ven = await tx.execute(sql`
      DELETE FROM venues v
      WHERE NOT EXISTS (SELECT 1 FROM shows WHERE venue_id = v.id)
        AND NOT EXISTS (SELECT 1 FROM user_venue_follows WHERE venue_id = v.id)
        AND NOT EXISTS (SELECT 1 FROM announcements WHERE venue_id = v.id)
      RETURNING v.id
    `);

    const perf = await tx.execute(sql`
      DELETE FROM performers p
      WHERE NOT EXISTS (SELECT 1 FROM show_performers WHERE performer_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM user_performer_follows WHERE performer_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM announcements WHERE headliner_performer_id = p.id)
      RETURNING p.id
    `);

    return {
      announcements: ann.length,
      venues: ven.length,
      performers: perf.length,
    };
  });
}
