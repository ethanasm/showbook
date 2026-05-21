/**
 * Shared Drizzle relation shape + denormalized-headliner resolution for
 * `shows`-router list/detail queries. Centralizes the
 * `with: { venue, showPerformers: { with: { performer } } }` literal so
 * the read procedures + the post-write returning queries don't drift
 * apart on what an "expanded show" looks like.
 *
 * NOTE: this module intentionally doesn't dereference Drizzle table
 * columns at module load — some test setups (`packages/jobs`)
 * `mock.module('@showbook/db', { namedExports: { db: ... } })` and
 * leave the table objects undefined. Anything that touches `<table>.<col>`
 * lives inside a function so it only runs when the procedure runs.
 */

/**
 * The canonical with-clause for `findFirst`/`findMany` queries that
 * need a full show graph (venue + lineup + performers). Used by
 * `list`, `detail`, the `create` and `setSetlists` return queries —
 * anywhere the procedure's return value gets handed to the UI's full
 * show-detail renderer.
 */
export const showsWithRelationsShape = {
  venue: true,
  showPerformers: {
    with: { performer: true },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────
// Denormalized-headliner resolution (used by `listForMap`)
// ─────────────────────────────────────────────────────────────────────

export interface ListForMapPerformerRow {
  showId: string;
  performerId: string;
  name: string;
  imageUrl: string | null;
  role: string;
  sortOrder: number;
}

export interface ListForMapHeadliner {
  name: string;
  performerId: string;
  imageUrl: string | null;
}

/**
 * Reduce per-show showPerformer rows to a single denormalized
 * headliner. Walks every row (not just `role='headliner'`) so it can
 * apply the same 3-tier fallback the web client uses on the full
 * `ShowLike`:
 *   1) headliner with sortOrder === 0
 *   2) any headliner
 *   3) first showPerformer regardless of role
 */
export function resolveListForMapHeadliners(
  rows: ListForMapPerformerRow[],
): Map<string, ListForMapHeadliner> {
  type Best = {
    tier: 0 | 1 | 2;
    sortOrder: number;
    name: string;
    performerId: string;
    imageUrl: string | null;
  };
  const best = new Map<string, Best>();
  for (const row of rows) {
    const tier: Best['tier'] =
      row.role === 'headliner' && row.sortOrder === 0
        ? 0
        : row.role === 'headliner'
          ? 1
          : 2;
    const cur = best.get(row.showId);
    if (
      !cur ||
      tier < cur.tier ||
      (tier === cur.tier && row.sortOrder < cur.sortOrder)
    ) {
      best.set(row.showId, {
        tier,
        sortOrder: row.sortOrder,
        name: row.name,
        performerId: row.performerId,
        imageUrl: row.imageUrl,
      });
    }
  }
  const out = new Map<string, ListForMapHeadliner>();
  for (const [showId, b] of best) {
    out.set(showId, {
      name: b.name,
      performerId: b.performerId,
      imageUrl: b.imageUrl,
    });
  }
  return out;
}
