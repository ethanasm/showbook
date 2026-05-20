/**
 * Festival lineup ordering for the Setlist tab's chip picker:
 * headliner first (sortOrder 0), then supports by ascending
 * sortOrder. Pure helper so the order logic is testable without RN.
 */

export interface LineupEntryForOrder {
  performerId: string;
  role: 'headliner' | 'support';
  sortOrder: number;
}

export function sortFestivalLineup<T extends LineupEntryForOrder>(
  entries: ReadonlyArray<T>,
): T[] {
  return [...entries].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'headliner' ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
}

/**
 * Pick the default-selected chip id for the lineup chip rail. Returns
 * the headliner's performerId when present; otherwise the first entry
 * by sort order. `null` when the lineup is empty.
 */
export function defaultFestivalLineupSelection<T extends LineupEntryForOrder>(
  entries: ReadonlyArray<T>,
): string | null {
  const sorted = sortFestivalLineup(entries);
  return sorted[0]?.performerId ?? null;
}
