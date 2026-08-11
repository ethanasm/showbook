/**
 * Client-side twin of the server's `stillUpcoming()` Discover filter
 * (`packages/api/src/routers/discover.ts`).
 *
 * The mobile app is offline-first: Discover and the map's discoverable
 * layer render from the persisted query cache, and a stale cache — an
 * expired session silently 401-ing every refetch was the concrete
 * incident — happily displays weeks-old announcements as "upcoming".
 * The server already prunes and filters past announcements, but the
 * client can't assume its cached payload is fresh, so every discover
 * render path re-applies the date window against the device's local
 * calendar before showing rows.
 *
 * Semantics mirror the server: a row is upcoming while its single
 * night is today-or-later, OR (for multi-night runs/festivals, whose
 * `showDate` is pinned to the FIRST night) while `runEndDate` is
 * today-or-later.
 */

/** Device-local calendar date as YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Whether an announcement still has a performance to come. Dates are
 * YYYY-MM-DD strings, so plain string comparison is date comparison.
 * A null/undefined date (e.g. a map row from the logbook layer) is
 * treated as upcoming — the guard exists to hide *provably* past
 * rows, never to hide rows it can't judge.
 */
export function isStillUpcoming(
  showDate: string | Date | null | undefined,
  runEndDate?: string | Date | null,
  today: string = localToday(),
): boolean {
  const show = normalize(showDate);
  const runEnd = normalize(runEndDate);
  if (show === null && runEnd === null) return true;
  if (show !== null && show >= today) return true;
  return runEnd !== null && runEnd >= today;
}

/**
 * Filters a Discover feed payload down to rows that are still
 * upcoming. Applied at the single point each screen derives its items
 * from the (possibly stale) cached payload, so list, chip counts, and
 * the "N upcoming" header all agree.
 */
export function filterUpcomingAnnouncements<
  T extends { showDate: string; runEndDate?: string | null },
>(items: T[], today: string = localToday()): T[] {
  return items.filter((item) =>
    isStillUpcoming(item.showDate, item.runEndDate ?? null, today),
  );
}

function normalize(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return localToday(value);
  // Server date columns serialize as 'YYYY-MM-DD' (sometimes with a
  // time suffix through superjson round-trips) — keep the date part.
  return value.slice(0, 10);
}
