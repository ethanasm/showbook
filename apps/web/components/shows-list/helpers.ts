/**
 * Shared types, constants, and pure helpers for the Shows list page.
 *
 * Lifted out of ShowsListView.tsx so the sub-component files
 * (StatsView, CalendarView, FilterBar, …) can share the ShowData
 * shape, the sort comparator, and the date/year helpers without
 * each redefining them.
 */

import { formatDateParts } from "@showbook/shared";
import type { ShowKind, ShowState } from "@/components/design-system";
import type { SortConfig as SortConfigBase } from "@/components/SortHeader";
import { compareNullable } from "@/lib/sort";
import { getHeadliner } from "@/lib/show-accessors";

export type ViewMode = "list" | "calendar" | "stats";

export type SortField =
  | "date"
  | "kind"
  | "headliner"
  | "venue"
  | "seat"
  | "paid"
  | "state";

export type SortConfig = SortConfigBase<SortField>;

export type CalView = "month" | "year";
export type StatsTimeframe = "year" | "5years" | "all";

export type ShowsListMode = "upcoming" | "logbook" | "all";

export interface ShowData {
  id: string;
  kind: ShowKind;
  state: ShowState;
  date: string;
  endDate: string | null;
  seat: string | null;
  pricePaid: string | null;
  ticketCount: number;
  tourName: string | null;
  productionName: string | null;
  setlist: string[] | null;
  photos: string[] | null;
  ticketUrl: string | null;
  venue: {
    id: string;
    name: string;
    city: string;
    stateRegion?: string | null;
    country?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  };
  showPerformers: {
    role: string;
    characterName: string | null;
    sortOrder: number;
    performer: {
      id: string;
      name: string;
      imageUrl: string | null;
    };
  }[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KIND_ORDER: Record<ShowKind, number> = {
  concert: 0,
  theatre: 1,
  comedy: 2,
  festival: 3,
};

const STATE_ORDER: Record<ShowState, number> = {
  ticketed: 0,
  watching: 1,
  past: 2,
};

export const ALL_KINDS: ShowKind[] = ["concert", "theatre", "comedy", "festival"];

export const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const SHOW_LIST_GRID_TEMPLATE =
  "14px 32px 80px 110px 1.02fr 1.03fr 110px 0.15fr 64px 88px";

export const MODE_LABELS: Record<
  ShowsListMode,
  { eyebrow: string; title: string; emptyTitle: string; emptyBody: string }
> = {
  upcoming: {
    eyebrow: "Plans on the horizon",
    title: "Upcoming",
    emptyTitle: "Nothing on the horizon",
    emptyBody:
      "Add a show or browse Discover for upcoming events from venues and artists you follow.",
  },
  logbook: {
    eyebrow: "Your live-show log",
    title: "Logbook",
    emptyTitle: "Your history starts here",
    emptyBody:
      "Once your first show happens it'll move into your logbook automatically. Or import receipts from Gmail to backfill past shows.",
  },
  // `all` is the unified Shows hub — past + future + watching in a
  // single timeline. /upcoming and /logbook stay as pre-filtered
  // shortcuts that link into the same View component.
  all: {
    eyebrow: "Every show",
    title: "Shows",
    emptyTitle: "No shows yet",
    emptyBody:
      "Add a show, import receipts from Gmail, or browse Discover for upcoming events from venues and artists you follow.",
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Re-exported from shared as `formatDateParts` — keep the local alias so the
// existing call sites read naturally (`toDateParts(show.date)`).
export const toDateParts = formatDateParts;

export function defaultDirFor(field: SortField): "asc" | "desc" {
  return field === "date" || field === "paid" ? "desc" : "asc";
}

export function compareShows(a: ShowData, b: ShowData, sort: SortConfig): number {
  const flip = sort.dir === "desc" ? -1 : 1;
  switch (sort.field) {
    case "date":
      return flip * (new Date(a.date).getTime() - new Date(b.date).getTime());
    case "kind":
      return flip * (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
    case "state":
      return flip * (STATE_ORDER[a.state] - STATE_ORDER[b.state]);
    case "headliner":
      return flip * getHeadliner(a).localeCompare(getHeadliner(b));
    case "venue":
      return flip * a.venue.name.localeCompare(b.venue.name);
    case "seat":
      return (
        flip * compareNullable(a.seat, b.seat, (x, y) => x.localeCompare(y))
      );
    case "paid":
      return (
        flip *
        compareNullable(
          a.pricePaid != null ? parseFloat(a.pricePaid) : null,
          b.pricePaid != null ? parseFloat(b.pricePaid) : null,
          (x, y) => x - y,
        )
      );
  }
}

export function getNeighborhood(show: ShowData): string | undefined {
  const parts: string[] = [];
  if (show.venue.city) parts.push(show.venue.city);
  if (show.venue.stateRegion) parts.push(show.venue.stateRegion);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

export function getYear(dateStr: string): number {
  return new Date(dateStr + "T00:00:00").getFullYear();
}

export function getUniqueYears(shows: ShowData[]): number[] {
  const years = new Set(shows.map((s) => getYear(s.date)));
  return Array.from(years).sort((a, b) => b - a);
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}
