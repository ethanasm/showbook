/**
 * Shared types, constants, and pure helpers for the Discover page.
 *
 * Lifted out of the old monolithic View.client.tsx so the sub-component
 * files (AnnouncementRow, FeedSection, VenueRail, …) can share the
 * Announcement shape and the sort comparators without re-defining them.
 */

import type { SortConfig as SortConfigBase } from "@/components/SortHeader";
import type { ShowKind } from "@/components/design-system";

export type DiscoverKind = ShowKind | "film" | "unknown";

export type DiscoverSortField =
  | "showDate"
  | "kind"
  | "venue"
  | "headliner"
  | "onSaleDate"
  | "onSaleStatus";

export type DiscoverSortConfig = SortConfigBase<DiscoverSortField>;

export type Announcement = {
  id: string;
  venueId: string;
  kind: DiscoverKind;
  headliner: string;
  headlinerPerformerId: string | null;
  supportPerformerIds: string[] | null;
  support: string[] | null;
  productionName: string | null;
  showDate: string;
  runStartDate: string | null;
  runEndDate: string | null;
  performanceDates: string[] | null;
  onSaleDate: string | null;
  onSaleStatus: "announced" | "presale" | "on_sale" | "sold_out";
  source: string;
  ticketUrl: string | null;
  venue: {
    id: string;
    name: string;
    city: string;
  };
  reason?: string;
  regionId?: string | null;
  regionCityName?: string | null;
  regionRadiusMiles?: number | null;
};

export type PendingIngestSnapshot = {
  venueIds: string[];
  performerIds: string[];
  regionIds: string[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const REASON_LABELS: Record<string, string> = {
  "followed-venue": "followed venue",
  nearby: "followed region",
  "tracked-artist": "tracked artist",
};

export const ON_SALE_STATUS_LABELS: Record<string, string> = {
  announced: "announced",
  presale: "presale",
  on_sale: "on sale",
  sold_out: "sold out",
};

export const DISCOVER_KIND_ORDER: Record<DiscoverKind, number> = {
  concert: 0,
  theatre: 1,
  comedy: 2,
  festival: 3,
  film: 4,
  unknown: 5,
};

const ON_SALE_STATUS_ORDER: Record<Announcement["onSaleStatus"], number> = {
  announced: 0,
  presale: 1,
  on_sale: 2,
  sold_out: 3,
};

export const DISCOVER_DEFAULT_SORT: DiscoverSortConfig = {
  field: "showDate",
  dir: "asc",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isRun(a: Announcement): boolean {
  return (
    !!a.runStartDate &&
    !!a.runEndDate &&
    a.runStartDate !== a.runEndDate
  );
}

export function formatRunRange(start: string, end: string): string {
  const fmt = (s: string) => {
    const d = new Date(s + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

export function formatShowDateShort(dateStr: string): {
  month: string;
  day: string;
  year: string;
  dow: string;
} {
  const d = new Date(dateStr + "T00:00:00");
  const month = d
    .toLocaleDateString("en-US", { month: "short" })
    .toUpperCase();
  const day = String(d.getDate());
  const year = String(d.getFullYear());
  const dow = d.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
  return { month, day, year, dow };
}

export function formatOnSaleDate(dateStr: string | Date | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function dateValue(dateStr: string | Date | null): number | null {
  if (!dateStr) return null;
  const date =
    dateStr instanceof Date
      ? dateStr
      : new Date(
          /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
            ? `${dateStr}T00:00:00`
            : dateStr,
        );
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function compareNullableDate(
  a: string | Date | null,
  b: string | Date | null,
  dir: "asc" | "desc",
): number {
  const aTime = dateValue(a);
  const bTime = dateValue(b);
  if (aTime == null && bTime == null) return 0;
  if (aTime == null) return 1;
  if (bTime == null) return -1;
  return (dir === "desc" ? -1 : 1) * (aTime - bTime);
}

export function compareAnnouncements(
  a: Announcement,
  b: Announcement,
  sort: DiscoverSortConfig,
): number {
  const flip = sort.dir === "desc" ? -1 : 1;
  let result = 0;

  switch (sort.field) {
    case "showDate":
      result = compareNullableDate(a.showDate, b.showDate, sort.dir);
      break;
    case "kind":
      result = flip * (DISCOVER_KIND_ORDER[a.kind] - DISCOVER_KIND_ORDER[b.kind]);
      break;
    case "venue":
      result = flip * a.venue.name.localeCompare(b.venue.name);
      break;
    case "headliner":
      result = flip * a.headliner.localeCompare(b.headliner);
      break;
    case "onSaleDate":
      result = compareNullableDate(a.onSaleDate, b.onSaleDate, sort.dir);
      break;
    case "onSaleStatus":
      result =
        flip *
        (ON_SALE_STATUS_ORDER[a.onSaleStatus] -
          ON_SALE_STATUS_ORDER[b.onSaleStatus]);
      break;
  }

  if (result !== 0) return result;

  const dateTie = compareNullableDate(a.showDate, b.showDate, "asc");
  if (dateTie !== 0) return dateTie;
  return a.id.localeCompare(b.id);
}
