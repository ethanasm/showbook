"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { isFeatureOn } from "@showbook/shared";
import { useInvalidateSidebarCounts } from "@/lib/sidebar-counts";
import {
  EmptyState,
  ShowRow,
} from "@/components/design-system";
import { SortHeader } from "@/components/SortHeader";
import {
  Archive,
  Calendar,
  ArrowDownUp,
  Ticket,
  Trash2,
  Mail,
  Eye,
} from "lucide-react";
import { useCompactMode } from "@/lib/useCompactMode";
import { useIsMobile } from "@/lib/useIsMobile";
import { useShowContextMenu } from "@/lib/useShowContextMenu";
import { PaginationFooter } from "@/components/PaginationFooter";
import { ListSearchBar } from "@/components/ListSearchBar";
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
  getNeighborhood,
  toDateParts,
  type ShowData,
  type ShowsListMode,
  type ViewMode,
} from "./helpers";
import { StatsView } from "./StatsView";
import { CalendarView } from "./CalendarView";
import { FilterBar } from "./FilterBar";
import { useShowsFilter } from "./useShowsFilter";
import { useBulkImportScan, type ImportSource } from "./useBulkImportScan";
import { BulkImportModal, GmailConsentModal } from "./BulkImportModal";


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

  const labels = MODE_LABELS[mode];
  const isUpcoming = mode === "upcoming";
  const isLogbook = mode === "logbook";
  const eventbriteEnabled = isFeatureOn("EventbriteImportEnabled");

  const PAGE_SIZE = compact ? 10 : 12;

  // Show row context menu + watching → ticketed transition modal.
  const {
    openContextMenu: handleContextMenu,
    portal: showContextMenuPortal,
  } = useShowContextMenu<ShowData>();

  // Mobile import action sheet — collapses Gmail / setlist.fm / Eventbrite
  // (and Delete All) behind a single "Import" button on phone-sized viewports
  // so the header doesn't eat the entire screen.
  const [mobileImportOpen, setMobileImportOpen] = useState(false);

  const prefsQuery = trpc.preferences.get.useQuery(undefined, {
    staleTime: 60_000,
  });
  const acceptGmailScanMutation = trpc.preferences.acceptGmailScan.useMutation();

  const filter = useShowsFilter({ mode, pageSize: PAGE_SIZE });
  const {
    isLoading, error,
    shows, allShowsUnfiltered,
    viewMode, setViewMode,
    selectedYear, setSelectedYear,
    selectedKind, setSelectedKind,
    upcomingFilter, setUpcomingFilter,
    searchQuery, setSearchQuery,
    sort, toggleSort,
    currentPage, setCurrentPage,
    calView, setCalView,
    calMonth, setCalMonth,
    calYear, setCalYear,
    statsTimeframe, setStatsTimeframe,
    filteredShows, pagedShows, dateTbdShows,
    totalPages,
    allYears, yearButtons,
    totalShows, ticketedCount, watchingCount, pastCount,
  } = filter;

  const deleteAllShows = trpc.shows.deleteAll.useMutation();
  const utils = trpc.useUtils();
  const invalidateSidebarCounts = useInvalidateSidebarCounts();

  const isDuplicate = useCallback(
    (ticket: { headliner: string; date: string | null }) => {
      if (allShowsUnfiltered.length === 0) return false;
      return allShowsUnfiltered.some((show) => {
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

  const scan = useBulkImportScan({ isDuplicate });

  // Back-compat: ?gmail=1 still opens Gmail. New: ?import=gmail|setlistfm|eventbrite.
  useEffect(() => {
    const importParam = searchParams.get("import");
    const isValidImport =
      importParam === "gmail" ||
      importParam === "setlistfm" ||
      (importParam === "eventbrite" && eventbriteEnabled);
    if (isValidImport) {
      scan.openModal(importParam as ImportSource);
      router.replace(isUpcoming ? "/upcoming" : "/logbook");
      return;
    }
    if (importParam === "eventbrite" && !eventbriteEnabled) {
      // Flag-OFF backdoor seal: strip the param without opening the modal.
      router.replace(isUpcoming ? "/upcoming" : "/logbook");
      return;
    }
    if (searchParams.get("gmail") === "1") {
      scan.openModal("gmail");
      router.replace(isUpcoming ? "/upcoming" : "/logbook");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDeleteAll() {
    if (!confirm(`Delete all ${totalShows} shows? This cannot be undone.`)) return;
    await deleteAllShows.mutateAsync();
    utils.shows.invalidate();
    utils.performers.invalidate();
    invalidateSidebarCounts();
  }

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
              onClick={() => scan.openModal("gmail")}
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
              onClick={() => scan.openModal("setlistfm")}
              title="Import attended shows from setlist.fm"
              style={{
                border: "none",
                borderRight: eventbriteEnabled ? "1px solid var(--rule-strong)" : "none",
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
            {eventbriteEnabled && (
              <button
                onClick={() => scan.openModal("eventbrite")}
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
            )}
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
    if (filteredShows.length === 0 && searchQuery.trim() !== "") {
      // A search is active and nothing matched — a search-specific empty
      // state with a one-tap clear, not the onboarding hero (which would
      // wrongly imply an empty logbook).
      return (
        <div style={{ padding: isMobile ? "20px 16px" : "28px var(--page-pad-x)" }}>
          <EmptyState
            kind="shows"
            title="No matches"
            body={`Nothing in ${labels.title.toLowerCase()} matches “${searchQuery.trim()}”.`}
            action={
              <button
                type="button"
                onClick={() => setSearchQuery("")}
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
                }}
              >
                Clear search
              </button>
            }
          />
        </div>
      );
    }
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
            onClick={() => scan.openModal("gmail")}
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
            onClick={() => scan.openModal("setlistfm")}
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
          {eventbriteEnabled && (
            <button
              type="button"
              onClick={() => scan.openModal("eventbrite")}
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
          )}
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
                    {getHeadliner(s)}
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
      <ListSearchBar
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search shows, artists, venues…"
        isMobile={isMobile}
        testId="shows-search-input"
      />
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
          allShows={allShowsUnfiltered}
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
          shows={allShowsUnfiltered}
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
              ...(eventbriteEnabled
                ? [{ source: "eventbrite" as const, label: "Eventbrite", desc: "Sync past orders", icon: <Ticket size={16} /> }]
                : []),
            ]).map(({ source, label, desc, icon }) => (
              <button
                key={source}
                type="button"
                data-testid={`mobile-import-${source}`}
                onClick={() => {
                  setMobileImportOpen(false);
                  scan.openModal(source);
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
      <BulkImportModal
        scan={scan}
        isDuplicate={isDuplicate}
        gmailScanAccepted={Boolean(prefsQuery.data?.preferences?.acceptedGmailScanAt)}
      />

      {scan.pendingGmailToken ? (
        <GmailConsentModal
          submitting={acceptGmailScanMutation.isPending}
          onCancel={() => scan.setPendingGmailToken(null)}
          onAccept={async () => {
            try {
              await acceptGmailScanMutation.mutateAsync();
              await utils.preferences.get.invalidate();
              const tok = scan.pendingGmailToken;
              scan.setPendingGmailToken(null);
              if (tok) scan.startGmailScan(tok);
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
