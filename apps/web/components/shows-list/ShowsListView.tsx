"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { useInvalidateSidebarCounts } from "@/lib/sidebar-counts";
import {
  EmptyState,
  ShowRow,
  type ShowKind,
} from "@/components/design-system";
import { SortHeader } from "@/components/SortHeader";
import {
  Archive,
  Calendar,
  ArrowDownUp,
  Ticket,
  Trash2,
  Mail,
  X,
  Check,
  Loader2,
  Eye,
} from "lucide-react";
import { useCompactMode } from "@/lib/useCompactMode";
import { useIsMobile } from "@/lib/useIsMobile";
import { KIND_ICONS, KIND_LABELS } from "@/lib/kind-icons";
import { useShowContextMenu } from "@/lib/useShowContextMenu";
import { PaginationFooter } from "@/components/PaginationFooter";
import { ExternalSourceDisclaimer } from "@/components/external-connection/ExternalSourceDisclaimer";
import {
  getHeadliner,
  getHeadlinerId,
  getHeadlinerImageUrl,
  getSupport,
  getSupportPerformers,
} from "@/lib/show-accessors";
import {
  ALL_KINDS,
  MODE_LABELS,
  MONTH_NAMES,
  MONTHS,
  SHOW_LIST_GRID_TEMPLATE,
  compareShows,
  defaultDirFor,
  getDaysInMonth,
  getFirstDayOfWeek,
  getNeighborhood,
  getUniqueYears,
  getYear,
  toDateParts,
  type CalView,
  type ShowData,
  type ShowsListMode,
  type SortConfig,
  type SortField,
  type StatsTimeframe,
  type ViewMode,
} from "./helpers";
import { StatsView } from "./StatsView";


// ---------------------------------------------------------------------------
// State transition labels
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

// `ShowsListMode` is re-exported so the existing `import { type ShowsListMode }
// from "@/components/shows-list/ShowsListView"` consumers stay green.
export type { ShowsListMode } from "./helpers";

interface ShowsListViewProps {
  mode: ShowsListMode;
}

