/**
 * Generic sort helper that pushes nulls to the end (matching the shows-list
 * UX: empty seat / paid columns sort last in either direction). Extracted
 * from apps/web/app/(app)/shows/View.client.tsx so the comparator can be
 * exercised in unit tests without spinning up the page.
 */
export function compareNullable<T>(
  a: T | null | undefined,
  b: T | null | undefined,
  cmp: (x: T, y: T) => number,
): number {
  const aNull = a == null;
  const bNull = b == null;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  return cmp(a as T, b as T);
}
