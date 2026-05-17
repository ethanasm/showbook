/**
 * Pure helpers for the /songs page's sidebar filters + sortable
 * columns. The router applies the DB-side filters; this module
 * handles the UI-side passes: free-text search across title + artist
 * and the column sorts. The year dropdown is populated by the
 * `songs.years` tRPC procedure so it stays stable when the user
 * picks a single year. Pure so the unit tests can drive each branch
 * without spinning up React.
 */

export interface SongRow {
  songId: string;
  performerId: string;
  performerName: string;
  title: string;
  timesHeard: number;
  firstHeard: string;
  lastHeard: string;
  isUserDebut: boolean;
}

export type SortField = "title" | "performer" | "count" | "last";

export interface SortConfig {
  field: SortField;
  dir: "asc" | "desc";
}

export const DEFAULT_SORT: SortConfig = { field: "count", dir: "desc" };

export const DEFAULT_DIR: Record<SortField, "asc" | "desc"> = {
  title: "asc",
  performer: "asc",
  count: "desc",
  last: "desc",
};

/** Free-text search across the song title and performer name. */
export function matchesSearch(row: SongRow, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  return (
    row.title.toLowerCase().includes(lower) ||
    row.performerName.toLowerCase().includes(lower)
  );
}

export function sortRows(rows: SongRow[], sort: SortConfig): SongRow[] {
  const flip = sort.dir === "asc" ? 1 : -1;
  const copy = [...rows];
  copy.sort((a, b) => {
    switch (sort.field) {
      case "title":
        return a.title.localeCompare(b.title) * flip;
      case "performer":
        return (
          a.performerName.localeCompare(b.performerName) * flip ||
          a.title.localeCompare(b.title)
        );
      case "count":
        return (
          (a.timesHeard - b.timesHeard) * flip ||
          a.title.localeCompare(b.title)
        );
      case "last":
        // String comparison is fine: ISO dates collate correctly.
        return (
          a.lastHeard.localeCompare(b.lastHeard) * flip ||
          a.title.localeCompare(b.title)
        );
    }
  });
  return copy;
}
