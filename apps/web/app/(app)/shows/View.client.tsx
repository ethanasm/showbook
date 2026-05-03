"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import {
  EmptyState,
  ShowRow,
  KindBadge,
  type ShowKind,
  type ShowState,
} from "@/components/design-system";
import {
  SortHeader,
  type SortConfig as SortConfigBase,
} from "@/components/SortHeader";
import {
  Archive,
  Calendar,
  ArrowDownUp,
  MoreHorizontal,
  Ticket,
  Square,
  Trash2,
  Mail,
  X,
  Check,
  Loader2,
  ArrowUpRight,
  Link2,
  Pencil,
  Eye,
} from "lucide-react";
import { useCompactMode } from "@/lib/useCompactMode";
import { useIsMobile } from "@/lib/useIsMobile";
import { daysUntil, formatDateParts } from "@showbook/shared";
import { KIND_ICONS, KIND_LABELS } from "@/lib/kind-icons";
import { STATE_TRANSITIONS } from "@/lib/show-state";
import { useShowContextMenu } from "@/lib/useShowContextMenu";
import { PaginationFooter } from "@/components/PaginationFooter";
import { compareNullable } from "@/lib/sort";
import {
  getHeadliner,
  getHeadlinerId,
  getHeadlinerImageUrl,
  getSupport,
  getSupportPerformers,
} from "@/lib/show-accessors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewMode = "list" | "calendar" | "stats";

type SortField =
  | "date"
  | "kind"
  | "headliner"
  | "venue"
  | "seat"
  | "paid"
  | "state";

type SortConfig = SortConfigBase<SortField>;

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

function defaultDirFor(field: SortField): "asc" | "desc" {
  return field === "date" || field === "paid" ? "desc" : "asc";
}

