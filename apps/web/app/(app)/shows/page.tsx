"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import {
  ShowRow,
  KindBadge,
  type ShowKind,
  type ShowState,
} from "@/components/design-system";
import {
  Archive,
  Calendar,
  ArrowDownUp,
  ChevronRight,
  MoreHorizontal,
  Ticket,
  Music,
  Clapperboard,
  Laugh,
  Tent,
  Square,
  Trash2,
  Mail,
  X,
  Check,
  Loader2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewMode = "list" | "calendar" | "stats";

interface ShowData {
  id: string;
  kind: ShowKind;
  state: ShowState;
  date: string;
  endDate: string | null;
  seat: string | null;
  pricePaid: string | null;
  tourName: string | null;
  setlist: string[] | null;
  photos: string[] | null;
  venue: {
    id: string;
    name: string;
    city: string;
    stateRegion?: string | null;
    country?: string | null;
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

const KIND_ICONS: Record<ShowKind, React.ComponentType<{ size?: number; color?: string; style?: React.CSSProperties }>> = {
  concert: Music,
  theatre: Clapperboard,
  comedy: Laugh,
  festival: Tent,
};

const KIND_LABELS: Record<ShowKind, string> = {
  concert: "concert",
  theatre: "theatre",
  comedy: "comedy",
  festival: "festival",
};

const ALL_KINDS: ShowKind[] = ["concert", "theatre", "comedy", "festival"];

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getHeadliner(show: ShowData): string {
  const headliner = show.showPerformers.find(
    (sp) => sp.role === "headliner" && sp.sortOrder === 0
  );
  return headliner?.performer.name ?? "Unknown Artist";
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toDateParts(dateStr: string): {
  month: string;
  day: string;
  year: string;
  dow: string;
} {
  const d = new Date(dateStr + "T00:00:00");
  return {
    month: d.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
    day: String(d.getDate()),
    year: String(d.getFullYear()),
    dow: d.toLocaleDateString("en-US", { weekday: "short" }),
  };
}

function getSupport(show: ShowData): string[] {
  return show.showPerformers
    .filter((sp) => sp.role === "support")
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((sp) => sp.performer.name);
}

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

function daysUntil(dateStr: string): number {
  const now = new Date();
  const d = new Date(dateStr + "T00:00:00");
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// State transition labels
// ---------------------------------------------------------------------------

const STATE_TRANSITIONS: Record<string, { label: string; target: ShowState }> =
  {
    watching: { label: "Got tickets", target: "ticketed" },
    ticketed: { label: "Mark as attended", target: "past" },
  };

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ShowsPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedYear, setSelectedYear] = useState<string>("All");
  const [selectedKind, setSelectedKind] = useState<ShowKind | null>(null);
  const [sortNewest, setSortNewest] = useState(true);
  const [expandedShowId, setExpandedShowId] = useState<string | null>(null);

  // Calendar state
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());

  // State transition modal
  const [transitionShow, setTransitionShow] = useState<ShowData | null>(null);
  const [transitionSeat, setTransitionSeat] = useState("");
  const [transitionPrice, setTransitionPrice] = useState("");

  // Gmail bulk scan state
  const [gmailModalOpen, setGmailModalOpen] = useState(false);
  const [gmailBulkLoading, setGmailBulkLoading] = useState(false);
  const [gmailBulkResults, setGmailBulkResults] = useState<
    Array<{
      gmailMessageId: string;
      headliner: string;
      venue_name: string | null;
      venue_city: string | null;
      date: string | null;
      seat: string | null;
      price: string | null;
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
  } = trpc.shows.list.useQuery({
    year: yearFilter,
  });

  const updateState = trpc.shows.updateState.useMutation();
  const deleteShow = trpc.shows.delete.useMutation();
  const createShow = trpc.shows.create.useMutation();
  const utils = trpc.useUtils();

  // Gmail
  const bulkScanGmail = trpc.enrichment.bulkScanGmail.useMutation();

  const shows = (allShows ?? []) as ShowData[];

  // Get all years from unfiltered data
  const { data: allShowsUnfiltered } = trpc.shows.list.useQuery({});
  const allYears = useMemo(
    () => getUniqueYears((allShowsUnfiltered ?? []) as ShowData[]),
    [allShowsUnfiltered]
  );

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

    result = [...result].sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return sortNewest ? dateB - dateA : dateA - dateB;
    });

    return result;
  }, [shows, selectedKind, sortNewest, selectedYear]);

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

  function handleRowClick(showId: string) {
    setExpandedShowId((prev) => (prev === showId ? null : showId));
  }

  async function handleStateTransition(show: ShowData) {
    const transition = STATE_TRANSITIONS[show.state];
    if (!transition) return;

    if (show.state === "watching") {
      setTransitionShow(show);
      return;
    }

    await updateState.mutateAsync({
      showId: show.id,
      newState: transition.target,
    });
    utils.shows.list.invalidate();
  }

  async function handleTransitionSubmit() {
    if (!transitionShow) return;
    const transition = STATE_TRANSITIONS[transitionShow.state];
    if (!transition) return;

    await updateState.mutateAsync({
      showId: transitionShow.id,
      newState: transition.target,
      seat: transitionSeat || undefined,
      pricePaid: transitionPrice || undefined,
    });
    setTransitionShow(null);
    setTransitionSeat("");
    setTransitionPrice("");
    utils.shows.list.invalidate();
  }

  async function handleDelete(showId: string) {
    if (!confirm("Delete this show? This cannot be undone.")) return;
    await deleteShow.mutateAsync({ showId });
    setExpandedShowId(null);
    utils.shows.list.invalidate();
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
    try {
      const result = await bulkScanGmail.mutateAsync({ accessToken: token });
      setGmailBulkResults(result.tickets);

      const initialSelected = new Set<number>();
      result.tickets.forEach((t, i) => {
        if (!isDuplicate(t)) {
          initialSelected.add(i);
        }
      });
      setGmailBulkSelected(initialSelected);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Scan failed";
      console.error("Gmail scan failed:", err);
      setGmailError(msg);
    } finally {
      setGmailBulkLoading(false);
    }
  }, [bulkScanGmail, isDuplicate]);

  const handleOpenGmailModal = useCallback(() => {
    setGmailModalOpen(true);
    setGmailBulkResults([]);
    setGmailBulkSelected(new Set());
    setGmailAddedCount(0);
    setGmailAccessToken(null);
    setGmailError(null);

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
          },
          date: ticket.date ?? new Date().toISOString().split("T")[0],
          seat: ticket.seat ?? undefined,
          pricePaid: ticket.price ?? undefined,
          sourceRefs: { gmail: true },
        });
        setGmailAddedCount((prev) => prev + 1);
      } catch {
        // skip failed individual adds
      }
    }

    setGmailAdding(false);
    setGmailModalOpen(false);
    utils.shows.list.invalidate();
  }, [gmailBulkResults, gmailBulkSelected, createShow, utils]);

  // ---------------------------------------------------------------------------
  // Render: Loading / Error
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300, fontFamily: "var(--font-geist-mono), monospace", fontSize: "0.85rem", color: "var(--muted)" }}>
        Loading shows...
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
        padding: "16px 36px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
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
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 26,
            fontWeight: 600,
            color: "var(--ink)",
            letterSpacing: -0.9,
            marginTop: 4,
          }}>
            Shows
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
              gap: 7,
            }}
          >
            <Mail size={14} />
            <span>Import from Gmail</span>
          </button>
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
                    padding: "10px 18px",
                    fontFamily: "var(--font-geist-sans), sans-serif",
                    fontSize: 14,
                    fontWeight: active ? 600 : 500,
                    letterSpacing: -0.2,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
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
        padding: "11px 36px",
        display: "flex",
        alignItems: "center",
        gap: 18,
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
                }}
              >
                <KIcon size={12} color={active ? "var(--bg)" : `var(--kind-${k})`} />
                {KIND_LABELS[k]}
              </span>
            );
          })}
        </div>

        {/* Separator */}
        <span style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 10.5,
          color: "var(--muted)",
          letterSpacing: ".04em",
        }}>
          &middot;
        </span>

        {/* Sort dropdown */}
        <div
          onClick={() => setSortNewest(!sortNewest)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10.5,
            color: "var(--muted)",
            cursor: "pointer",
          }}
        >
          <ArrowDownUp size={12} color="var(--muted)" />
          {sortNewest ? "newest first" : "oldest first"}
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
            {getHeadliner(show)}
          </div>
          {support.length > 0 && (
            <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 12.5, color: "var(--muted)", marginTop: 5 }}>
              with {support.join(", ")}
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
          <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>
            {show.venue.name}
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
            </div>
          )}
        </div>

        {/* Column 4: Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
          <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 9.5, color: "var(--faint)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 2 }}>
            Actions
          </div>
          {show.state === "watching" && (
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
              <Ticket size={13} /> Buy tickets
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
            onClick={() => alert("Edit coming soon")}
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300, fontFamily: "var(--font-geist-sans), sans-serif", fontSize: "1rem", color: "var(--muted)" }}>
          No shows yet. Add your first show!
        </div>
      );
    }

    return (
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg)" }}>
        {/* Section label */}
        <div style={{ padding: "18px 36px 8px", display: "flex", alignItems: "baseline", gap: 14 }}>
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
        <div style={{ margin: "4px 36px 36px", background: "var(--surface)" }}>
          {/* Column headers */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "14px 80px 110px 1.2fr 1fr 110px 64px 88px",
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
            <div>Date</div>
            <div>Kind</div>
            <div>Headline</div>
            <div>Venue</div>
            <div>Seat</div>
            <div style={{ textAlign: "right" }}>Paid</div>
            <div style={{ textAlign: "right" }}>State</div>
          </div>

          {filteredShows.map((show) => (
            <div key={show.id}>
              <ShowRow
                show={{
                  kind: show.kind,
                  state: show.state,
                  headliner: getHeadliner(show),
                  support: getSupport(show),
                  venue: show.venue.name,
                  neighborhood: getNeighborhood(show),
                  date: toDateParts(show.date),
                  seat: show.seat ?? undefined,
                  paid: show.pricePaid ? parseFloat(show.pricePaid) : undefined,
                }}
                selected={expandedShowId === show.id}
                onClick={() => handleRowClick(show.id)}
              />
              {expandedShowId === show.id && renderDetailPanel(show)}
            </div>
          ))}

          {/* Footer */}
          <div style={{
            padding: "16px 20px",
            textAlign: "center",
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10.5,
            color: "var(--faint)",
            letterSpacing: ".1em",
          }}>
            {filteredShows.length} show{filteredShows.length !== 1 ? "s" : ""} total
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Calendar Mode
  // ---------------------------------------------------------------------------

  function renderCalendar() {
    const daysInMonth = getDaysInMonth(calYear, calMonth);
    const firstDay = getFirstDayOfWeek(calYear, calMonth);

    // Build day -> shows map for current month
    const dayShowsMap = new Map<number, ShowData[]>();
    for (const show of shows) {
      const d = new Date(show.date + "T00:00:00");
      if (d.getMonth() === calMonth && d.getFullYear() === calYear) {
        const day = d.getDate();
        if (!dayShowsMap.has(day)) dayShowsMap.set(day, []);
        dayShowsMap.get(day)!.push(show);
      }
    }

    // Build cells array
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7) cells.push(null);

    const today = new Date();
    const isToday = (d: number | null) => d !== null && calYear === today.getFullYear() && calMonth === today.getMonth() && d === today.getDate();

    // Count events this month
    let pastInMonth = 0, upInMonth = 0, watchInMonth = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dayShows = dayShowsMap.get(d) ?? [];
      for (const s of dayShows) {
        if (s.state === "past") pastInMonth++;
        else if (s.state === "ticketed") upInMonth++;
        else if (s.state === "watching") watchInMonth++;
      }
    }

    // "This month & next" list — shows from this month and next month
    const railShows = shows.filter((s) => {
      const d = new Date(s.date + "T00:00:00");
      const m = d.getMonth();
      const y = d.getFullYear();
      return (y === calYear && m === calMonth) || (y === calYear && m === calMonth + 1) || (calMonth === 11 && y === calYear + 1 && m === 0);
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

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

    return (
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg)", padding: "22px 36px 36px" }}>
        {/* Month toolbar */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 30, fontWeight: 600, color: "var(--ink)", letterSpacing: -0.9 }}>
              {MONTH_NAMES[calMonth]} <span style={{ color: "var(--faint)", fontWeight: 400 }}>{calYear}</span>
            </div>
            <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, color: "var(--muted)", letterSpacing: ".06em" }}>
              {pastInMonth} past &middot; {upInMonth} upcoming &middot; {watchInMonth} watching
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "stretch", border: "1px solid var(--rule-strong)" }}>
            {[
              { l: "‹", onClick: () => stepMonth(-1) },
              { l: "Today", onClick: goToday },
              { l: "›", onClick: () => stepMonth(1) },
            ].map(({ l, onClick }, i) => (
              <button key={i} onClick={onClick} style={{
                padding: "7px 14px",
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 13,
                color: "var(--ink)",
                cursor: "pointer",
                borderRight: i === 2 ? "none" : "1px solid var(--rule-strong)",
                border: "none",
                background: "transparent",
                fontWeight: 500,
              }}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 22, minHeight: 0 }}>
          {/* Calendar grid */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--rule)" }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              borderBottom: "1px solid var(--rule)",
            }}>
              {dows.map((d, i) => (
                <div key={i} style={{
                  padding: "9px 10px",
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 10,
                  color: "var(--faint)",
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                }}>
                  {d}
                </div>
              ))}
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gridAutoRows: "minmax(92px, 1fr)",
            }}>
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
                    <div style={{
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 11,
                      color: todayCell ? "var(--ink)" : (d ? "var(--muted)" : "var(--faint)"),
                      fontWeight: todayCell ? 600 : 400,
                      letterSpacing: ".02em",
                    }}>
                      {d ?? ""}
                    </div>
                    {evs.map((s) => (
                      <div key={s.id} style={{
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontSize: 10,
                        color: "var(--ink)",
                        padding: "3px 6px",
                        background: s.state === "past" ? "transparent" : `var(--kind-${s.kind}, rgba(255,255,255,0.1))`,
                        borderLeft: `2px solid var(--kind-${s.kind})`,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        letterSpacing: ".01em",
                      }}>
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
            <div style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10.5,
              color: "var(--ink)",
              letterSpacing: ".1em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}>
              This month & next
            </div>
            {railShows.map((show) => {
              const dp = toDateParts(show.date);
              const stateTag = show.state === "past" ? "past" : show.state === "ticketed" ? "tix" : "watch";
              return (
                <div key={show.id} style={{
                  padding: "12px 14px",
                  background: "var(--surface)",
                  borderLeft: `2px solid var(--kind-${show.kind})`,
                  display: "grid",
                  gridTemplateColumns: "58px 1fr auto",
                  columnGap: 12,
                  alignItems: "start",
                }}>
                  <div>
                    <div style={{
                      fontFamily: "var(--font-geist-sans), sans-serif",
                      fontSize: 15,
                      fontWeight: 500,
                      color: stateTag === "past" ? "var(--muted)" : "var(--ink)",
                      letterSpacing: -0.3,
                      lineHeight: 1,
                      fontFeatureSettings: '"tnum"',
                    }}>
                      {dp.month} {dp.day}
                    </div>
                    <div style={{
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 9.5,
                      color: "var(--faint)",
                      marginTop: 3,
                    }}>
                      {dp.dow.toLowerCase()}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontFamily: "var(--font-geist-sans), sans-serif",
                      fontSize: 13,
                      fontWeight: 500,
                      color: stateTag === "past" ? "var(--muted)" : "var(--ink)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}>
                      {getHeadliner(show)}
                    </div>
                    <div style={{
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 10,
                      color: "var(--muted)",
                      marginTop: 2,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}>
                      {show.venue.name.toLowerCase()}
                    </div>
                  </div>
                  <div style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 9.5,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    color: stateTag === "past" ? "var(--faint)" : (stateTag === "watch" ? "var(--muted)" : "var(--ink)"),
                    fontWeight: 500,
                  }}>
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

  // ---------------------------------------------------------------------------
  // Render: Stats Mode
  // ---------------------------------------------------------------------------

  function renderStats() {
    const allShowsList = (allShowsUnfiltered ?? []) as ShowData[];
    const total = allShowsList.length;

    // Compute stats
    const totalSpent = allShowsList.reduce((sum, s) => sum + (s.pricePaid ? parseFloat(s.pricePaid) : 0), 0);
    const avgPerShow = total > 0 ? Math.round(totalSpent / total) : 0;

    const uniqueVenues = new Set(allShowsList.map((s) => s.venue.name)).size;
    const uniqueArtists = new Set(allShowsList.flatMap((s) => s.showPerformers.map((sp) => sp.performer.name))).size;

    const currentYear = new Date().getFullYear();
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

    return (
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg)", padding: "22px 36px 36px" }}>
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
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: 17,
                  fontWeight: 600,
                  color: "var(--ink)",
                  letterSpacing: -0.3,
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
                    ? "Scanning ticket emails..."
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
                  Scanning all ticket emails...
                </span>
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
                            {ticket.headliner}
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
                          {ticket.price && <span>${ticket.price}</span>}
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

      {/* State transition modal */}
      {transitionShow && (
        <div
          onClick={() => setTransitionShow(null)}
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
              background: "var(--surface)",
              border: "1px solid var(--rule)",
              borderRadius: 12,
              padding: 24,
              width: "100%",
              maxWidth: 400,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontWeight: 700,
              fontSize: "1.1rem",
              color: "var(--ink)",
            }}>
              Got tickets for {getHeadliner(transitionShow)}?
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: "0.7rem",
                fontWeight: 600,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}>
                Seat
              </label>
              <input
                value={transitionSeat}
                onChange={(e) => setTransitionSeat(e.target.value)}
                placeholder="e.g., Orchestra Row G Seat 12"
                style={{
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--rule)",
                  background: "var(--bg)",
                  color: "var(--ink)",
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: "0.9rem",
                  outline: "none",
                }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: "0.7rem",
                fontWeight: 600,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}>
                Price paid
              </label>
              <input
                value={transitionPrice}
                onChange={(e) => setTransitionPrice(e.target.value)}
                placeholder="e.g., 85.00"
                type="number"
                step="0.01"
                style={{
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--rule)",
                  background: "var(--bg)",
                  color: "var(--ink)",
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: "0.9rem",
                  outline: "none",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={handleTransitionSubmit}
                disabled={!transitionSeat || updateState.isPending}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                  cursor: "pointer",
                  border: "none",
                  background: "var(--accent)",
                  color: "var(--accent-text)",
                  opacity: (!transitionSeat || updateState.isPending) ? 0.5 : 1,
                }}
              >
                {updateState.isPending ? "Saving..." : "Confirm"}
              </button>
              <button
                onClick={() => setTransitionShow(null)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                  cursor: "pointer",
                  border: "1px solid var(--rule)",
                  background: "transparent",
                  color: "var(--muted)",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
