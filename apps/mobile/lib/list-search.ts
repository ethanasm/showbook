/**
 * Pure helpers for the in-list filter bars on the Venues / Artists list
 * screens (`app/venues/index.tsx`, `app/artists/index.tsx`).
 *
 * Extracted here so the matching logic stays inside the `apps/mobile/lib/**`
 * coverage scope and can be unit-tested without React Native. No imports
 * from `react-native`, `expo-*`, or `lucide-react-native` belong in this
 * file.
 */

/** Trim + lowercase a raw query so callers compare on a stable shape. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Case-insensitive substring filter over an arbitrary set of text fields
 * per item. An empty / whitespace-only query returns the list unchanged
 * (a new array is never allocated in that case). A row matches when any
 * of its `fields(item)` values contains the normalized query.
 */
export function filterByQuery<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => readonly (string | null | undefined)[],
): readonly T[] {
  const q = normalizeQuery(query);
  if (!q) return items;
  return items.filter((item) =>
    fields(item).some((value) => (value ?? '').toLowerCase().includes(q)),
  );
}
