"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShowKind } from "@/components/design-system";
import { applyEffectiveShowState } from "@showbook/shared";
import { trpc } from "@/lib/trpc";
import {
  compareShows,
  defaultDirFor,
  getUniqueYears,
  getYear,
  type CalView,
  type ShowData,
  type ShowsListMode,
  type SortConfig,
  type SortField,
  type StatsTimeframe,
  type ViewMode,
} from "./helpers";

interface UseShowsFilterArgs {
  mode: ShowsListMode;
  pageSize: number;
}

/**
 * Owns the year/kind/view-mode/sort/page state machine for the shows
 * list — the ~25 useState calls that were scattered across
 * `ShowsListView`. Also runs the two `shows.list` queries (filtered
 * + unfiltered) so the data flow stays in one place: `selectedYear`
 * → `yearFilter` → server query → `shows` → `filteredShows`. Returns
 * the resolved lists the page renders (`filteredShows`, `pagedShows`,
 * `dateTbdShows`, year/kind/state counts) alongside the setter
 * callbacks the toolbar UI uses to drive the filters.
 *
 * Resets `currentPage` to 0 whenever the year or kind filter changes
 * — kept inside the hook so the consumer can't forget the reset and
 * end up showing an empty page.
 */
export function useShowsFilter({ mode, pageSize }: UseShowsFilterArgs) {
  const isUpcoming = mode === "upcoming";
  const isLogbook = mode === "logbook";

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedYear, setSelectedYear] = useState<string>("All time");
  const [selectedKind, setSelectedKind] = useState<ShowKind | null>(null);
  // Upcoming defaults to date-asc (next-up first); Logbook keeps date-desc.
  // Stats is past-context only — never an option on /upcoming.
  const [sort, setSort] = useState<SortConfig>({
    field: "date",
    dir: mode === "upcoming" ? "asc" : "desc",
  });
  // Sub-filter on /upcoming: All · Tickets · Watching. /logbook ignores it.
  const [upcomingFilter, setUpcomingFilter] = useState<"all" | "ticketed" | "watching">("all");
  const [currentPage, setCurrentPage] = useState(0);

  // Calendar state
  const [calView, setCalView] = useState<CalView>("month");
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());

  // Stats timeframe
  const [statsTimeframe, setStatsTimeframe] = useState<StatsTimeframe>("all");

  const toggleSort = useCallback((field: SortField) => {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { field, dir: defaultDirFor(field) },
    );
    setCurrentPage(0);
  }, []);

  // Reset page when filters change
  const prevFiltersRef = useRef({ selectedYear, selectedKind: selectedKind ?? "" });
  useEffect(() => {
    const prev = prevFiltersRef.current;
    if (prev.selectedYear !== selectedYear || prev.selectedKind !== (selectedKind ?? "")) {
      setCurrentPage(0);
      prevFiltersRef.current = { selectedYear, selectedKind: selectedKind ?? "" };
    }
  }, [selectedYear, selectedKind]);

  // Year filter for the server-side `shows.list` query — undefined on
  // "All time" / "older" so the server returns everything and the
  // client narrows further.
  const yearFilter =
    selectedYear === "All time"
      ? undefined
      : selectedYear === "older"
        ? undefined
        : parseInt(selectedYear);

  const {
    data: allShows,
    isLoading,
    error,
  } = trpc.shows.list.useQuery(
    { year: yearFilter },
    { staleTime: 60_000 },
  );
  const { data: allShowsUnfilteredRaw } = trpc.shows.list.useQuery({}, { staleTime: 60_000 });

  // Effective state: a ticketed show reads as 'past' 3 h after its doors
  // anchor, so tonight's show moves from /upcoming to /logbook the same
  // evening instead of waiting for the nightly DB transition.
  const shows = useMemo(
    () => ((allShows ?? []) as ShowData[]).map((s) => applyEffectiveShowState(s)),
    [allShows],
  );
  const allShowsUnfiltered = useMemo(
    () => (allShowsUnfilteredRaw ?? []) as ShowData[],
    [allShowsUnfilteredRaw],
  );

  const allYears = useMemo(() => getUniqueYears(allShowsUnfiltered), [allShowsUnfiltered]);

  // Filtered shows. Mode-driven state filter is the primary cut:
  //   /upcoming → state IN ('watching','ticketed')
  //   /logbook  → state = 'past'
  // The watching/ticketed sub-filter on /upcoming narrows further; /logbook
  // keeps the existing year/kind filters.
  const filteredShows = useMemo(() => {
    let result = shows;

    if (isUpcoming) {
      result = result.filter(
        (s) => s.state === "watching" || s.state === "ticketed",
      );
      if (upcomingFilter !== "all") {
        result = result.filter((s) => s.state === upcomingFilter);
      }
    } else {
      result = result.filter((s) => s.state === "past");
    }

    if (isLogbook && selectedYear === "older") {
      const currentYear = new Date().getFullYear();
      result = result.filter((s) => s.date && getYear(s.date) < currentYear - 2);
    }

    if (selectedKind) {
      result = result.filter((s) => s.kind === selectedKind);
    }

    result = [...result].sort((a, b) => compareShows(a, b, sort));

    return result;
  }, [shows, selectedKind, sort, selectedYear, isUpcoming, isLogbook, upcomingFilter]);

  // Date-TBD watching shows (no date set yet) deserve their own rail at
  // the top of /upcoming so users can pick a night. The main filteredShows
  // list below already includes them, but a dedicated rail signals they
  // need attention.
  const dateTbdShows = useMemo(() => {
    if (!isUpcoming) return [];
    return shows.filter((s) => s.state === "watching" && s.date === null);
  }, [shows, isUpcoming]);

  const totalPages = Math.ceil(filteredShows.length / pageSize);
  const pagedShows = filteredShows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  // Counts
  const totalShows = allShowsUnfiltered.length;
  const ticketedCount = shows.filter((s) => s.state === "ticketed").length;
  const watchingCount = shows.filter((s) => s.state === "watching").length;
  const pastCount = shows.filter((s) => s.state === "past").length;

  // Year buttons
  const yearButtons = useMemo(() => {
    const buttons: string[] = ["All time"];
    const currentYear = new Date().getFullYear();
    // Add recent years (current + next year and 2 previous)
    const recentYears = allYears.filter((y) => y >= currentYear - 2);
    const olderYears = allYears.filter((y) => y < currentYear - 2);
    recentYears.sort((a, b) => b - a).forEach((y) => buttons.push(String(y)));
    if (olderYears.length > 0) buttons.push("older");
    return buttons;
  }, [allYears]);

  return {
    // queries
    isLoading, error,
    shows, allShowsUnfiltered,
    // view selection
    viewMode, setViewMode,
    // filters
    selectedYear, setSelectedYear,
    selectedKind, setSelectedKind,
    upcomingFilter, setUpcomingFilter,
    sort, toggleSort,
    currentPage, setCurrentPage,
    // calendar
    calView, setCalView,
    calMonth, setCalMonth,
    calYear, setCalYear,
    // stats
    statsTimeframe, setStatsTimeframe,
    // derived
    filteredShows, pagedShows, dateTbdShows,
    totalPages,
    allYears, yearButtons,
    totalShows, ticketedCount, watchingCount, pastCount,
  };
}
