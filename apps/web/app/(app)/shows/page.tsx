"use client";

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  ShowRow,
  SegmentedControl,
  KindBadge,
  type ShowKind,
  type ShowState,
} from "@/components/design-system";
import styles from "./shows.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewMode = "List" | "Calendar" | "Stats";

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

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
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

function groupByMonth(shows: ShowData[]): Map<string, ShowData[]> {
  const groups = new Map<string, ShowData[]>();
  for (const show of shows) {
    const d = new Date(show.date + "T00:00:00");
    const key = d.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(show);
  }
  return groups;
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
// Calendar helpers
// ---------------------------------------------------------------------------

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ShowsPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("List");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [expandedShowId, setExpandedShowId] = useState<string | null>(null);

  // Calendar state
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calSelectedDay, setCalSelectedDay] = useState<string | null>(null);

  // State transition modal
  const [transitionShow, setTransitionShow] = useState<ShowData | null>(null);
  const [transitionSeat, setTransitionSeat] = useState("");
  const [transitionPrice, setTransitionPrice] = useState("");

  // Fetch all shows (no filter — we filter client-side for flexibility)
  const {
    data: allShows,
    isLoading,
    error,
  } = trpc.shows.list.useQuery({
    year: selectedYear ?? undefined,
  });

  const updateState = trpc.shows.updateState.useMutation();
  const deleteShow = trpc.shows.delete.useMutation();
  const utils = trpc.useUtils();

  const shows = (allShows ?? []) as ShowData[];

  const years = useMemo(() => {
    // We need all shows to compute years, so also fetch without year filter
    return getUniqueYears(shows);
  }, [shows]);

  // For the year rail, we also need to know all years even when filtered.
  // We'll use a separate query with no year filter just for the year rail.
  const { data: allShowsUnfiltered } = trpc.shows.list.useQuery({});
  const allYears = useMemo(
    () => getUniqueYears((allShowsUnfiltered ?? []) as ShowData[]),
    [allShowsUnfiltered]
  );

  // Group shows by month for list view
  const groupedShows = useMemo(() => groupByMonth(shows), [shows]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleRowClick(showId: string) {
    setExpandedShowId((prev) => (prev === showId ? null : showId));
  }

  async function handleStateTransition(show: ShowData) {
    const transition = STATE_TRANSITIONS[show.state];
    if (!transition) return;

    // If watching -> ticketed, need seat info
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
  // Render: Loading / Error / Empty
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>Loading shows...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.error}>Failed to load shows.</div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Calendar View
  // ---------------------------------------------------------------------------

  function renderCalendar() {
    const daysInMonth = getDaysInMonth(calYear, calMonth);
    const firstDay = getFirstDayOfWeek(calYear, calMonth);
    const monthLabel = new Date(calYear, calMonth).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });

    // Build a map of day -> shows for the current month
    const dayShowsMap = new Map<number, ShowData[]>();
    for (const show of shows) {
      const d = new Date(show.date + "T00:00:00");
      if (d.getMonth() === calMonth && d.getFullYear() === calYear) {
        const day = d.getDate();
        if (!dayShowsMap.has(day)) dayShowsMap.set(day, []);
        dayShowsMap.get(day)!.push(show);
      }
    }

    const cells: React.ReactNode[] = [];

    // Empty cells for days before the first day
    for (let i = 0; i < firstDay; i++) {
      cells.push(<div key={`empty-${i}`} className={styles.calCell} />);
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dayShows = dayShowsMap.get(day) ?? [];
      const isSelected = calSelectedDay === dateStr;

      cells.push(
        <div
          key={day}
          className={`${styles.calCell} ${styles.calCellDay} ${isSelected ? styles.calCellSelected : ""}`}
          onClick={() => setCalSelectedDay(isSelected ? null : dateStr)}
        >
          <span className={styles.calDayNum}>{day}</span>
          {dayShows.length > 0 && (
            <div className={styles.calDots}>
              {dayShows.map((s) => (
                <span
                  key={s.id}
                  className={styles.calDot}
                  style={{ background: `var(--kind-${s.kind})` }}
                />
              ))}
            </div>
          )}
        </div>
      );
    }

    // Find shows for the selected day
    const selectedDayShows = calSelectedDay
      ? shows.filter((s) => s.date === calSelectedDay)
      : [];

    return (
      <div className={styles.calendar}>
        <div className={styles.calNav}>
          <button
            className={styles.calNavBtn}
            onClick={() => {
              if (calMonth === 0) {
                setCalMonth(11);
                setCalYear((y) => y - 1);
              } else {
                setCalMonth((m) => m - 1);
              }
              setCalSelectedDay(null);
            }}
          >
            &larr;
          </button>
          <span className={styles.calMonthLabel}>{monthLabel}</span>
          <button
            className={styles.calNavBtn}
            onClick={() => {
              if (calMonth === 11) {
                setCalMonth(0);
                setCalYear((y) => y + 1);
              } else {
                setCalMonth((m) => m + 1);
              }
              setCalSelectedDay(null);
            }}
          >
            &rarr;
          </button>
        </div>

        <div className={styles.calHeader}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className={styles.calHeaderCell}>
              {d}
            </div>
          ))}
        </div>

        <div className={styles.calGrid}>{cells}</div>

        {calSelectedDay && (
          <div className={styles.calDayList}>
            <div className={styles.calDayListTitle}>
              {formatDate(calSelectedDay)}
            </div>
            {selectedDayShows.length === 0 ? (
              <div className={styles.calDayListEmpty}>No shows this day</div>
            ) : (
              selectedDayShows.map((show) => (
                <ShowRow
                  key={show.id}
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
                />
              ))
            )}
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Stats View
  // ---------------------------------------------------------------------------

  function renderStats() {
    const totalShows = shows.length;

    // Shows per year
    const perYear = new Map<number, number>();
    for (const show of shows) {
      const y = getYear(show.date);
      perYear.set(y, (perYear.get(y) ?? 0) + 1);
    }
    const yearEntries = Array.from(perYear.entries()).sort((a, b) => b[0] - a[0]);

    // Shows per kind
    const perKind = new Map<ShowKind, number>();
    for (const show of shows) {
      perKind.set(show.kind, (perKind.get(show.kind) ?? 0) + 1);
    }
    const kindEntries = Array.from(perKind.entries()).sort((a, b) => b[1] - a[1]);

    // Top 5 venues
    const perVenue = new Map<string, number>();
    for (const show of shows) {
      const key = show.venue.name;
      perVenue.set(key, (perVenue.get(key) ?? 0) + 1);
    }
    const topVenues = Array.from(perVenue.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const maxYearCount = Math.max(...yearEntries.map(([, c]) => c), 1);
    const maxKindCount = Math.max(...kindEntries.map(([, c]) => c), 1);

    return (
      <div className={styles.stats}>
        {/* Total */}
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Total Shows</div>
          <div className={styles.statValue}>{totalShows}</div>
        </div>

        {/* Per year */}
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Shows per Year</div>
          {yearEntries.length === 0 ? (
            <div className={styles.statEmpty}>No data</div>
          ) : (
            <div className={styles.barChart}>
              {yearEntries.map(([year, count]) => (
                <div key={year} className={styles.barRow}>
                  <span className={styles.barLabel}>{year}</span>
                  <div className={styles.barTrack}>
                    <div
                      className={styles.barFill}
                      style={{
                        width: `${(count / maxYearCount) * 100}%`,
                        background: "var(--marquee-gold)",
                      }}
                    />
                  </div>
                  <span className={styles.barCount}>{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Per kind */}
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Shows by Kind</div>
          {kindEntries.length === 0 ? (
            <div className={styles.statEmpty}>No data</div>
          ) : (
            <div className={styles.barChart}>
              {kindEntries.map(([kind, count]) => (
                <div key={kind} className={styles.barRow}>
                  <span className={styles.barLabel}>
                    <KindBadge kind={kind} />
                  </span>
                  <div className={styles.barTrack}>
                    <div
                      className={styles.barFill}
                      style={{
                        width: `${(count / maxKindCount) * 100}%`,
                        background: `var(--kind-${kind})`,
                      }}
                    />
                  </div>
                  <span className={styles.barCount}>{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top venues */}
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Top Venues</div>
          {topVenues.length === 0 ? (
            <div className={styles.statEmpty}>No data</div>
          ) : (
            <div className={styles.venueList}>
              {topVenues.map(([name, count], i) => (
                <div key={name} className={styles.venueRow}>
                  <span className={styles.venueRank}>{i + 1}</span>
                  <span className={styles.venueName}>{name}</span>
                  <span className={styles.venueCount}>
                    {count} {count === 1 ? "show" : "shows"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Detail Panel
  // ---------------------------------------------------------------------------

  function renderDetailPanel(show: ShowData) {
    const performers = [...show.showPerformers].sort(
      (a, b) => a.sortOrder - b.sortOrder
    );
    const transition = STATE_TRANSITIONS[show.state];

    return (
      <div className={styles.detail}>
        {/* Performers */}
        <div className={styles.detailSection}>
          <div className={styles.detailSectionTitle}>Performers</div>
          {performers.map((sp) => (
            <div key={`${sp.performer.id}-${sp.role}`} className={styles.performerRow}>
              <span className={styles.performerName}>{sp.performer.name}</span>
              <span className={styles.performerRole}>
                {sp.role}
                {sp.characterName ? ` (${sp.characterName})` : ""}
              </span>
            </div>
          ))}
        </div>

        {/* Tour name */}
        {show.tourName && (
          <div className={styles.detailSection}>
            <div className={styles.detailSectionTitle}>Tour</div>
            <div className={styles.detailText}>{show.tourName}</div>
          </div>
        )}

        {/* Setlist */}
        {show.setlist && show.setlist.length > 0 && (
          <div className={styles.detailSection}>
            <div className={styles.detailSectionTitle}>Setlist</div>
            <ol className={styles.setlist}>
              {show.setlist.map((song, i) => (
                <li key={i} className={styles.setlistItem}>
                  {song}
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Seat & price */}
        <div className={styles.detailMeta}>
          {show.seat && (
            <div className={styles.detailMetaItem}>
              <span className={styles.detailMetaLabel}>Seat</span>
              <span className={styles.detailMetaValue}>{show.seat}</span>
            </div>
          )}
          {show.pricePaid && (
            <div className={styles.detailMetaItem}>
              <span className={styles.detailMetaLabel}>Price</span>
              <span className={styles.detailMetaValue}>
                ${parseFloat(show.pricePaid).toFixed(2)}
              </span>
            </div>
          )}
          <div className={styles.detailMetaItem}>
            <span className={styles.detailMetaLabel}>Kind</span>
            <KindBadge kind={show.kind} />
          </div>
        </div>

        {/* Photos placeholder */}
        {show.photos && show.photos.length > 0 && (
          <div className={styles.detailSection}>
            <div className={styles.detailSectionTitle}>Photos</div>
            <div className={styles.photosPlaceholder}>
              {show.photos.length} photo{show.photos.length !== 1 ? "s" : ""}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className={styles.detailActions}>
          {transition && (
            <button
              className={styles.actionBtn}
              onClick={() => handleStateTransition(show)}
              disabled={updateState.isPending}
            >
              {transition.label}
            </button>
          )}
          <button
            className={styles.deleteBtn}
            onClick={() => handleDelete(show.id)}
            disabled={deleteShow.isPending}
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: List View
  // ---------------------------------------------------------------------------

  function renderList() {
    if (shows.length === 0) {
      return (
        <div className={styles.empty}>
          <div className={styles.emptyText}>
            No shows yet. Add your first show!
          </div>
        </div>
      );
    }

    return (
      <div className={styles.list}>
        {Array.from(groupedShows.entries()).map(([monthLabel, monthShows]) => (
          <div key={monthLabel} className={styles.monthGroup}>
            <div className={styles.monthLabel}>{monthLabel}</div>
            {monthShows.map((show) => (
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
          </div>
        ))}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Page
  // ---------------------------------------------------------------------------

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.title}>Shows</h1>
        <SegmentedControl
          options={["List", "Calendar", "Stats"]}
          selected={viewMode}
          onChange={(v) => setViewMode(v as ViewMode)}
        />
      </div>

      {/* Year rail (only for List view) */}
      {viewMode === "List" && (
        <div className={styles.yearRail}>
          <button
            className={`${styles.yearBtn} ${selectedYear === null ? styles.yearBtnActive : ""}`}
            onClick={() => setSelectedYear(null)}
          >
            All
          </button>
          {allYears.map((year) => (
            <button
              key={year}
              className={`${styles.yearBtn} ${selectedYear === year ? styles.yearBtnActive : ""}`}
              onClick={() =>
                setSelectedYear(selectedYear === year ? null : year)
              }
            >
              {year}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {viewMode === "List" && renderList()}
      {viewMode === "Calendar" && renderCalendar()}
      {viewMode === "Stats" && renderStats()}

      {/* State transition modal */}
      {transitionShow && (
        <div className={styles.modalOverlay} onClick={() => setTransitionShow(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>
              Got tickets for {getHeadliner(transitionShow)}?
            </div>
            <div className={styles.modalField}>
              <label className={styles.modalLabel}>Seat</label>
              <input
                className={styles.modalInput}
                value={transitionSeat}
                onChange={(e) => setTransitionSeat(e.target.value)}
                placeholder="e.g., Orchestra Row G Seat 12"
              />
            </div>
            <div className={styles.modalField}>
              <label className={styles.modalLabel}>Price paid</label>
              <input
                className={styles.modalInput}
                value={transitionPrice}
                onChange={(e) => setTransitionPrice(e.target.value)}
                placeholder="e.g., 85.00"
                type="number"
                step="0.01"
              />
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.actionBtn}
                onClick={handleTransitionSubmit}
                disabled={!transitionSeat || updateState.isPending}
              >
                {updateState.isPending ? "Saving..." : "Confirm"}
              </button>
              <button
                className={styles.cancelBtn}
                onClick={() => setTransitionShow(null)}
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