export default function ShowsListView({ mode }: ShowsListViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const compact = useCompactMode();
  const isMobile = useIsMobile();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedYear, setSelectedYear] = useState<string>("All");
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

  const labels = MODE_LABELS[mode];
  const isUpcoming = mode === "upcoming";
  const isLogbook = mode === "logbook";

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
  } = useShowContextMenu<ShowData>();

  // Calendar state
  const [calView, setCalView] = useState<CalView>("month");
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());

  // Stats timeframe
  const [statsTimeframe, setStatsTimeframe] = useState<StatsTimeframe>("all");

  // Mobile import action sheet — collapses Gmail / setlist.fm / Eventbrite
  // (and Delete All) behind a single "Import" button on phone-sized viewports
  // so the header doesn't eat the entire screen.
  const [mobileImportOpen, setMobileImportOpen] = useState(false);

  // Import (Gmail / setlist.fm / Eventbrite) state. The scan UIs are
  // source-keyed but share the review list, dedupe, and "Add selected"
  // creation logic.
  type ImportSource = "gmail" | "setlistfm" | "eventbrite";
  type BulkResult = {
    gmailMessageId?: string;
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
    // Source-specific extras carried through to createShow:
    setlistId?: string;
    musicbrainzId?: string;
    tourName?: string | null;
    setlist?: import("@showbook/shared").PerformerSetlist;
    orderId?: string;
    eventId?: string;
  };
  const [importSource, setImportSource] = useState<ImportSource | null>(null);
  // Gated OAuth: for gmail/eventbrite the consent disclaimer renders
  // first; the popup only opens once the user explicitly continues.
  const [oauthConsentStarted, setOauthConsentStarted] = useState(false);
  const [gmailBulkLoading, setGmailBulkLoading] = useState(false);
  const [gmailBulkResults, setGmailBulkResults] = useState<BulkResult[]>([]);
  const [gmailBulkSelected, setGmailBulkSelected] = useState<Set<number>>(new Set());
  const [gmailAdding, setGmailAdding] = useState(false);
  const [gmailAddedCount, setGmailAddedCount] = useState(0);
  const [gmailAccessToken, setGmailAccessToken] = useState<string | null>(null);
  const [gmailError, setGmailError] = useState<string | null>(null);
  // Eventbrite + setlist.fm specific bits:
  const [eventbriteAccessToken, setEventbriteAccessToken] = useState<string | null>(null);
  const [setlistfmUsername, setSetlistfmUsername] = useState("");
  const setlistfmFetchAttended = trpc.imports.setlistfmFetchAttended.useMutation();

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
  const invalidateSidebarCounts = useInvalidateSidebarCounts();
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
    invalidateSidebarCounts();
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

  const startEventbriteScan = useCallback(async (token: string) => {
    setGmailBulkLoading(true);
    setGmailProgress(null);
    try {
      const res = await fetch("/api/eventbrite/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "Scan failed");
        throw new Error(text || "Scan failed");
      }
      const data = (await res.json()) as {
        tickets: Array<{
          orderId: string;
          eventId: string;
          date: string | null;
          eventName: string | null;
          venueName: string | null;
          venueCity: string | null;
          venueState: string | null;
          price: string | null;
          ticketCount: number;
          kindHint: "concert" | "theatre" | "comedy" | "festival" | null;
          duplicate: boolean;
        }>;
      };
      const mapped: BulkResult[] = data.tickets.map((t) => ({
        headliner: t.eventName ?? "(unknown)",
        production_name: null,
        venue_name: t.venueName,
        venue_city: t.venueCity,
        venue_state: t.venueState,
        date: t.date,
        seat: null,
        price: t.price,
        ticket_count: t.ticketCount,
        kind_hint: t.kindHint,
        confidence: "medium",
        orderId: t.orderId,
        eventId: t.eventId,
      }));
      setGmailBulkResults(mapped);
      const initial = new Set<number>();
      mapped.forEach((t, i) => { if (!isDuplicate(t)) initial.add(i); });
      setGmailBulkSelected(initial);
    } catch (err) {
      setGmailError(err instanceof Error ? err.message : "Eventbrite scan failed");
    } finally {
      setGmailBulkLoading(false);
    }
  }, [isDuplicate]);

  const startSetlistfmScan = useCallback(async (username: string) => {
    setGmailBulkLoading(true);
    setGmailError(null);
    try {
      const data = await setlistfmFetchAttended.mutateAsync({ username });
      const mapped: BulkResult[] = data.tickets.map((t) => ({
        headliner: t.headliner,
        production_name: null,
        venue_name: t.venueName,
        venue_city: t.venueCity,
        venue_state: t.venueState,
        date: t.date,
        seat: null,
        price: null,
        ticket_count: 1,
        kind_hint: "concert",
        confidence: "high",
        setlistId: t.setlistId,
        musicbrainzId: t.musicbrainzId ?? undefined,
        tourName: t.tourName,
        setlist: t.setlist,
      }));
      setGmailBulkResults(mapped);
      const initial = new Set<number>();
      mapped.forEach((t, i) => { if (!isDuplicate(t)) initial.add(i); });
      setGmailBulkSelected(initial);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "setlist.fm import failed";
      setGmailError(msg);
    } finally {
      setGmailBulkLoading(false);
    }
  }, [isDuplicate, setlistfmFetchAttended]);

  const handleOpenImportModal = useCallback((source: ImportSource) => {
    setImportSource(source);
    setGmailBulkResults([]);
    setGmailBulkSelected(new Set());
    setGmailAddedCount(0);
    setGmailAccessToken(null);
    setEventbriteAccessToken(null);
    setSetlistfmUsername("");
    setGmailError(null);
    setGmailProgress(null);
    setOauthConsentStarted(false);
    // OAuth popup does NOT open here — the modal first renders a
    // consent step with the disclaimer; only then does the user click
    // "Continue with Gmail / Eventbrite" which calls
    // `startOauthPopup` to open the popup.
  }, []);

  const startOauthPopup = useCallback((source: "gmail" | "eventbrite") => {
    setOauthConsentStarted(true);

    const expectedAuth = source === "gmail" ? "gmail-auth" : "eventbrite-auth";
    const expectedAuthError = source === "gmail" ? "gmail-auth-error" : "eventbrite-auth-error";
    const popupPath = source === "gmail" ? "/api/gmail" : "/api/eventbrite";

    const handler = (e: MessageEvent) => {
      if (e.data?.type === expectedAuth && e.data.accessToken) {
        window.removeEventListener("message", handler);
        if (source === "gmail") {
          setGmailAccessToken(e.data.accessToken);
          startGmailScan(e.data.accessToken);
        } else {
          setEventbriteAccessToken(e.data.accessToken);
          startEventbriteScan(e.data.accessToken);
        }
      }
      if (e.data?.type === expectedAuthError) {
        window.removeEventListener("message", handler);
      }
    };
    window.addEventListener("message", handler);

    const popup = window.open(popupPath, `${source}-auth`, "width=500,height=600,popup=yes");
    if (popup) {
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          window.removeEventListener("message", handler);
        }
      }, 500);
    }
  }, [startGmailScan, startEventbriteScan]);

  // Back-compat: ?gmail=1 still opens Gmail. New: ?import=gmail|setlistfm|eventbrite.
  useEffect(() => {
    const importParam = searchParams.get("import");
    if (importParam === "gmail" || importParam === "setlistfm" || importParam === "eventbrite") {
      handleOpenImportModal(importParam);
      router.replace(isUpcoming ? "/upcoming" : "/logbook");
      return;
    }
    if (searchParams.get("gmail") === "1") {
      handleOpenImportModal("gmail");
      router.replace(isUpcoming ? "/upcoming" : "/logbook");
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
        let sourceRefs: Record<string, unknown>;
        if (ticket.setlistId) {
          sourceRefs = { setlistfm: { setlistId: ticket.setlistId } };
        } else if (ticket.orderId) {
          sourceRefs = { eventbrite: { orderId: ticket.orderId, eventId: ticket.eventId } };
        } else if (ticket.gmailMessageId) {
          // Persisted so the next scan can dedup against this message
          // before paying for another LLM call (P4 cross-scan dedup).
          sourceRefs = {
            gmail: true,
            gmailMessageId: ticket.gmailMessageId,
            scanAt: new Date().toISOString(),
          };
        } else {
          sourceRefs = { gmail: true };
        }
        await createShow.mutateAsync({
          kind: ticket.kind_hint ?? "concert",
          headliner: {
            name: ticket.headliner,
            ...(ticket.musicbrainzId ? { musicbrainzId: ticket.musicbrainzId } : {}),
            ...(ticket.setlist ? { setlist: ticket.setlist } : {}),
          },
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
          tourName: ticket.tourName ?? undefined,
          sourceRefs,
        });
        setGmailAddedCount((prev) => prev + 1);
      } catch {
        // skip failed individual adds
      }
    }

    setGmailAdding(false);
    setImportSource(null);
    await Promise.all([
      utils.shows.invalidate(),
      invalidateSidebarCounts(),
    ]);
    // The logbook/upcoming pages prefetch shows.list on the server and
    // hydrate into the client cache; refresh the RSC so the SSR'd payload
    // also picks up the just-imported rows. router is intentionally not
    // in the dep array — it's stable across renders and adding it has been
    // observed to deterministically break Playwright shard 3 (see #110).
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gmailBulkResults, gmailBulkSelected, createShow, utils, invalidateSidebarCounts]);

  // ---------------------------------------------------------------------------
  // Render: Loading / Error
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {/* skeleton mode/filter header */}
        <div style={{ padding: "14px var(--page-pad-x)", borderBottom: "1px solid var(--rule)", flexShrink: 0, height: 52 }} />
        {/* skeleton stats strip */}
        <div style={{ padding: "12px var(--page-pad-x)", borderBottom: "1px solid var(--rule)", flexShrink: 0, height: 64, background: "var(--surface)" }} />
        {/* skeleton table rows */}
        <div style={{ flex: 1, minHeight: 0, padding: "12px var(--page-pad-x) 24px", overflow: "hidden" }}>
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
    // Stats is past-context only — total spent / new artists / rhythm don't
    // make sense for a future-only view. Calendar lives on both pages but
    // is scoped to that page's state set via filteredShows.
    const allModes: { k: ViewMode; l: string; Ic: React.ComponentType<{ size?: number; color?: string }>; count: string }[] = [
      { k: "list", l: "List", Ic: Archive, count: modeCounts.list },
      { k: "calendar", l: "Calendar", Ic: Calendar, count: modeCounts.calendar },
      { k: "stats", l: "Stats", Ic: ArrowDownUp, count: modeCounts.stats },
    ];
    const modes = isUpcoming ? allModes.filter((m) => m.k !== "stats") : allModes;

    const tabsRow = (
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
    );

    const titleBlock = (
      <div>
        <div style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 10.5,
          color: "var(--muted)",
          letterSpacing: ".1em",
          textTransform: "uppercase",
        }}>
          {labels.eyebrow}
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
          {labels.title}
        </div>
        {/* Cross-link to the other half so the split doesn't feel siloed. */}
        <Link
          href={isUpcoming ? "/logbook" : "/upcoming"}
          style={{
            display: "inline-block",
            marginTop: 6,
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10.5,
            color: "var(--accent)",
            letterSpacing: ".04em",
            textDecoration: "none",
          }}
        >
          {isUpcoming ? "View past →" : "View upcoming →"}
        </Link>
      </div>
    );

    if (isMobile) {
      // Mobile header: title + single Import button on one row, then
      // full-width tabs below. The three import sources + Delete All
      // live in a bottom sheet behind the Import button — collapsing
      // four stacked rows of buttons frees the screen for actual content.
      // The right padding (52px) leaves room for the floating
      // GlobalSearch trigger at top-right (position: fixed; right: 12px;
      // ~30px wide) so the Import button doesn't sit under it.
      return (
        <div style={{
          padding: "14px 16px 14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          borderBottom: "1px solid var(--rule)",
        }}>
          <div style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            paddingRight: 52,
          }}>
            {titleBlock}
            <button
              type="button"
              onClick={() => setMobileImportOpen(true)}
              aria-haspopup="menu"
              aria-expanded={mobileImportOpen}
              data-testid="mobile-import-trigger"
              style={{
                border: "1px solid var(--rule-strong)",
                cursor: "pointer",
                background: "transparent",
                color: "var(--ink)",
                padding: "7px 12px",
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 13,
                fontWeight: 500,
                letterSpacing: -0.2,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                flexShrink: 0,
                marginTop: 2,
              }}
            >
              <span>Import</span>
              <span aria-hidden style={{ fontSize: 9 }}>▾</span>
            </button>
          </div>
          {tabsRow}
        </div>
      );
    }

    return (
      <div style={{
        padding: "16px var(--page-pad-x)",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 0,
        borderBottom: "1px solid var(--rule)",
      }}>
        {titleBlock}
        <div style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}>
          <div
            role="group"
            aria-label="Import past shows"
            style={{
              display: "flex",
              alignItems: "stretch",
              border: "1px solid var(--rule-strong)",
              flexDirection: "row",
            }}
          >
            <button
              onClick={() => handleOpenImportModal("gmail")}
              title="Import from Gmail"
              style={{
                border: "none",
                borderRight: "1px solid var(--rule-strong)",
                cursor: "pointer",
                background: "transparent",
                color: "var(--ink)",
                padding: "10px 14px",
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 13,
                fontWeight: 500,
                letterSpacing: -0.2,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: 7,
              }}
            >
              <Image src="/google-g.svg" alt="" width={14} height={14} />
              <span>Gmail</span>
            </button>
            <button
              onClick={() => handleOpenImportModal("setlistfm")}
              title="Import attended shows from setlist.fm"
              style={{
                border: "none",
                borderRight: "1px solid var(--rule-strong)",
                cursor: "pointer",
                background: "transparent",
                color: "var(--ink)",
                padding: "10px 14px",
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 13,
                fontWeight: 500,
                letterSpacing: -0.2,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: 7,
              }}
            >
              <Mail size={14} />
              <span>setlist.fm</span>
            </button>
            <button
              onClick={() => handleOpenImportModal("eventbrite")}
              title="Import past orders from Eventbrite"
              style={{
                border: "none",
                cursor: "pointer",
                background: "transparent",
                color: "var(--ink)",
                padding: "10px 14px",
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 13,
                fontWeight: 500,
                letterSpacing: -0.2,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: 7,
              }}
            >
              <Ticket size={14} />
              <span>Eventbrite</span>
            </button>
          </div>
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
          {tabsRow}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Filter Bar
  // ---------------------------------------------------------------------------

  function renderFilterBar() {
    // /upcoming swaps the year filter (which is misleading there — it
    // pulls older years from date-TBD watching shows) for an
    // All · Tickets · Watching chip toggle that narrows the state set.
    const upcomingChips: { k: typeof upcomingFilter; l: string }[] = [
      { k: "all", l: "All" },
      { k: "ticketed", l: "Tickets" },
      { k: "watching", l: "Watching" },
    ];

    return (
      <div style={{
        padding: isMobile ? "11px 16px" : "11px var(--page-pad-x)",
        display: "flex",
        alignItems: "center",
        gap: isMobile ? 12 : 18,
        flexWrap: "wrap",
        background: "var(--surface)",
        borderBottom: "1px solid var(--rule)",
      }}>
        {/* Mode-specific primary filter */}
        {isLogbook ? (
          <div data-testid="logbook-year-filter" style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid var(--rule-strong)" }}>
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
        ) : (
          <div data-testid="upcoming-state-filter" style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid var(--rule-strong)" }}>
            {upcomingChips.map(({ k, l }, i, arr) => {
              const active = upcomingFilter === k;
              return (
                <button
                  key={k}
                  type="button"
                  data-testid={`upcoming-filter-${k}`}
                  onClick={() => setUpcomingFilter(k)}
                  style={{
                    padding: "5px 11px",
                    borderRight: i === arr.length - 1 ? "none" : "1px solid var(--rule-strong)",
                    border: "none",
                    background: active ? "var(--ink)" : "transparent",
                    color: active ? "var(--bg)" : "var(--ink)",
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 11,
                    fontWeight: active ? 500 : 400,
                    cursor: "pointer",
                    letterSpacing: ".02em",
                  }}
                >
                  {l}
                </button>
              );
            })}
          </div>
        )}

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
  // Render: List Mode
  // ---------------------------------------------------------------------------

  function renderList() {
    if (filteredShows.length === 0) {
      // Empty-state asymmetry per the IA cleanup plan:
      //   /upcoming → Discover-leaning ("Nothing on the horizon")
      //   /logbook  → Gmail-leaning ("Your history starts here")
      const primary = isUpcoming ? (
        <Link
          href="/discover"
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
            textDecoration: "none",
          }}
        >
          <Eye size={13} />
          Find shows in Discover
        </Link>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
          <button
            type="button"
            onClick={() => handleOpenImportModal("gmail")}
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
            Gmail
          </button>
          <button
            type="button"
            onClick={() => handleOpenImportModal("setlistfm")}
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
            }}
          >
            <Mail size={13} />
            setlist.fm
          </button>
          <button
            type="button"
            onClick={() => handleOpenImportModal("eventbrite")}
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
            }}
          >
            <Ticket size={13} />
            Eventbrite
          </button>
        </div>
      );
      const secondary = (
        <Link
          href="/add"
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
          {isUpcoming ? "Add a show" : "Add a past show"}
        </Link>
      );
      return (
        <div style={{ padding: isMobile ? "20px 16px" : "28px var(--page-pad-x)" }}>
          <EmptyState
            kind="shows"
            title={labels.emptyTitle}
            body={labels.emptyBody}
            action={
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                {primary}
                {secondary}
              </div>
            }
          />
        </div>
      );
    }

    return (
      <div style={{
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        // Desktop keeps the inner scroll so the toolbar above stays
        // pinned. Mobile lets the page scroll as a whole — otherwise
        // the visible list area shrinks to ~1.5 rows once the header
        // and filter bar take their share of a 700px viewport.
        ...(isMobile ? {} : { flex: 1, minHeight: 0, overflow: "auto" }),
      }}>
        {/* Date-TBD rail (Upcoming only): watching shows with no date set
            yet — typically a multi-night theatre run the user wants to
            see but hasn't picked a night for. Surfaced separately so they
            don't sink to the bottom of a date-asc sort. */}
        {isUpcoming && dateTbdShows.length > 0 && (
          <div data-testid="date-tbd-rail" style={{ padding: isMobile ? "12px 16px 0" : "14px var(--page-pad-x) 0", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10.5,
              color: "var(--muted)",
              letterSpacing: ".1em",
              textTransform: "uppercase",
            }}>
              Date TBD &middot; {dateTbdShows.length}
            </div>
            <div style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 11,
              color: "var(--faint)",
              lineHeight: 1.5,
            }}>
              {dateTbdShows.map((s, i) => (
                <span key={s.id}>
                  <Link
                    href={`/shows/${s.id}`}
                    style={{ color: "var(--ink)", textDecoration: "none" }}
                  >
                    {s.showPerformers?.[0]?.performer?.name ?? s.productionName ?? "Untitled"}
                  </Link>
                  {i < dateTbdShows.length - 1 ? " · " : ""}
                </span>
              ))}
            </div>
          </div>
        )}
        {/* Section label */}
        <div style={{ padding: isMobile ? "16px 16px 8px" : "18px var(--page-pad-x) 8px", display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <div style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 11,
            color: "var(--ink)",
            letterSpacing: ".1em",
            textTransform: "uppercase",
            fontWeight: 500,
          }}>
            {labels.title} &middot; {filteredShows.length}
          </div>
          <div style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10.5,
            color: "var(--faint)",
          }}>
            {isUpcoming
              ? `${ticketedCount} tix · ${watchingCount} watching`
              : `${pastCount} past`}
          </div>
        </div>

        {/* Show list */}
        <div className="shows-list-table" style={{ margin: isMobile ? "4px 12px 0" : "4px var(--page-pad-x) 0", background: "var(--surface)" }}>
          {/* Column headers — hidden on mobile via CSS because the row
              grid collapses to a 5-col layout there and the 10-col header
              template would otherwise force horizontal overflow. */}
          <div className="shows-list-table__col-headers" style={{
            display: "grid",
            gridTemplateColumns: SHOW_LIST_GRID_TEMPLATE,
            columnGap: 16,
            padding: "10px 20px 10px 10px",
            marginBottom: 8,
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

    // Bounds span from Jan of the earliest show year to Dec of the latest
    // show year (always including the current year so "Today" is reachable
    // even when the user has no shows yet). Use the unfiltered show set so
    // that year filters in the toolbar don't shrink the navigable range.
    // Date-TBD watching rows have a null date — they're surfaced on the
    // Date-TBD rail and would crash `new Date(null + "T00:00:00")` if we
    // mapped them blindly, so drop them here.
    const boundsSource = (allShowsUnfiltered ?? shows) as ShowData[];
    const showYears = boundsSource
      .filter((s) => s.date !== null)
      .map((s) => new Date(s.date + "T00:00:00").getFullYear());
    const minYear = Math.min(today.getFullYear(), ...showYears);
    const maxYear = Math.max(today.getFullYear(), ...showYears);

    const atMin = calYear === minYear && calMonth === 0;
    const atMax = calYear === maxYear && calMonth === 11;
    const atMinYear = calYear === minYear;
    const atMaxYear = calYear === maxYear;

    const goToday = () => {
      setCalMonth(today.getMonth());
      setCalYear(today.getFullYear());
    };

    const stepMonth = (dir: number) => {
      const m = calMonth + dir;
      if (m < 0) {
        if (calYear <= minYear) return;
        setCalMonth(11);
        setCalYear((y) => y - 1);
      } else if (m > 11) {
        if (calYear >= maxYear) return;
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
      return renderCalendarYearView(today, toolbarNav, viewToggle, atMinYear, atMaxYear);
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
      if (!s.date) return false;
      const d = new Date(s.date + "T00:00:00");
      const m = d.getMonth();
      const y = d.getFullYear();
      return (y === calYear && m === calMonth) || (y === calYear && m === calMonth + 1) || (calMonth === 11 && y === calYear + 1 && m === 0);
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return (
      <div style={{
        background: "var(--bg)",
        padding: isMobile ? "18px 16px 24px" : "22px var(--page-pad-x) var(--page-pad-x)",
        ...(isMobile ? {} : { flex: 1, minHeight: 0, overflow: "auto" }),
      }}>
        {/* Month toolbar */}
        <div style={{
          display: "flex",
          alignItems: isMobile ? "stretch" : "center",
          justifyContent: "space-between",
          flexDirection: isMobile ? "column" : "row",
          gap: isMobile ? 10 : 0,
          marginBottom: 14,
        }}>
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

        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 320px",
          gap: isMobile ? 18 : 22,
          minHeight: 0,
        }}>
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
    _toolbarNav: React.ReactNode,
    viewToggle: React.ReactNode,
    atMinYear: boolean,
    atMaxYear: boolean,
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
      <div style={{
        background: "var(--bg)",
        padding: isMobile ? "18px 16px 24px" : "22px var(--page-pad-x) var(--page-pad-x)",
        ...(isMobile ? {} : { flex: 1, minHeight: 0, overflow: "auto" }),
      }}>
        <div style={{
          display: "flex",
          alignItems: isMobile ? "stretch" : "center",
          justifyContent: "space-between",
          flexDirection: isMobile ? "column" : "row",
          gap: isMobile ? 10 : 0,
          marginBottom: 14,
        }}>
          <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 30, fontWeight: 600, color: "var(--ink)", letterSpacing: -0.9 }}>
            {calYear}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {viewToggle}
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => { if (!atMinYear) setCalYear((y) => y - 1); }}
                disabled={atMinYear}
                data-testid="cal-year-prev"
                style={{ padding: "7px 12px", border: "1px solid var(--rule-strong)", background: "transparent", color: atMinYear ? "var(--faint)" : "var(--ink)", cursor: atMinYear ? "not-allowed" : "pointer", fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, opacity: atMinYear ? 0.4 : 1 }}
              >
                ‹ {calYear - 1}
              </button>
              <button
                onClick={() => { if (!atMaxYear) setCalYear((y) => y + 1); }}
                disabled={atMaxYear}
                data-testid="cal-year-next"
                style={{ padding: "7px 12px", border: "1px solid var(--rule-strong)", background: "transparent", color: atMaxYear ? "var(--faint)" : "var(--ink)", cursor: atMaxYear ? "not-allowed" : "pointer", fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, opacity: atMaxYear ? 0.4 : 1 }}
              >
                {calYear + 1} ›
              </button>
            </div>
          </div>
        </div>
        <div
          data-testid="year-view-grid"
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "repeat(3, 1fr)" : "repeat(4, 1fr)",
            gap: 10,
          }}
        >
          {YEAR_MONTHS.map((m) => miniMonthGrid(calYear, m))}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Stats Mode
  // ---------------------------------------------------------------------------


  // ---------------------------------------------------------------------------
  // Render: Page
  // ---------------------------------------------------------------------------

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      // Desktop pins the whole shell to the viewport height and lets the
      // inner list/stats/calendar scroll inside their own container.
      // Mobile lets the entire page scroll naturally so the user can
      // reach the pagination footer and Stats sections beyond the fold
      // without fighting a nested scroll inside a 700px-tall column.
      ...(isMobile ? {} : { height: "100%", minHeight: 0 }),
    }}>
      {renderHeader()}
      {renderFilterBar()}

      {viewMode === "list" && renderList()}
      {viewMode === "calendar" && renderCalendar()}
      {viewMode === "stats" && (
        <StatsView
          shows={(allShowsUnfiltered ?? []) as ShowData[]}
          timeframe={statsTimeframe}
          onTimeframeChange={setStatsTimeframe}
          isMobile={isMobile}
        />
      )}

      {isMobile && mobileImportOpen && (
        <div
          onClick={() => setMobileImportOpen(false)}
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.45)",
            zIndex: 150,
            display: "flex",
            alignItems: "flex-end",
          }}
        >
          <div
            role="menu"
            aria-label="Import past shows"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg)",
              width: "100%",
              borderTop: "1px solid var(--rule-strong)",
              padding: "16px 16px calc(20px + env(safe-area-inset-bottom, 0px))",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10.5,
              color: "var(--muted)",
              letterSpacing: ".1em",
              textTransform: "uppercase",
              marginBottom: 4,
              padding: "0 2px",
            }}>
              Import from
            </div>
            {([
              { source: "gmail" as const, label: "Gmail", desc: "Scan confirmation emails", icon: <Image src="/google-g.svg" alt="" width={16} height={16} /> },
              { source: "setlistfm" as const, label: "setlist.fm", desc: "Import attended setlists", icon: <Mail size={16} /> },
              { source: "eventbrite" as const, label: "Eventbrite", desc: "Sync past orders", icon: <Ticket size={16} /> },
            ]).map(({ source, label, desc, icon }) => (
              <button
                key={source}
                type="button"
                data-testid={`mobile-import-${source}`}
                onClick={() => {
                  setMobileImportOpen(false);
                  handleOpenImportModal(source);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  width: "100%",
                  padding: "14px 14px",
                  border: "1px solid var(--rule-strong)",
                  background: "var(--surface)",
                  color: "var(--ink)",
                  cursor: "pointer",
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  textAlign: "left",
                }}
              >
                <span style={{ width: 18, display: "inline-flex", justifyContent: "center", flexShrink: 0 }}>{icon}</span>
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: -0.2 }}>{label}</span>
                  <span style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 10.5,
                    color: "var(--muted)",
                    marginTop: 2,
                    letterSpacing: ".02em",
                  }}>{desc}</span>
                </span>
              </button>
            ))}
            {totalShows > 0 && (
              <button
                type="button"
                onClick={() => {
                  setMobileImportOpen(false);
                  handleDeleteAll();
                }}
                disabled={deleteAllShows.isPending}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  width: "100%",
                  padding: "14px 14px",
                  border: "1px solid var(--kind-theatre)",
                  background: "transparent",
                  color: "var(--kind-theatre)",
                  cursor: deleteAllShows.isPending ? "not-allowed" : "pointer",
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  textAlign: "left",
                  marginTop: 4,
                  opacity: deleteAllShows.isPending ? 0.5 : 1,
                }}
              >
                <span style={{ width: 18, display: "inline-flex", justifyContent: "center", flexShrink: 0 }}><Trash2 size={16} /></span>
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: -0.2 }}>
                    {deleteAllShows.isPending ? "Deleting..." : "Delete all shows"}
                  </span>
                  <span style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 10.5,
                    color: "var(--muted)",
                    marginTop: 2,
                    letterSpacing: ".02em",
                  }}>
                    Permanently remove every show in your logbook
                  </span>
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setMobileImportOpen(false)}
              style={{
                marginTop: 6,
                width: "100%",
                padding: "12px",
                border: "1px solid var(--rule)",
                background: "transparent",
                color: "var(--muted)",
                cursor: "pointer",
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                letterSpacing: ".06em",
                textTransform: "uppercase",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Show row context menu + watching → ticketed transition modal */}
      {showContextMenuPortal}

      {/* Bulk import modal — Gmail / setlist.fm / Eventbrite share this UI. */}
      {importSource !== null && (
        <div
          onClick={() => setImportSource(null)}
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
                  {importSource === "gmail" && "Import from Gmail"}
                  {importSource === "setlistfm" && "Import from setlist.fm"}
                  {importSource === "eventbrite" && "Import from Eventbrite"}
                </div>
                <div style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 10.5,
                  color: "var(--muted)",
                  letterSpacing: ".04em",
                  marginTop: 2,
                }}>
                  {gmailBulkLoading
                    ? importSource === "gmail"
                      ? gmailProgress?.phase === "processing"
                        ? `Processing ${gmailProgress.processed} of ${gmailProgress.total} emails · ${gmailProgress.found} tickets found`
                        : "Searching Gmail for ticket emails..."
                      : importSource === "setlistfm"
                        ? "Fetching attended setlists..."
                        : "Fetching Eventbrite orders..."
                    : gmailError
                      ? gmailError
                      : gmailBulkResults.length > 0
                        ? `${gmailBulkResults.length} ticket${gmailBulkResults.length !== 1 ? "s" : ""} found · ${gmailBulkSelected.size} selected`
                        : importSource === "gmail"
                          ? gmailAccessToken
                            ? "No tickets found"
                            : oauthConsentStarted
                              ? "Waiting for Gmail authorization..."
                              : "Review what we'll store before connecting"
                          : importSource === "eventbrite"
                            ? eventbriteAccessToken
                              ? "No tickets found"
                              : oauthConsentStarted
                                ? "Waiting for Eventbrite authorization..."
                                : "Review what we'll store before connecting"
                            : "Enter your setlist.fm username"}
                </div>
              </div>
              <button
                onClick={() => setImportSource(null)}
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
                  {importSource === "gmail"
                    ? gmailProgress?.phase === "processing"
                      ? `Processing ${gmailProgress.processed} of ${gmailProgress.total} · ${gmailProgress.found} found`
                      : "Searching Gmail..."
                    : importSource === "setlistfm"
                      ? "Fetching attended setlists from setlist.fm..."
                      : "Fetching past orders from Eventbrite..."}
                </span>
                {importSource === "gmail" && gmailProgress?.phase === "processing" && gmailProgress.total > 0 && (
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

            {/* setlist.fm: username form (no OAuth, just public username lookup). */}
            {importSource === "setlistfm" && !gmailBulkLoading && gmailBulkResults.length === 0 && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const trimmed = setlistfmUsername.trim();
                  if (!trimmed) return;
                  startSetlistfmScan(trimmed);
                }}
                style={{
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  borderBottom: "1px solid var(--rule)",
                }}
              >
                <label
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 11,
                    color: "var(--muted)",
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                  }}
                >
                  Your setlist.fm username
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    value={setlistfmUsername}
                    onChange={(e) => setSetlistfmUsername(e.target.value)}
                    placeholder="e.g. yourname"
                    autoFocus
                    style={{
                      flex: 1,
                      padding: "10px 12px",
                      border: "1px solid var(--rule-strong)",
                      background: "transparent",
                      color: "var(--ink)",
                      fontFamily: "var(--font-geist-sans), sans-serif",
                      fontSize: 13,
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!setlistfmUsername.trim()}
                    style={{
                      padding: "8px 16px",
                      border: "none",
                      background: setlistfmUsername.trim() ? "var(--ink)" : "var(--rule)",
                      color: setlistfmUsername.trim() ? "var(--bg)" : "var(--muted)",
                      fontFamily: "var(--font-geist-sans), sans-serif",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: setlistfmUsername.trim() ? "pointer" : "default",
                      letterSpacing: -0.1,
                    }}
                  >
                    Fetch
                  </button>
                </div>
                <ExternalSourceDisclaimer source="setlistfm" />
              </form>
            )}

            {/* gmail / eventbrite: consent step. Renders before the
                OAuth popup opens so the user sees what we store and
                why first. "Continue with X" opens the popup. */}
            {(importSource === "gmail" || importSource === "eventbrite")
              && !oauthConsentStarted
              && !gmailBulkLoading
              && gmailBulkResults.length === 0
              && (importSource === "gmail" ? !gmailAccessToken : !eventbriteAccessToken)
              && (
              <div
                style={{
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  borderBottom: "1px solid var(--rule)",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-geist-sans), sans-serif",
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: "var(--ink)",
                  }}
                >
                  {importSource === "gmail"
                    ? "Showbook will scan your inbox for ticket emails and surface them here so you can pick which shows to import."
                    : "Showbook will fetch your past Eventbrite orders so you can pick which shows to import."}
                </div>
                <ExternalSourceDisclaimer source={importSource} />
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => startOauthPopup(importSource)}
                    data-testid={`${importSource}-consent-continue`}
                    style={{
                      padding: "10px 16px",
                      border: "none",
                      background: "var(--ink)",
                      color: "var(--bg)",
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: ".06em",
                      textTransform: "uppercase",
                      cursor: "pointer",
                    }}
                  >
                    {importSource === "gmail"
                      ? "Continue with Gmail →"
                      : "Continue with Eventbrite →"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportSource(null)}
                    style={{
                      padding: "10px 12px",
                      border: "none",
                      background: "transparent",
                      color: "var(--muted)",
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 11,
                      letterSpacing: ".06em",
                      textTransform: "uppercase",
                      cursor: "pointer",
                    }}
                  >
                    Not now
                  </button>
                </div>
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
