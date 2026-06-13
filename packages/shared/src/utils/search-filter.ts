/**
 * Client-side list search/filter matching.
 *
 * Powers the pinned search bars on the Shows and Discover screens (web
 * + mobile). Each call site collects the fields it wants searched —
 * headliner / cast / support names, venue name, show/production name,
 * festival name — into a flat array of strings and asks whether a given
 * query matches.
 *
 * Matching rules:
 *   - An empty / whitespace-only query matches everything (no filter).
 *   - The query is split on whitespace into tokens; a row matches when
 *     *every* token is a substring of *some* field (AND across tokens,
 *     OR across fields). So "dylan berkeley" matches a Bob Dylan show at
 *     a Berkeley venue even though the two words live in different fields.
 *   - Matching is case- and diacritic-insensitive, so typing "michael"
 *     finds "Michaël Brun".
 *
 * Pure + dependency-free so it unit-tests without React / RN and runs
 * identically on both surfaces.
 */

/** Lowercase + strip combining diacritics ("Michaël" → "michael"). */
function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** Split a raw query into folded, non-empty whitespace tokens. */
export function searchQueryTokens(query: string): string[] {
  return fold(query.trim())
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * Does `query` match the given `fields`? Returns `true` for an empty
 * query (the no-filter case) so callers can use it unconditionally.
 */
export function matchesSearchQuery(
  query: string,
  fields: Array<string | null | undefined>,
): boolean {
  const tokens = searchQueryTokens(query);
  if (tokens.length === 0) return true;

  const haystack = fields
    .filter((field): field is string => typeof field === 'string' && field.length > 0)
    .map(fold);
  if (haystack.length === 0) return false;

  return tokens.every((token) => haystack.some((field) => field.includes(token)));
}
