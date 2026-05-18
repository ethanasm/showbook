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
  MODE_LABELS,
  SHOW_LIST_GRID_TEMPLATE,
  compareShows,
  defaultDirFor,
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
import { CalendarView } from "./CalendarView";
import { FilterBar } from "./FilterBar";


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
  // Groq disclosure gate (GDPR Art. 6 / Art. 28). The first time a
  // user runs a Gmail scan we hold the OAuth access token in state
  // and surface a disclosure modal explaining that email content
  // will be sent to Groq. The modal's Accept button calls
  // `preferences.acceptGmailScan` which sets the timestamp; we then
  // proceed with the held token. On subsequent scans the timestamp
  // is non-null and the modal is skipped.
  const [pendingGmailToken, setPendingGmailToken] = useState<string | null>(
    null,
  );
  const prefsQuery = trpc.preferences.get.useQuery(undefined, {
    staleTime: 60_000,
  });
  const acceptGmailScanMutation = trpc.preferences.acceptGmailScan.useMutation();
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
  const yearFilter = selectedYear === "All time" ? undefined :
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
    const buttons: string[] = ["All time"];
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
          // GDPR consent gate. If the user hasn't accepted the
          // Groq-AI disclosure, hold the token in state and let
          // the modal handle it; otherwise scan immediately.
          if (prefsQuery.data?.preferences?.acceptedGmailScanAt) {
            startGmailScan(e.data.accessToken);
          } else {
            setPendingGmailToken(e.data.accessToken);
          }
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
  }, [startGmailScan, startEventbriteScan, prefsQuery.data?.preferences?.acceptedGmailScanAt]);

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
      <FilterBar
        isMobile={isMobile}
        isLogbook={isLogbook}
        yearButtons={yearButtons}
        selectedYear={selectedYear}
        onSelectYear={setSelectedYear}
        upcomingFilter={upcomingFilter}
        onUpcomingFilterChange={setUpcomingFilter}
        selectedKind={selectedKind}
        onSelectKind={setSelectedKind}
        filteredCount={filteredShows.length}
      />

      {viewMode === "list" && renderList()}
      {viewMode === "calendar" && (
        <CalendarView
          shows={shows}
          allShows={(allShowsUnfiltered ?? []) as ShowData[]}
          calView={calView}
          calMonth={calMonth}
          calYear={calYear}
          setCalView={setCalView}
          setCalMonth={setCalMonth}
          setCalYear={setCalYear}
          isMobile={isMobile}
        />
      )}
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

      {pendingGmailToken ? (
        <GmailConsentModal
          submitting={acceptGmailScanMutation.isPending}
          onCancel={() => setPendingGmailToken(null)}
          onAccept={async () => {
            try {
              await acceptGmailScanMutation.mutateAsync();
              await utils.preferences.get.invalidate();
              const tok = pendingGmailToken;
              setPendingGmailToken(null);
              if (tok) startGmailScan(tok);
            } catch {
              // The mutation surfaces its own toast via the global
              // tRPC error wrapper; just keep the modal up so the
              // user can retry without losing the held token.
            }
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * One-time consent modal for the Gmail → Groq scan flow. Mirrors the
 * `DeleteAccountModal` pattern in `apps/web/app/(app)/preferences/View.client.tsx`:
 * hand-rolled fixed-position overlay, `role="dialog"`, click-outside
 * to dismiss. Kept inline because it's only mounted from this file;
 * if a second caller appears, extract to a shared primitive.
 */
function GmailConsentModal({
  submitting,
  onAccept,
  onCancel,
}: {
  submitting: boolean;
  onAccept: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="gmail-consent-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "grid",
        placeItems: "center",
        background: "rgba(0, 0, 0, 0.6)",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          background: "var(--surface)",
          border: "1px solid var(--rule-strong)",
          borderRadius: 12,
          padding: 24,
          display: "grid",
          gap: 16,
        }}
      >
        <div style={{ display: "grid", gap: 6 }}>
          <h2
            id="gmail-consent-title"
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: 20,
              fontWeight: 700,
              color: "var(--ink)",
            }}
          >
            Before we scan your email
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              lineHeight: 1.5,
              color: "var(--muted)",
            }}
          >
            Showbook will send the matched email subject + body (first
            8&nbsp;KB) to <strong style={{ color: "var(--ink)" }}>Groq</strong>, a
            third-party AI provider, to extract ticket details. We
            don&apos;t store the raw email content — only the
            structured result. By accepting, you consent to this
            processing under our{" "}
            <a
              href="/privacy"
              target="_blank"
              rel="noreferrer"
              style={{
                color: "var(--accent)",
                textDecoration: "underline",
              }}
            >
              privacy policy
            </a>
            . You can change your mind anytime by disconnecting Gmail
            and not running another scan.
          </p>
        </div>
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            style={{
              fontFamily: "var(--font-geist-mono)",
              fontSize: 10.5,
              fontWeight: 500,
              color: "var(--ink)",
              background: "transparent",
              border: "1px solid var(--rule-strong)",
              borderRadius: 0,
              padding: "6px 12px",
              cursor: submitting ? "not-allowed" : "pointer",
              letterSpacing: ".06em",
              textTransform: "uppercase",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={submitting}
            style={{
              fontFamily: "var(--font-geist-mono)",
              fontSize: 10.5,
              fontWeight: 600,
              color: "var(--accent-text)",
              background: "var(--accent)",
              border: "1px solid var(--accent)",
              borderRadius: 0,
              padding: "6px 12px",
              cursor: submitting ? "not-allowed" : "pointer",
              letterSpacing: ".06em",
              textTransform: "uppercase",
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? "Saving…" : "Accept and scan"}
          </button>
        </div>
      </div>
    </div>
  );
}
