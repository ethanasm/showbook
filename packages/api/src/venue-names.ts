import { and, eq, inArray } from 'drizzle-orm';
import { userVenueNames, type Database } from '@showbook/db';

/**
 * Per-user venue name overrides ("aliases").
 *
 * Editing a venue's name no longer mutates the shared `venues.name`; it
 * writes a row in `user_venue_names` (see `venues.rename`). Every read path
 * that surfaces a venue name to a specific user resolves the override here,
 * falling back to the canonical name. The helpers rewrite the `name` field
 * on whatever row shape they're handed, so they work uniformly across
 * direct selects, relational `with: { venue }` rows, and the digest job.
 */

/**
 * Batch-load this user's venue-name overrides for the given venue ids.
 * Returns a `venueId -> customName` Map. Short-circuits to an empty Map
 * when there are no ids (the common case is also no overrides), so callers
 * pay at most one cheap, PK-indexed query.
 */
export async function loadVenueNameOverrides(
  db: Database,
  userId: string,
  venueIds: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(venueIds)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({
      venueId: userVenueNames.venueId,
      customName: userVenueNames.customName,
    })
    .from(userVenueNames)
    .where(
      and(
        eq(userVenueNames.userId, userId),
        inArray(userVenueNames.venueId, unique),
      ),
    );
  return new Map(rows.map((r) => [r.venueId, r.customName]));
}

/**
 * Rewrite a flat list of rows that each carry `venueId` + `name`, replacing
 * `name` with the user's override when one exists. Returns the same array
 * reference when there are no overrides so callers pay nothing extra in the
 * common case.
 */
export async function applyVenueNameOverrides<
  T extends { venueId: string; name: string },
>(db: Database, userId: string, rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  const overrides = await loadVenueNameOverrides(
    db,
    userId,
    rows.map((r) => r.venueId),
  );
  if (overrides.size === 0) return rows;
  return rows.map((r) => {
    const custom = overrides.get(r.venueId);
    return custom ? { ...r, name: custom } : r;
  });
}

/**
 * Rewrite rows where the venue is nested (relational `with: { venue }`),
 * given an accessor for the embedded `{ id, name }`. Rows whose venue is
 * null/undefined or unaffected are returned untouched.
 */
export async function applyNestedVenueNameOverrides<T>(
  db: Database,
  userId: string,
  rows: T[],
  getVenue: (row: T) => { id: string; name: string } | null | undefined,
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const ids = rows
    .map((r) => getVenue(r)?.id)
    .filter((x): x is string => Boolean(x));
  const overrides = await loadVenueNameOverrides(db, userId, ids);
  if (overrides.size === 0) return rows;
  return rows.map((row) => {
    const v = getVenue(row);
    const custom = v ? overrides.get(v.id) : undefined;
    if (!v || !custom) return row;
    return { ...row, venue: { ...v, name: custom } };
  });
}