function compareShows(a: ShowData, b: ShowData, sort: SortConfig): number {
  const flip = sort.dir === "desc" ? -1 : 1;
  switch (sort.field) {
    case "date":
      return (
        flip *
        (new Date(a.date).getTime() - new Date(b.date).getTime())
      );
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
        flip *
        compareNullable(a.seat, b.seat, (x, y) => x.localeCompare(y))
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

interface ShowData {
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

const ALL_KINDS: ShowKind[] = ["concert", "theatre", "comedy", "festival"];

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHOW_LIST_GRID_TEMPLATE = "14px 32px 80px 110px 1.02fr 1.03fr 110px 0.15fr 64px 88px";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Re-exported from shared as `formatDateParts` — keep the local alias so the
// existing call sites read naturally (`toDateParts(show.date)`).
const toDateParts = formatDateParts;

function getNeighborhood(show: ShowData): string | undefined {
  const parts: string[] = [];
  if (show.venue.city) parts.push(show.venue.city);
  if (show.venue.stateRegion) parts.push(show.venue.stateRegion);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function getYear(dateStr: string): number {
  return new Date(dateStr + "T00:00:00").getFullYear();
}

function getUniqueYears(shows: ShowData[]): number[] {
  const years = new Set(shows.map((s) => getYear(s.date)));
  return Array.from(years).sort((a, b) => b - a);
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}


// ---------------------------------------------------------------------------
// State transition labels
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

type CalView = "month" | "year";
type StatsTimeframe = "year" | "5years" | "all";

export default function ShowsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const compact = useCompactMode();
  const isMobile = useIsMobile();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedYear, setSelectedYear] = useState<string>("All");
  const [selectedKind, setSelectedKind] = useState<ShowKind | null>(null);
  const [sort, setSort] = useState<SortConfig>({ field: "date", dir: "desc" });
  const [currentPage, setCurrentPage] = useState(0);

  const PAGE_SIZE = compact ? 10 : 12;

  const toggleSort = useCallback((field: SortField) => {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { field, dir: defaultDirFor(field) },
    );
    setCurrentPage(0);
  }, []);

  // Show row context menu + watching → ticketed transition modal.
  const {
    openContextMenu: handleContextMenu,
    portal: showContextMenuPortal,
    handleDelete,
    handleStateTransition,
  } = useShowContextMenu<ShowData>();

  // Calendar state
  const [calView, setCalView] = useState<CalView>("month");
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());

  // Stats timeframe
  const [statsTimeframe, setStatsTimeframe] = useState<StatsTimeframe>("all");

  // Gmail bulk scan state
  const [gmailModalOpen, setGmailModalOpen] = useState(false);
  const [gmailBulkLoading, setGmailBulkLoading] = useState(false);
  const [gmailBulkResults, setGmailBulkResults] = useState<
    Array<{
      gmailMessageId: string;
      headliner: string;
      production_name: string | null;
      venue_name: string | null;
      venue_city: string | null;
      venue_state: string | null;
      date: string | null;
      seat: string | null;
      price: string | null;
      ticket_count: number | null;
      kind_hint: "concert" | "theatre" | "comedy" | "festival" | null;
      confidence: "high" | "medium" | "low";
    }>
  >([]);
  const [gmailBulkSelected, setGmailBulkSelected] = useState<Set<number>>(new Set());
  const [gmailAdding, setGmailAdding] = useState(false);
  const [gmailAddedCount, setGmailAddedCount] = useState(0);
  const [gmailAccessToken, setGmailAccessToken] = useState<string | null>(null);
  const [gmailError, setGmailError] = useState<string | null>(null);

  // Fetch shows
  const yearFilter = selectedYear === "All" ? undefined :
    selectedYear === "older" ? undefined :
    parseInt(selectedYear);

  const {
    data: allShows,
    isLoading,
    error,
  } = trpc.shows.list.useQuery(
    { year: yearFilter },
    { staleTime: 60_000 }
  );

  const deleteAllShows = trpc.shows.deleteAll.useMutation();
  const createShow = trpc.shows.create.useMutation();
  const utils = trpc.useUtils();
  const setTicketUrl = trpc.shows.setTicketUrl.useMutation({
    onSuccess: () => utils.shows.invalidate(),
  });

  // Gmail
  const [gmailProgress, setGmailProgress] = useState<{ phase: string; processed: number; total: number; found: number } | null>(null);

  const shows = useMemo(
    () => (allShows ?? []) as ShowData[],
    [allShows],
  );

  // Get all years from unfiltered data
  const { data: allShowsUnfiltered } = trpc.shows.list.useQuery({}, { staleTime: 60_000 });
  const allYears = useMemo(
    () => getUniqueYears((allShowsUnfiltered ?? []) as ShowData[]),
    [allShowsUnfiltered]
  );

  // Reset page when filters change
  const prevFiltersRef = useRef({ selectedYear, selectedKind: selectedKind ?? "" });
  useEffect(() => {
    const prev = prevFiltersRef.current;
    if (prev.selectedYear !== selectedYear || prev.selectedKind !== (selectedKind ?? "")) {
      setCurrentPage(0);
      prevFiltersRef.current = { selectedYear, selectedKind: selectedKind ?? "" };
    }
  }, [selectedYear, selectedKind]);

  // Filtered shows
  const filteredShows = useMemo(() => {
    let result = shows;

    if (selectedYear === "older") {
      const currentYear = new Date().getFullYear();
      result = result.filter((s) => getYear(s.date) < currentYear - 2);
    }

    if (selectedKind) {
      result = result.filter((s) => s.kind === selectedKind);
    }

    result = [...result].sort((a, b) => compareShows(a, b, sort));

    return result;
  }, [shows, selectedKind, sort, selectedYear]);

  const totalPages = Math.ceil(filteredShows.length / PAGE_SIZE);
  const pagedShows = filteredShows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  // Counts
  const totalShows = (allShowsUnfiltered ?? []).length;
  const ticketedCount = shows.filter((s) => s.state === "ticketed").length;
  const watchingCount = shows.filter((s) => s.state === "watching").length;
  const pastCount = shows.filter((s) => s.state === "past").length;

  // Year buttons
  const yearButtons = useMemo(() => {
    const buttons: string[] = ["All"];
    const currentYear = new Date().getFullYear();
    // Add recent years (current + next year and 2 previous)
    const recentYears = allYears.filter((y) => y >= currentYear - 2);
    const olderYears = allYears.filter((y) => y < currentYear - 2);
    recentYears.sort((a, b) => b - a).forEach((y) => buttons.push(String(y)));
    if (olderYears.length > 0) buttons.push("older");
    return buttons;
  }, [allYears]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  async function handleDeleteAll() {
    if (!confirm(`Delete all ${totalShows} shows? This cannot be undone.`)) return;
    await deleteAllShows.mutateAsync();
    utils.shows.invalidate();
    utils.performers.invalidate();
  }

  // ---------------------------------------------------------------------------
  // Gmail bulk scan helpers
  // ---------------------------------------------------------------------------

  const isDuplicate = useCallback(
    (ticket: { headliner: string; date: string | null }) => {
      if (!allShowsUnfiltered) return false;
      const existingShows = allShowsUnfiltered as ShowData[];
      return existingShows.some((show) => {
        const headlinerMatch = show.showPerformers.some(
          (sp) =>
            sp.role === "headliner" &&
            sp.performer.name.toLowerCase() === ticket.headliner.toLowerCase(),
        );
        const dateMatch = ticket.date != null && show.date === ticket.date;
        return headlinerMatch && dateMatch;
      });
    },
    [allShowsUnfiltered],
  );

  const startGmailScan = useCallback(async (token: string) => {
    setGmailBulkLoading(true);
    setGmailProgress(null);
    try {
      const res = await fetch("/api/gmail/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token }),
      });
      if (!res.ok || !res.body) throw new Error("Scan request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalTickets: typeof gmailBulkResults = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7);
          } else if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));
            if (eventType === "progress") {
              setGmailProgress(data);
            } else if (eventType === "done") {
              finalTickets = data.tickets;
            } else if (eventType === "error") {
              throw new Error(data.message);
            }
          }
        }
      }

      setGmailBulkResults(finalTickets);
      const initialSelected = new Set<number>();
      finalTickets.forEach((t: typeof finalTickets[number], i: number) => {
        if (!isDuplicate(t)) initialSelected.add(i);
      });
      setGmailBulkSelected(initialSelected);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Scan failed";
      setGmailError(msg);
    } finally {
      setGmailBulkLoading(false);
      setGmailProgress(null);
    }
  }, [isDuplicate]);

  const handleOpenGmailModal = useCallback(() => {
    setGmailModalOpen(true);
    setGmailBulkResults([]);
    setGmailBulkSelected(new Set());
    setGmailAddedCount(0);
    setGmailAccessToken(null);
    setGmailError(null);
    setGmailProgress(null);

    const handler = (e: MessageEvent) => {
      if (e.data?.type === "gmail-auth" && e.data.accessToken) {
        window.removeEventListener("message", handler);
        setGmailAccessToken(e.data.accessToken);
        startGmailScan(e.data.accessToken);
      }
      if (e.data?.type === "gmail-auth-error") {
        window.removeEventListener("message", handler);
      }
    };
    window.addEventListener("message", handler);

    const popup = window.open("/api/gmail", "gmail-auth", "width=500,height=600,popup=yes");

    if (popup) {
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          window.removeEventListener("message", handler);
        }
      }, 500);
    }
  }, [startGmailScan]);

  // Auto-open Gmail modal when navigated from the empty-state CTA (?gmail=1)
  useEffect(() => {
    if (searchParams.get("gmail") === "1") {
      handleOpenGmailModal();
      router.replace("/shows");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleGmailResult = useCallback((index: number) => {
    setGmailBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const handleAddSelectedGmail = useCallback(async () => {
    setGmailAdding(true);
    setGmailAddedCount(0);
    const selected = gmailBulkResults.filter((_, i) =>
      gmailBulkSelected.has(i),
    );

    for (const ticket of selected) {
      try {
        await createShow.mutateAsync({
          kind: ticket.kind_hint ?? "concert",
          headliner: { name: ticket.headliner },
          venue: {
            name: ticket.venue_name ?? "Unknown Venue",
            city: ticket.venue_city ?? "Unknown",
            stateRegion: ticket.venue_state ?? undefined,
          },
          date: ticket.date ?? new Date().toISOString().split("T")[0],
          seat: ticket.seat ?? undefined,
          pricePaid: ticket.price ?? undefined,
          ticketCount: ticket.ticket_count ?? 1,
          productionName: ticket.production_name ?? undefined,
          sourceRefs: { gmail: true },
        });
        setGmailAddedCount((prev) => prev + 1);
      } catch {
        // skip failed individual adds
      }
    }

    setGmailAdding(false);
    setGmailModalOpen(false);
    utils.shows.invalidate();
  }, [gmailBulkResults, gmailBulkSelected, createShow, utils]);

  // ---------------------------------------------------------------------------
  // Render: Loading / Error
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {/* skeleton mode/filter header */}
        <div style={{ padding: "14px 36px", borderBottom: "1px solid var(--rule)", flexShrink: 0, height: 52 }} />
        {/* skeleton stats strip */}
        <div style={{ padding: "12px 36px", borderBottom: "1px solid var(--rule)", flexShrink: 0, height: 64, background: "var(--surface)" }} />
        {/* skeleton table rows */}
        <div style={{ flex: 1, minHeight: 0, padding: "12px 36px 24px", overflow: "hidden" }}>
          <div style={{ background: "var(--surface)" }}>
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} style={{ height: 48, borderBottom: "1px solid var(--rule)", background: "var(--surface)" }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300, fontFamily: "var(--font-geist-mono), monospace", fontSize: "0.85rem", color: "var(--kind-theatre)" }}>
        Failed to load shows.
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Mode counts for header
  // ---------------------------------------------------------------------------

  const modeCounts = {
    list: String(totalShows),
    calendar: `${ticketedCount + watchingCount} up`,
    stats: `${allYears.length} yrs`,
  };

  // ---------------------------------------------------------------------------
  // Render: Header
  // ---------------------------------------------------------------------------

  function renderHeader() {
    const modes: { k: ViewMode; l: string; Ic: React.ComponentType<{ size?: number; color?: string }>; count: string }[] = [
      { k: "list", l: "List", Ic: Archive, count: modeCounts.list },
      { k: "calendar", l: "Calendar", Ic: Calendar, count: modeCounts.calendar },
      { k: "stats", l: "Stats", Ic: ArrowDownUp, count: modeCounts.stats },
    ];

    return (
      <div style={{
        padding: isMobile ? "14px 16px" : "16px 36px",
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        alignItems: isMobile ? "stretch" : "center",
        justifyContent: "space-between",
        gap: isMobile ? 12 : 0,
        borderBottom: "1px solid var(--rule)",
      }}>
        <div>
          <div style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10.5,
            color: "var(--muted)",
            letterSpacing: ".1em",
            textTransform: "uppercase",
          }}>
            All shows &middot; one stream
          </div>
          <div style={{
            fontFamily: "var(--font-display)",
            fontSize: 26,
            fontWeight: 700,
            color: "var(--ink)",
            letterSpacing: "-0.01em",
            lineHeight: 1.1,
            marginTop: 4,
          }}>
            Shows
          </div>
        </div>
        <div style={{
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          alignItems: isMobile ? "stretch" : "center",
          gap: isMobile ? 8 : 12,
        }}>
          <button
            onClick={handleOpenGmailModal}
            style={{
              border: "1px solid var(--rule-strong)",
              cursor: "pointer",
              background: "transparent",
              color: "var(--ink)",
              padding: "10px 16px",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: -0.2,
              display: "flex",
              alignItems: "center",
              justifyContent: isMobile ? "center" : "flex-start",
              gap: 7,
            }}
          >
            <Mail size={14} />
            <span>Import from Gmail</span>
          </button>
          {totalShows > 0 && (
            <button
              onClick={handleDeleteAll}
              disabled={deleteAllShows.isPending}
              style={{
                border: "1px solid var(--kind-theatre)",
                cursor: deleteAllShows.isPending ? "not-allowed" : "pointer",
                background: "transparent",
                color: "var(--kind-theatre)",
                padding: "10px 16px",
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 13,
                fontWeight: 500,
                letterSpacing: -0.2,
                display: "flex",
                alignItems: "center",
                gap: 7,
                opacity: deleteAllShows.isPending ? 0.5 : 1,
              }}
            >
              <Trash2 size={14} />
              <span>{deleteAllShows.isPending ? "Deleting..." : "Delete All"}</span>
            </button>
          )}
          <div style={{ display: "flex", alignItems: "stretch", border: "1px solid var(--rule-strong)" }}>
            {modes.map(({ k, l, Ic, count }, i) => {
              const active = k === viewMode;
              return (
                <button
                  key={k}
                  onClick={() => setViewMode(k)}
                  style={{
                    border: "none",
                    cursor: "pointer",
                    borderRight: i === modes.length - 1 ? "none" : "1px solid var(--rule-strong)",
                    background: active ? "var(--ink)" : "transparent",
                    color: active ? "var(--bg)" : "var(--ink)",
                    padding: isMobile ? "10px 12px" : "10px 18px",
                    fontFamily: "var(--font-geist-sans), sans-serif",
                    fontSize: 14,
                    fontWeight: active ? 600 : 500,
                    letterSpacing: -0.2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    flex: isMobile ? 1 : "0 0 auto",
                  }}
                >
                  <Ic size={14} />
                  <span>{l}</span>
                  <span style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 10.5,
                    color: active ? "var(--bg)" : "var(--faint)",
                    opacity: active ? 0.7 : 1,
                    letterSpacing: ".04em",
                    fontWeight: 400,
                  }}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Filter Bar
  // ---------------------------------------------------------------------------

  function renderFilterBar() {
    return (
      <div style={{
        padding: isMobile ? "11px 16px" : "11px 36px",
        display: "flex",
        alignItems: "center",
        gap: isMobile ? 12 : 18,
        flexWrap: "wrap",
        background: "var(--surface)",
        borderBottom: "1px solid var(--rule)",
      }}>
        {/* Year buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid var(--rule-strong)" }}>
          {yearButtons.map((y, i, arr) => {
            const active = y === selectedYear;
            return (
              <div
                key={y}
                onClick={() => setSelectedYear(y)}
                style={{
                  padding: "5px 11px",
                  borderRight: i === arr.length - 1 ? "none" : "1px solid var(--rule-strong)",
                  background: active ? "var(--ink)" : "transparent",
                  color: active ? "var(--bg)" : "var(--ink)",
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11,
                  fontWeight: active ? 500 : 400,
                  cursor: "pointer",
                  letterSpacing: ".02em",
                }}
              >
                {y}
              </div>
            );
          })}
        </div>

        {/* Kind chips */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {ALL_KINDS.map((k) => {
            const KIcon = KIND_ICONS[k];
            const active = selectedKind === k;
            return (
              <span
                key={k}
                onClick={() => setSelectedKind(active ? null : k)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 9px",
                  border: "1px solid var(--rule-strong)",
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 10.5,
                  color: active ? "var(--bg)" : "var(--ink)",
                  background: active ? "var(--ink)" : "transparent",
                  letterSpacing: ".04em",
                  cursor: "pointer",
                  textTransform: "lowercase",
                }}
              >
                <KIcon size={12} color={active ? "var(--bg)" : `var(--kind-${k})`} />
                {KIND_LABELS[k]}
              </span>
            );
          })}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Filtered count */}
        <div style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 10.5,
          color: "var(--faint)",
          letterSpacing: ".04em",
        }}>
          {filteredShows.length} show{filteredShows.length !== 1 ? "s" : ""}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Detail Panel
  // ---------------------------------------------------------------------------

  function renderDetailPanel(show: ShowData) {
    const support = getSupport(show);
    const neighborhood = getNeighborhood(show);
    const dateParts = toDateParts(show.date);
    const days = daysUntil(show.date);
    const countdown = show.state !== "past" && days > 0 ? `in ${days} day${days !== 1 ? "s" : ""}` : null;
    const transition = STATE_TRANSITIONS[show.state];

    return (
      <div style={{
        background: "var(--surface2)",
        borderBottom: "1px solid var(--rule)",
        padding: "20px 24px 20px 34px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr 1fr",
        gap: 24,
      }}>
        {/* Column 1: Details */}
        <div>
          <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 9.5, color: "var(--faint)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 6 }}>
            Details
          </div>
          <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 20, fontWeight: 600, color: "var(--ink)", letterSpacing: -0.5, lineHeight: 1.1 }}>
            {(() => {
              const hlId = getHeadlinerId(show);
              const name = getHeadliner(show);
              return hlId ? (
                <Link
                  href={`/artists/${hlId}`}
                  style={{ color: "inherit", textDecoration: "none" }}
                  onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                  onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                >
                  {name}
                </Link>
              ) : name;
            })()}
          </div>
          {support.length > 0 && (
            <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 12.5, color: "var(--muted)", marginTop: 5 }}>
              with{" "}
              {(() => {
                const supportRich = getSupportPerformers(show);
                return support.map((name, i) => {
                  const id = supportRich.find((p) => p.name === name)?.id;
                  return (
                    <span key={`${name}-${i}`}>
                      {id ? (
                        <Link
                          href={`/artists/${id}`}
                          style={{ color: "inherit", textDecoration: "none" }}
                          onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                          onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                        >
                          {name}
                        </Link>
                      ) : (
                        name
                      )}
                      {i < support.length - 1 ? ", " : ""}
                    </span>
                  );
                });
              })()}
            </div>
          )}
          {show.tourName && (
            <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--muted)", marginTop: 8, letterSpacing: ".04em" }}>
              {show.tourName}
            </div>
          )}
        </div>

        {/* Column 2: Venue */}
        <div>
          <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 9.5, color: "var(--faint)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 6 }}>
            Venue
          </div>
          <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 14, fontWeight: 500, color: "var(--ink)", display: "flex", alignItems: "center", gap: 6 }}>
            <Link
              href={`/venues/${show.venue.id}`}
              style={{ color: "inherit", textDecoration: "none" }}
              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
            >
              {show.venue.name}
            </Link>
            {(show.venue.latitude == null || show.venue.longitude == null) && (
              <span title="No coordinates — won't appear on map" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--kind-theatre)", flexShrink: 0, opacity: 0.7 }} />
            )}
          </div>
          {neighborhood && (
            <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--muted)", marginTop: 3 }}>
              {neighborhood.toLowerCase()}
            </div>
          )}
          {show.seat && (
            <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--muted)", marginTop: 6 }}>
              <span style={{ color: "var(--faint)" }}>seat</span> {show.seat}
            </div>
          )}
        </div>

        {/* Column 3: Date */}
        <div>
          <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 9.5, color: "var(--faint)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 6 }}>
            Date
          </div>
          <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 14, fontWeight: 500, color: "var(--ink)", fontFeatureSettings: '"tnum"' }}>
            {dateParts.dow}, {dateParts.month} {dateParts.day}, {dateParts.year}
          </div>
          {countdown && (
            <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--accent)", marginTop: 4 }}>
              {countdown}
            </div>
          )}
          {show.pricePaid && (
            <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--muted)", marginTop: 6 }}>
              <span style={{ color: "var(--faint)" }}>paid</span> ${parseFloat(show.pricePaid).toFixed(0)}
              {show.ticketCount > 1 && (
                <span style={{ color: "var(--faint)" }}> · ${(parseFloat(show.pricePaid) / show.ticketCount).toFixed(0)}/ea × {show.ticketCount}</span>
              )}
            </div>
          )}
        </div>

        {/* Column 4: Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
          <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 9.5, color: "var(--faint)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 2 }}>
            Actions
          </div>
          {show.state === "watching" && show.ticketUrl && (
            <a
              href={show.ticketUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: "8px 14px",
                background: "var(--accent)",
                color: "var(--accent-text)",
                border: "none",
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 12.5,
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
                textDecoration: "none",
              }}
            >
              <ArrowUpRight size={13} /> Tix
            </a>
          )}
          {show.state === "watching" && !show.ticketUrl && (
            <button
              onClick={() => {
                const url = prompt("Paste ticket URL:");
                if (url) {
                  setTicketUrl.mutate({ showId: show.id, ticketUrl: url });
                }
              }}
              style={{
                padding: "8px 14px",
                background: "transparent",
                border: "1px solid var(--rule-strong)",
                color: "var(--ink)",
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 12.5,
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
              }}
            >
              <Link2 size={13} /> Link tickets
            </button>
          )}
          {show.state === "watching" && (
            <button
              onClick={() => handleStateTransition(show)}
              style={{
                padding: "8px 14px",
                background: show.ticketUrl ? "transparent" : "var(--accent)",
                color: show.ticketUrl ? "var(--ink)" : "var(--accent-text)",
                border: show.ticketUrl ? "1px solid var(--rule-strong)" : "none",
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 12.5,
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
              }}
            >
              <Ticket size={13} /> Got tickets
            </button>
          )}
          {transition && show.state === "ticketed" && (
            <button
              onClick={() => handleStateTransition(show)}
              style={{
                padding: "8px 14px",
                background: "var(--accent)",
                color: "var(--accent-text)",
                border: "none",
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 12.5,
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
              }}
            >
              {transition.label}
            </button>
          )}
          <button
            onClick={() => router.push(`/add?editId=${show.id}`)}
            style={{
              padding: "8px 14px",
              background: "transparent",
              border: "1px solid var(--rule-strong)",
              color: "var(--ink)",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 12.5,
              fontWeight: 500,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
            }}
          >
            <MoreHorizontal size={13} /> Edit
          </button>
          <button
            onClick={() => handleDelete(show.id)}
            style={{
              padding: "8px 14px",
              background: "transparent",
              border: "1px solid var(--rule-strong)",
              color: "#E63946",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 12.5,
              fontWeight: 500,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
            }}
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: List Mode
  // ---------------------------------------------------------------------------

  function renderList() {
    if (filteredShows.length === 0) {
      return (
        <div style={{ padding: isMobile ? "20px 16px" : "28px 36px" }}>
          <EmptyState
            kind="shows"
            title="Start your logbook"
            body="Add the first show you saw, the next one you are watching, or import ticket history from Gmail."
            action={
              <div
                style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}
              >
                <button
                  type="button"
                  onClick={handleOpenGmailModal}
                  style={{
                    padding: "10px 18px",
                    background: "var(--accent)",
                    color: "var(--accent-text)",
                    border: "none",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 11,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    fontWeight: 500,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Image src="/google-g.svg" alt="" width={14} height={14} />
                  Import from Gmail
                </button>
                <Link
                  href="/discover"
                  style={{
                    padding: "10px 18px",
                    background: "transparent",
                    color: "var(--ink)",
                    border: "1px solid var(--rule-strong)",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 11,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    fontWeight: 500,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    textDecoration: "none",
                  }}
                >
                  <Eye size={13} />
                  Find shows in Discover
                </Link>
              </div>
            }
          />
        </div>
      );
    }

    return (
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
        {/* Section label */}
        <div style={{ padding: isMobile ? "16px 16px 8px" : "18px 36px 8px", display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <div style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 11,
            color: "var(--ink)",
            letterSpacing: ".1em",
            textTransform: "uppercase",
            fontWeight: 500,
          }}>
            All shows &middot; {filteredShows.length}
          </div>
          <div style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10.5,
            color: "var(--faint)",
          }}>
            {ticketedCount} tix &middot; {watchingCount} watching &middot; {pastCount} past
          </div>
        </div>

        {/* Show list */}
        <div className="shows-list-table" style={{ margin: isMobile ? "4px 12px 0" : "4px 36px 0", background: "var(--surface)" }}>
          {/* Column headers */}
          <div style={{
            display: "grid",
            gridTemplateColumns: SHOW_LIST_GRID_TEMPLATE,
            columnGap: 16,
            padding: "10px 20px 10px 10px",
            borderBottom: "1px solid var(--rule)",
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 9.5,
            color: "var(--faint)",
            letterSpacing: ".12em",
            textTransform: "uppercase",
          }}>
            <div />
            <div />
            <SortHeader field="date" label="Date" sort={sort} onToggle={toggleSort} />
            <SortHeader field="kind" label="Kind" sort={sort} onToggle={toggleSort} />
            <SortHeader field="headliner" label="Headline" sort={sort} onToggle={toggleSort} />
            <SortHeader field="venue" label="Venue" sort={sort} onToggle={toggleSort} />
            <SortHeader field="seat" label="Seat" sort={sort} onToggle={toggleSort} />
            <div />
            <SortHeader field="paid" label="Paid" sort={sort} onToggle={toggleSort} align="right" />
            <SortHeader field="state" label="State" sort={sort} onToggle={toggleSort} align="right" />
          </div>

          {pagedShows.map((show) => (
            <div
              key={show.id}
              data-show-id={show.id}
              onContextMenu={(e) => handleContextMenu(e, show)}
            >
              <ShowRow
                show={{
                  kind: show.kind,
                  state: show.state,
                  headliner: getHeadliner(show),
                  headlinerId: getHeadlinerId(show),
                  imageUrl: getHeadlinerImageUrl(show),
                  support: getSupport(show),
                  supportPerformers: getSupportPerformers(show),
                  venue: show.venue.name,
                  venueId: show.venue.id,
                  showId: show.id,
                  neighborhood: getNeighborhood(show),
                  date: toDateParts(show.date),
                  seat: show.seat ?? undefined,
                  paid: show.pricePaid ? parseFloat(show.pricePaid) : undefined,
                  ticketCount: show.ticketCount,
                }}
                missingCoords={show.venue.latitude == null || show.venue.longitude == null}
                hideChevron
              />
            </div>
          ))}
        </div>

        <PaginationFooter
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={PAGE_SIZE}
          totalItems={filteredShows.length}
          itemLabel="shows"
          onPageChange={setCurrentPage}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Calendar Mode
  // ---------------------------------------------------------------------------

  function renderCalendar() {
    const today = new Date();

    // Compute bounds from all shows
    const allDates = shows.map((s) => new Date(s.date + "T00:00:00"));
    const calMin = allDates.length > 0
      ? { year: Math.min(...allDates.map((d) => d.getFullYear())), month: allDates.reduce((a, b) => a < b ? a : b).getMonth() }
      : null;
    const calMax = allDates.length > 0
      ? { year: Math.max(...allDates.map((d) => d.getFullYear())), month: allDates.reduce((a, b) => a > b ? a : b).getMonth() }
      : null;

    // More precise bounds: earliest and latest show dates
    const minDate = allDates.length > 0 ? allDates.reduce((a, b) => a < b ? a : b) : null;
    const maxDate = allDates.length > 0 ? allDates.reduce((a, b) => a > b ? a : b) : null;

    const atMin = minDate && calYear === minDate.getFullYear() && calMonth === minDate.getMonth();
    const atMax = maxDate && calYear === maxDate.getFullYear() && calMonth === maxDate.getMonth();

    const goToday = () => {
      setCalMonth(today.getMonth());
      setCalYear(today.getFullYear());
    };

    const stepMonth = (dir: number) => {
      const m = calMonth + dir;
      if (m < 0) {
        setCalMonth(11);
        setCalYear((y) => y - 1);
      } else if (m > 11) {
        setCalMonth(0);
        setCalYear((y) => y + 1);
      } else {
        setCalMonth(m);
      }
    };

    const dows = ["S", "M", "T", "W", "T", "F", "S"];

    // Build day -> shows map for any given year/month
    function buildDayShowsMap(year: number, month: number) {
      const map = new Map<number, ShowData[]>();
      for (const show of shows) {
        const d = new Date(show.date + "T00:00:00");
        if (d.getMonth() === month && d.getFullYear() === year) {
          const day = d.getDate();
          if (!map.has(day)) map.set(day, []);
          map.get(day)!.push(show);
        }
      }
      return map;
    }

    // Toolbar buttons
    const toolbarNav = (
      <div style={{ display: "flex", alignItems: "stretch", border: "1px solid var(--rule-strong)" }}>
        <button
          onClick={() => stepMonth(-1)}
          disabled={Boolean(atMin)}
          style={{
            padding: "7px 12px",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 13,
            color: atMin ? "var(--faint)" : "var(--ink)",
            cursor: atMin ? "not-allowed" : "pointer",
            border: "none",
            borderRight: "1px solid var(--rule-strong)",
            background: "transparent",
            fontWeight: 500,
            opacity: atMin ? 0.4 : 1,
          }}
          data-testid="cal-prev"
        >
          ‹
        </button>
        <button onClick={goToday} style={{
          padding: "7px 14px",
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: 13,
          color: "var(--ink)",
          cursor: "pointer",
          border: "none",
          borderRight: "1px solid var(--rule-strong)",
          background: "transparent",
          fontWeight: 500,
        }}>
          Today
        </button>
        <button
          onClick={() => stepMonth(1)}
          disabled={Boolean(atMax)}
          style={{
            padding: "7px 12px",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 13,
            color: atMax ? "var(--faint)" : "var(--ink)",
            cursor: atMax ? "not-allowed" : "pointer",
            border: "none",
            background: "transparent",
            fontWeight: 500,
            opacity: atMax ? 0.4 : 1,
          }}
          data-testid="cal-next"
        >
          ›
        </button>
      </div>
    );

    const viewToggle = (
      <div style={{ display: "flex", alignItems: "stretch", border: "1px solid var(--rule-strong)" }}>
        {(["month", "year"] as CalView[]).map((v, i, arr) => {
          const active = calView === v;
          return (
            <button
              key={v}
              onClick={() => setCalView(v)}
              data-testid={`cal-view-${v}`}
              style={{
                padding: "7px 14px",
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                border: "none",
                borderRight: i < arr.length - 1 ? "1px solid var(--rule-strong)" : "none",
                background: active ? "var(--ink)" : "transparent",
                color: active ? "var(--bg)" : "var(--ink)",
                cursor: "pointer",
                fontWeight: active ? 500 : 400,
                letterSpacing: ".06em",
                textTransform: "uppercase",
              }}
            >
              {v}
            </button>
          );
        })}
      </div>
    );

    if (calView === "year") {
      return renderCalendarYearView(today, toolbarNav, viewToggle);
    }

    const daysInMonth = getDaysInMonth(calYear, calMonth);
    const firstDay = getFirstDayOfWeek(calYear, calMonth);
    const dayShowsMap = buildDayShowsMap(calYear, calMonth);

    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7) cells.push(null);

    const isToday = (d: number | null) => d !== null && calYear === today.getFullYear() && calMonth === today.getMonth() && d === today.getDate();

    let pastInMonth = 0, upInMonth = 0, watchInMonth = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dayShows = dayShowsMap.get(d) ?? [];
      for (const s of dayShows) {
        if (s.state === "past") pastInMonth++;
        else if (s.state === "ticketed") upInMonth++;
        else if (s.state === "watching") watchInMonth++;
      }
    }

    const railShows = shows.filter((s) => {
      const d = new Date(s.date + "T00:00:00");
      const m = d.getMonth();
      const y = d.getFullYear();
      return (y === calYear && m === calMonth) || (y === calYear && m === calMonth + 1) || (calMonth === 11 && y === calYear + 1 && m === 0);
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return (
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg)", padding: isMobile ? "18px 16px 24px" : "22px 36px 36px" }}>
        {/* Month toolbar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 30, fontWeight: 600, color: "var(--ink)", letterSpacing: -0.9 }}>
              {MONTH_NAMES[calMonth]} <span style={{ color: "var(--faint)", fontWeight: 400 }}>{calYear}</span>
            </div>
            <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, color: "var(--muted)", letterSpacing: ".06em" }}>
              {pastInMonth} past &middot; {upInMonth} upcoming &middot; {watchInMonth} watching
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {viewToggle}
            {toolbarNav}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 22, minHeight: 0 }}>
          {/* Calendar grid */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--rule)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--rule)" }}>
              {dows.map((d, i) => (
                <div key={i} style={{ padding: "9px 10px", fontFamily: "var(--font-geist-mono), monospace", fontSize: 10, color: "var(--faint)", letterSpacing: ".12em", textTransform: "uppercase" }}>
                  {d}
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gridAutoRows: "minmax(92px, 1fr)" }}>
              {cells.map((d, i) => {
                const todayCell = isToday(d);
                const evs = d ? (dayShowsMap.get(d) ?? []) : [];
                return (
                  <div key={i} style={{
                    padding: "7px 9px",
                    borderRight: (i % 7) === 6 ? "none" : "1px solid var(--rule)",
                    borderBottom: "1px solid var(--rule)",
                    background: todayCell ? "var(--surface2)" : "transparent",
                    opacity: d ? 1 : 0.35,
                    display: "flex",
                    flexDirection: "column",
                    gap: 5,
                  }}>
                    <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, color: todayCell ? "var(--ink)" : (d ? "var(--muted)" : "var(--faint)"), fontWeight: todayCell ? 600 : 400, letterSpacing: ".02em" }}>
                      {d ?? ""}
                    </div>
                    {evs.map((s) => (
                      <div key={s.id} style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10, color: "var(--ink)", padding: "3px 6px", background: s.state === "past" ? "transparent" : `var(--kind-${s.kind}, rgba(255,255,255,0.1))`, borderLeft: `2px solid var(--kind-${s.kind})`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", letterSpacing: ".01em" }}>
                        {getHeadliner(s)}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right rail */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--ink)", letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 500 }}>
              This month & next
            </div>
            {railShows.map((show) => {
              const dp = toDateParts(show.date);
              const stateTag = show.state === "past" ? "past" : show.state === "ticketed" ? "tix" : "watch";
              return (
                <div key={show.id} style={{ padding: "12px 14px", background: "var(--surface)", borderLeft: `2px solid var(--kind-${show.kind})`, display: "grid", gridTemplateColumns: "58px 1fr auto", columnGap: 12, alignItems: "start" }}>
                  <div>
                    <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 15, fontWeight: 500, color: stateTag === "past" ? "var(--muted)" : "var(--ink)", letterSpacing: -0.3, lineHeight: 1, fontFeatureSettings: '"tnum"' }}>
                      {dp.month} {dp.day}
                    </div>
                    <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 9.5, color: "var(--faint)", marginTop: 3 }}>
                      {dp.dow.toLowerCase()}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 13, fontWeight: 500, color: stateTag === "past" ? "var(--muted)" : "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {getHeadliner(show)}
                    </div>
                    <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10, color: "var(--muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {show.venue.name.toLowerCase()}
                    </div>
                  </div>
                  <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 9.5, letterSpacing: ".06em", textTransform: "uppercase", color: stateTag === "past" ? "var(--faint)" : (stateTag === "watch" ? "var(--muted)" : "var(--ink)"), fontWeight: 500 }}>
                    {stateTag}
                  </div>
                </div>
              );
            })}
            {railShows.length === 0 && (
              <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--faint)" }}>
                No shows this month or next
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderCalendarYearView(
    today: Date,
    toolbarNav: React.ReactNode,
    viewToggle: React.ReactNode,
  ) {
    // Build all-shows-by-date map
    const dateShowsMap = new Map<string, ShowData[]>();
    for (const show of shows) {
      const key = show.date; // "YYYY-MM-DD"
      if (!dateShowsMap.has(key)) dateShowsMap.set(key, []);
      dateShowsMap.get(key)!.push(show);
    }

    const YEAR_MONTHS = Array.from({ length: 12 }, (_, i) => i);
    const dows = ["S", "M", "T", "W", "T", "F", "S"];

    function miniMonthGrid(year: number, month: number) {
      const daysInMonth = getDaysInMonth(year, month);
      const firstDay = getFirstDayOfWeek(year, month);
      const cells: (number | null)[] = [];
      for (let i = 0; i < firstDay; i++) cells.push(null);
      for (let d = 1; d <= daysInMonth; d++) cells.push(d);
      while (cells.length % 7) cells.push(null);

      const isThisMonth = year === today.getFullYear() && month === today.getMonth();

      return (
        <div
          key={month}
          data-testid={`year-mini-grid-${month}`}
          style={{
            background: "var(--surface)",
            border: isThisMonth ? "1px solid var(--accent)" : "1px solid var(--rule)",
            padding: "8px",
            cursor: "pointer",
          }}
          onClick={() => {
            setCalMonth(month);
            setCalYear(year);
            setCalView("month");
          }}
        >
          <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 9, color: "var(--ink)", letterSpacing: ".08em", textTransform: "uppercase", fontWeight: 500, marginBottom: 4 }}>
            {MONTHS[month]}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1 }}>
            {dows.map((d, i) => (
              <div key={i} style={{ fontSize: 6, color: "var(--faint)", textAlign: "center", fontFamily: "var(--font-geist-mono), monospace" }}>
                {d}
              </div>
            ))}
            {cells.map((d, ci) => {
              const dateKey = d ? `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
              const hasDot = dateKey ? (dateShowsMap.get(dateKey) ?? []).length > 0 : false;
              const isToday = d !== null && year === today.getFullYear() && month === today.getMonth() && d === today.getDate();
              return (
                <div key={ci} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 10, position: "relative" }}>
                  {d && (
                    <>
                      {isToday && (
                        <div style={{ position: "absolute", inset: 0, background: "var(--accent)", opacity: 0.15, borderRadius: 1 }} />
                      )}
                      {hasDot && (
                        <div style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--accent)" }} />
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    return (
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg)", padding: isMobile ? "18px 16px 24px" : "22px 36px 36px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 30, fontWeight: 600, color: "var(--ink)", letterSpacing: -0.9 }}>
            {calYear}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {viewToggle}
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setCalYear((y) => y - 1)} style={{ padding: "7px 12px", border: "1px solid var(--rule-strong)", background: "transparent", color: "var(--ink)", cursor: "pointer", fontFamily: "var(--font-geist-mono), monospace", fontSize: 11 }}>
                ‹ {calYear - 1}
              </button>
              <button onClick={() => setCalYear((y) => y + 1)} style={{ padding: "7px 12px", border: "1px solid var(--rule-strong)", background: "transparent", color: "var(--ink)", cursor: "pointer", fontFamily: "var(--font-geist-mono), monospace", fontSize: 11 }}>
                {calYear + 1} ›
              </button>
            </div>
          </div>
        </div>
        <div
          data-testid="year-view-grid"
          style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}
        >
          {YEAR_MONTHS.map((m) => miniMonthGrid(calYear, m))}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Stats Mode
  // ---------------------------------------------------------------------------

  function renderStats() {
    const rawShows = (allShowsUnfiltered ?? []) as ShowData[];
    const currentYear = new Date().getFullYear();
    const allShowsList = rawShows.filter((s) => {
      if (statsTimeframe === "all") return true;
      const y = getYear(s.date);
      if (statsTimeframe === "year") return y === currentYear;
      if (statsTimeframe === "5years") return y >= currentYear - 4;
      return true;
    });
    const total = allShowsList.length;

    // Compute stats
    const totalSpent = allShowsList.reduce((sum, s) => sum + (s.pricePaid ? parseFloat(s.pricePaid) : 0), 0);
    const avgPerShow = total > 0 ? Math.round(totalSpent / total) : 0;

    const uniqueVenues = new Set(allShowsList.map((s) => s.venue.name)).size;
    const uniqueArtists = new Set(allShowsList.flatMap((s) => s.showPerformers.map((sp) => sp.performer.name))).size;

    const newArtistsThisYear = (() => {
      const thisYearArtists = new Set(
        allShowsList
          .filter((s) => getYear(s.date) === currentYear)
          .flatMap((s) => s.showPerformers.map((sp) => sp.performer.name))
      );
      const prevArtists = new Set(
        allShowsList
          .filter((s) => getYear(s.date) < currentYear)
          .flatMap((s) => s.showPerformers.map((sp) => sp.performer.name))
      );
      return Array.from(thisYearArtists).filter((a) => !prevArtists.has(a)).length;
    })();

    // Venues in rotation (appeared in last 2 years)
    const rotationVenues = new Set(
      allShowsList
        .filter((s) => getYear(s.date) >= currentYear - 1)
        .map((s) => s.venue.name)
    ).size;

    // Rhythm chart — shows per month in current year
    const rhythm = MONTHS.map((_, i) => {
      const monthShows = allShowsList.filter((s) => {
        const d = new Date(s.date + "T00:00:00");
        return d.getFullYear() === currentYear && d.getMonth() === i;
      });
      const attended = monthShows.filter((s) => s.state === "past").length;
      const ticketed = monthShows.filter((s) => s.state === "ticketed").length;
      return { a: attended, t: ticketed };
    });

    const ytdShows = allShowsList.filter((s) => getYear(s.date) === currentYear).length;
    const currentMonth = new Date().getMonth();
    const pace = currentMonth > 0 ? Math.round((ytdShows / (currentMonth + 1)) * 12) : ytdShows * 12;

    // Top artists
    const artistCounts = new Map<string, { count: number; kind: ShowKind }>();
    for (const show of allShowsList) {
      const name = getHeadliner(show);
      const prev = artistCounts.get(name);
      artistCounts.set(name, { count: (prev?.count ?? 0) + 1, kind: show.kind });
    }
    const topArtists = Array.from(artistCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);
    const maxArtistCount = Math.max(...topArtists.map(([, v]) => v.count), 1);

    // Top venues
    const venueCounts = new Map<string, { count: number; neighborhood: string }>();
    for (const show of allShowsList) {
      const name = show.venue.name;
      const prev = venueCounts.get(name);
      venueCounts.set(name, {
        count: (prev?.count ?? 0) + 1,
        neighborhood: getNeighborhood(show) ?? "",
      });
    }
    const topVenues = Array.from(venueCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);
    const maxVenueCount = Math.max(...topVenues.map(([, v]) => v.count), 1);

    // Kind mix
    const kindCounts = new Map<ShowKind, number>();
    for (const show of allShowsList) {
      kindCounts.set(show.kind, (kindCounts.get(show.kind) ?? 0) + 1);
    }
    const kindMix = ALL_KINDS
      .map((k) => ({ kind: k, count: kindCounts.get(k) ?? 0 }))
      .filter((k) => k.count > 0)
      .sort((a, b) => b.count - a.count);

    // Superlatives
    const priciest = allShowsList
      .filter((s) => s.pricePaid && getYear(s.date) === currentYear)
      .sort((a, b) => parseFloat(b.pricePaid!) - parseFloat(a.pricePaid!));
    const priciestShow = priciest[0];

    const SPARKLINE_MAX = Math.max(maxArtistCount, maxVenueCount, 8);

    const timeframeLabel = statsTimeframe === "year"
      ? String(currentYear)
      : statsTimeframe === "5years"
        ? `${currentYear - 4}–${currentYear}`
        : "All time";

    return (
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg)", padding: isMobile ? "18px 16px 24px" : "22px 36px 36px" }}>
        {/* Timeframe selector */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, color: "var(--muted)", letterSpacing: ".06em" }}>
            {timeframeLabel} &middot; {total} show{total !== 1 ? "s" : ""}
          </div>
          <div style={{ display: "flex", alignItems: "stretch", border: "1px solid var(--rule-strong)" }}>
            {([
              { k: "year" as StatsTimeframe, l: "This year" },
              { k: "5years" as StatsTimeframe, l: "Last 5 years" },
              { k: "all" as StatsTimeframe, l: "All time" },
            ]).map(({ k, l }, i, arr) => {
              const active = statsTimeframe === k;
              return (
                <button
                  key={k}
                  onClick={() => setStatsTimeframe(k)}
                  data-testid={`stats-timeframe-${k}`}
                  style={{
                    padding: "6px 13px",
                    border: "none",
                    borderRight: i < arr.length - 1 ? "1px solid var(--rule-strong)" : "none",
                    background: active ? "var(--ink)" : "transparent",
                    color: active ? "var(--bg)" : "var(--ink)",
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 11,
                    fontWeight: active ? 500 : 400,
                    cursor: "pointer",
                    letterSpacing: ".04em",
                  }}
                >
                  {l}
                </button>
              );
            })}
          </div>
        </div>

        {/* Big headline numbers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: "var(--rule)", marginBottom: 22 }}>
          {[
            [String(total), "shows", "all time"],
            [totalSpent > 0 ? `$${totalSpent.toLocaleString()}` : "$0", "spent", `avg $${avgPerShow} / show`],
            [String(uniqueVenues), "venues", `${rotationVenues} in rotation`],
            [String(uniqueArtists), "artists", `+ ${newArtistsThisYear} new in ${currentYear}`],
          ].map(([v, l, sub]) => (
            <div key={l} style={{ background: "var(--surface)", padding: "22px 22px 20px" }}>
              <div style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 44,
                fontWeight: 500,
                color: "var(--ink)",
                letterSpacing: -1.6,
                lineHeight: 0.95,
                fontFeatureSettings: '"tnum"',
              }}>
                {v}
              </div>
              <div style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                color: "var(--ink)",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                marginTop: 10,
                fontWeight: 500,
              }}>
                {l}
              </div>
              <div style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10.5,
                color: "var(--faint)",
                marginTop: 3,
              }}>
                {sub}
              </div>
            </div>
          ))}
        </div>

        {/* Rhythm chart */}
        <div style={{ background: "var(--surface)", padding: "22px 26px", marginBottom: 22 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
            <div>
              <div style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                color: "var(--ink)",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                fontWeight: 500,
              }}>
                Rhythm &middot; {currentYear}
              </div>
              <div style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10.5,
                color: "var(--faint)",
                marginTop: 4,
              }}>
                {ytdShows} shows year-to-date &middot; pace for ~{pace}
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--muted)" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 9, height: 9, background: "var(--ink)" }} /> attended
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Square size={9} color="var(--ink)" /> ticketed
              </span>
            </div>
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(12, 1fr)",
            gap: 6,
            alignItems: "end",
            height: 96,
            position: "relative",
          }}>
            {rhythm.map((m, i) => {
              const isNow = i === currentMonth;
              return (
                <div key={i} style={{ display: "flex", flexDirection: "column-reverse", gap: 2, height: "100%", position: "relative" }}>
                  {Array.from({ length: m.a }).map((_, j) => (
                    <div key={"a" + j} style={{ height: 18, background: "var(--ink)" }} />
                  ))}
                  {Array.from({ length: m.t }).map((_, j) => (
                    <div key={"t" + j} style={{ height: 18, border: "1.25px solid var(--ink)", background: "transparent" }} />
                  ))}
                  {isNow && (
                    <div style={{
                      position: "absolute",
                      top: -16,
                      left: "50%",
                      transform: "translateX(-50%)",
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 9,
                      color: "var(--kind-concert)",
                      letterSpacing: ".1em",
                      whiteSpace: "nowrap",
                      fontWeight: 500,
                    }}>
                      TODAY
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 6, marginTop: 10 }}>
            {MONTHS.map((m, i) => (
              <div key={i} style={{
                textAlign: "center",
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10,
                color: i === currentMonth ? "var(--ink)" : "var(--faint)",
                letterSpacing: ".06em",
                fontWeight: i === currentMonth ? 500 : 400,
              }}>
                {m}
              </div>
            ))}
          </div>
        </div>

        {/* Three columns: Most seen / Most frequented / By kind */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 340px", gap: 22 }}>
          {/* Most seen artists */}
          <div style={{ background: "var(--surface)", padding: "22px 22px 18px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                color: "var(--ink)",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                fontWeight: 500,
              }}>
                Most seen
              </div>
              <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--faint)" }}>
                all time
              </div>
            </div>
            {topArtists.map(([name, { count, kind }]) => (
              <div key={name} style={{
                display: "grid",
                gridTemplateColumns: "1fr 80px 30px",
                columnGap: 14,
                alignItems: "center",
                padding: "11px 0",
                borderBottom: "1px solid var(--rule)",
              }}>
                <div style={{
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: 14,
                  color: "var(--ink)",
                  letterSpacing: -0.1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {name}
                </div>
                <div style={{ display: "flex", gap: 2 }}>
                  {Array.from({ length: SPARKLINE_MAX }).map((_, i) => (
                    <div key={i} style={{
                      height: 9,
                      flex: 1,
                      background: i < count ? `var(--kind-${kind})` : "transparent",
                      border: i < count ? "none" : "1px solid var(--rule-strong)",
                    }} />
                  ))}
                </div>
                <div style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11.5,
                  color: "var(--ink)",
                  textAlign: "right",
                  fontWeight: 500,
                }}>
                  {count}&times;
                </div>
              </div>
            ))}
            {topArtists.length === 0 && (
              <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--faint)" }}>No data</div>
            )}
          </div>

          {/* Most frequented venues */}
          <div style={{ background: "var(--surface)", padding: "22px 22px 18px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                color: "var(--ink)",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                fontWeight: 500,
              }}>
                Most frequented
              </div>
              <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--faint)" }}>
                venues &middot; all time
              </div>
            </div>
            {topVenues.map(([name, { count, neighborhood }]) => (
              <div key={name} style={{
                display: "grid",
                gridTemplateColumns: "1fr 80px 30px",
                columnGap: 14,
                alignItems: "center",
                padding: "11px 0",
                borderBottom: "1px solid var(--rule)",
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontFamily: "var(--font-geist-sans), sans-serif",
                    fontSize: 14,
                    color: "var(--ink)",
                    letterSpacing: -0.1,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}>
                    {name}
                  </div>
                  <div style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 10,
                    color: "var(--muted)",
                    marginTop: 2,
                  }}>
                    {neighborhood.toLowerCase()}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 2 }}>
                  {Array.from({ length: SPARKLINE_MAX }).map((_, i) => (
                    <div key={i} style={{
                      height: 9,
                      flex: 1,
                      background: i < count ? "var(--ink)" : "transparent",
                      border: i < count ? "none" : "1px solid var(--rule-strong)",
                    }} />
                  ))}
                </div>
                <div style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11.5,
                  color: "var(--ink)",
                  textAlign: "right",
                  fontWeight: 500,
                }}>
                  {count}
                </div>
              </div>
            ))}
            {topVenues.length === 0 && (
              <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--faint)" }}>No data</div>
            )}
          </div>

          {/* Kind mix */}
          <div style={{ background: "var(--surface)", padding: "22px 22px 18px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                color: "var(--ink)",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                fontWeight: 500,
              }}>
                By kind
              </div>
              <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--faint)" }}>
                all {total}
              </div>
            </div>
            {kindMix.map(({ kind, count }) => {
              const KIcon = KIND_ICONS[kind];
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div key={kind} style={{ padding: "12px 0", borderBottom: "1px solid var(--rule)" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 11,
                      color: `var(--kind-${kind})`,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      fontWeight: 500,
                    }}>
                      <KIcon size={13} color={`var(--kind-${kind})`} />
                      {KIND_LABELS[kind]}
                    </span>
                    <span style={{
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 11,
                      color: "var(--ink)",
                      fontWeight: 500,
                    }}>
                      {count} &middot; {pct}%
                    </span>
                  </div>
                  <div style={{ height: 6, background: "var(--surface2)" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: `var(--kind-${kind})` }} />
                  </div>
                </div>
              );
            })}
            {kindMix.length === 0 && (
              <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--faint)" }}>No data</div>
            )}
          </div>
        </div>

        {/* Superlatives strip */}
        <div style={{ marginTop: 22, background: "var(--surface)", padding: "20px 26px" }}>
          <div style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 11,
            color: "var(--ink)",
            letterSpacing: ".1em",
            textTransform: "uppercase",
            fontWeight: 500,
            marginBottom: 14,
          }}>
            Superlatives &middot; {currentYear}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 24 }}>
            {(() => {
              const thisYearShows = allShowsList.filter((s) => getYear(s.date) === currentYear);

              // Priciest
              const priciest = thisYearShows
                .filter((s) => s.pricePaid)
                .sort((a, b) => parseFloat(b.pricePaid!) - parseFloat(a.pricePaid!))[0];
              const priciestVal = priciest ? `$${parseFloat(priciest.pricePaid!).toFixed(0)}` : "--";
              const priciestSub = priciest ? `${getHeadliner(priciest)} · ${toDateParts(priciest.date).month} ${toDateParts(priciest.date).day}` : "";

              // Total spent this year
              const yearSpent = thisYearShows.reduce((s, sh) => s + (sh.pricePaid ? parseFloat(sh.pricePaid) : 0), 0);

              // Cheapest
              const cheapest = thisYearShows
                .filter((s) => s.pricePaid && parseFloat(s.pricePaid) > 0)
                .sort((a, b) => parseFloat(a.pricePaid!) - parseFloat(b.pricePaid!))[0];
              const cheapestVal = cheapest ? `$${parseFloat(cheapest.pricePaid!).toFixed(0)}` : "--";
              const cheapestSub = cheapest ? `${getHeadliner(cheapest)} · ${toDateParts(cheapest.date).month} ${toDateParts(cheapest.date).day}` : "";

              // Most shows in a month
              const monthCounts = new Map<number, number>();
              for (const s of thisYearShows) {
                const m = new Date(s.date + "T00:00:00").getMonth();
                monthCounts.set(m, (monthCounts.get(m) ?? 0) + 1);
              }
              const bestMonth = Array.from(monthCounts.entries()).sort((a, b) => b[1] - a[1])[0];
              const bestMonthVal = bestMonth ? `${bestMonth[1]}` : "--";
              const bestMonthSub = bestMonth ? `${MONTH_NAMES[bestMonth[0]]}` : "";

              return [
                ["Priciest", priciestVal, priciestSub],
                ["Cheapest", cheapestVal, cheapestSub],
                ["Best month", bestMonthVal, bestMonthSub],
                [`${currentYear} spent`, yearSpent > 0 ? `$${yearSpent.toLocaleString()}` : "--", `${thisYearShows.length} shows`],
              ];
            })().map(([l, v, sub]) => (
              <div key={l}>
                <div style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 10,
                  color: "var(--faint)",
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                }}>
                  {l}
                </div>
                <div style={{
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: 26,
                  fontWeight: 500,
                  color: "var(--ink)",
                  letterSpacing: -0.7,
                  marginTop: 6,
                  fontFeatureSettings: '"tnum"',
                }}>
                  {v}
                </div>
                <div style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 10.5,
                  color: "var(--muted)",
                  marginTop: 4,
                }}>
                  {sub}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Page
  // ---------------------------------------------------------------------------

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {renderHeader()}
      {renderFilterBar()}

      {viewMode === "list" && renderList()}
      {viewMode === "calendar" && renderCalendar()}
      {viewMode === "stats" && renderStats()}

      {/* Show row context menu + watching → ticketed transition modal */}
      {showContextMenuPortal}

      {/* Gmail bulk scan modal */}
      {gmailModalOpen && (
        <div
          onClick={() => setGmailModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg)",
              border: "1px solid var(--rule)",
              width: "100%",
              maxWidth: 640,
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Modal header */}
            <div style={{
              padding: "16px 20px",
              borderBottom: "1px solid var(--rule)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
              <div>
                <div style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 17,
                  fontWeight: 700,
                  color: "var(--ink)",
                  letterSpacing: "-0.01em",
                  lineHeight: 1.1,
                }}>
                  Import from Gmail
                </div>
                <div style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 10.5,
                  color: "var(--muted)",
                  letterSpacing: ".04em",
                  marginTop: 2,
                }}>
                  {gmailBulkLoading
                    ? gmailProgress?.phase === "processing"
                      ? `Processing ${gmailProgress.processed} of ${gmailProgress.total} emails · ${gmailProgress.found} tickets found`
                      : "Searching Gmail for ticket emails..."
                    : gmailError
                      ? gmailError
                      : gmailBulkResults.length > 0
                        ? `${gmailBulkResults.length} ticket${gmailBulkResults.length !== 1 ? "s" : ""} found · ${gmailBulkSelected.size} selected`
                        : gmailAccessToken
                          ? "No tickets found"
                          : "Waiting for Gmail authorization..."}
                </div>
              </div>
              <button
                onClick={() => setGmailModalOpen(false)}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  color: "var(--muted)",
                  padding: 4,
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Loading indicator */}
            {gmailBulkLoading && (
              <div style={{
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                borderBottom: gmailBulkResults.length > 0 ? "1px solid var(--rule)" : "none",
              }}>
                <Loader2
                  size={14}
                  color="var(--muted)"
                  style={{ animation: "spin 1s linear infinite" }}
                />
                <span style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11,
                  color: "var(--muted)",
                  letterSpacing: ".04em",
                }}>
                  {gmailProgress?.phase === "processing"
                    ? `Processing ${gmailProgress.processed} of ${gmailProgress.total} · ${gmailProgress.found} found`
                    : "Searching Gmail..."}
                </span>
                {gmailProgress?.phase === "processing" && gmailProgress.total > 0 && (
                  <div style={{
                    flex: 1,
                    height: 3,
                    background: "var(--rule)",
                    borderRadius: 2,
                    overflow: "hidden",
                  }}>
                    <div style={{
                      width: `${Math.round((gmailProgress.processed / gmailProgress.total) * 100)}%`,
                      height: "100%",
                      background: "var(--accent)",
                      borderRadius: 2,
                      transition: "width 0.3s ease",
                    }} />
                  </div>
                )}
                <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
              </div>
            )}

            {/* Results list */}
            {gmailBulkResults.length > 0 && (
              <div style={{
                flex: 1,
                overflowY: "auto",
                minHeight: 0,
              }}>
                {gmailBulkResults.map((ticket, i) => {
                  const dup = isDuplicate(ticket);
                  const selected = gmailBulkSelected.has(i);
                  return (
                    <div
                      key={`${ticket.gmailMessageId}-${i}`}
                      onClick={() => handleToggleGmailResult(i)}
                      style={{
                        padding: "12px 20px",
                        borderTop: i > 0 ? "1px solid var(--rule)" : "none",
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        cursor: "pointer",
                        opacity: dup ? 0.5 : 1,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "var(--surface)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      {/* Checkbox */}
                      <div style={{
                        width: 18,
                        height: 18,
                        border: `1px solid ${selected ? "var(--ink)" : "var(--rule-strong)"}`,
                        background: selected ? "var(--ink)" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}>
                        {selected && <Check size={12} color="var(--bg)" />}
                      </div>

                      {/* Details */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}>
                          <span style={{
                            fontFamily: "var(--font-geist-sans), sans-serif",
                            fontSize: 13,
                            fontWeight: 500,
                            color: "var(--ink)",
                            letterSpacing: -0.1,
                          }}>
                            {ticket.production_name ?? ticket.headliner}
                          </span>
                          {dup && (
                            <span style={{
                              fontFamily: "var(--font-geist-mono), monospace",
                              fontSize: 9,
                              color: "var(--muted)",
                              letterSpacing: ".06em",
                              textTransform: "uppercase",
                              padding: "1px 5px",
                              border: "1px solid var(--rule-strong)",
                            }}>
                              Already added
                            </span>
                          )}
                          {ticket.kind_hint && (
                            <span style={{
                              fontFamily: "var(--font-geist-mono), monospace",
                              fontSize: 9,
                              color: "var(--faint)",
                              letterSpacing: ".06em",
                              textTransform: "uppercase",
                            }}>
                              {ticket.kind_hint}
                            </span>
                          )}
                        </div>
                        <div style={{
                          fontFamily: "var(--font-geist-mono), monospace",
                          fontSize: 10.5,
                          color: "var(--muted)",
                          letterSpacing: ".04em",
                          marginTop: 2,
                          display: "flex",
                          gap: 12,
                        }}>
                          {ticket.venue_name && <span>{ticket.venue_name}</span>}
                          {ticket.venue_city && <span>{ticket.venue_city}</span>}
                          {ticket.date && <span>{ticket.date}</span>}
                          {ticket.seat && <span>{ticket.seat}</span>}
                          {ticket.price && <span>${ticket.price}{ticket.ticket_count && ticket.ticket_count > 1 ? ` (${ticket.ticket_count} tix)` : ""}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Footer */}
            {gmailBulkResults.length > 0 && (
              <div style={{
                padding: "12px 20px",
                borderTop: "1px solid var(--rule)",
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 10,
              }}>
                {gmailAddedCount > 0 && !gmailAdding && (
                  <span style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 11,
                    color: "var(--kind-concert)",
                    letterSpacing: ".04em",
                  }}>
                    {gmailAddedCount} added
                  </span>
                )}
                <button
                  onClick={handleAddSelectedGmail}
                  disabled={gmailBulkSelected.size === 0 || gmailAdding}
                  style={{
                    padding: "8px 16px",
                    border: "none",
                    background: gmailBulkSelected.size > 0 && !gmailAdding ? "var(--ink)" : "var(--rule)",
                    color: gmailBulkSelected.size > 0 && !gmailAdding ? "var(--bg)" : "var(--muted)",
                    fontFamily: "var(--font-geist-sans), sans-serif",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: gmailBulkSelected.size > 0 && !gmailAdding ? "pointer" : "default",
                    letterSpacing: -0.1,
                  }}
                >
                  {gmailAdding
                    ? `Adding... ${gmailAddedCount}/${gmailBulkSelected.size}`
                    : `Add selected (${gmailBulkSelected.size})`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
