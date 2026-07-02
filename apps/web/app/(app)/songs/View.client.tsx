"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Music, Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { CenteredMessage, EmptyState } from "@/components/design-system";
import { PaginationFooter } from "@/components/PaginationFooter";
import { SortHeader } from "@/components/SortHeader";
import {
  DEFAULT_DIR,
  DEFAULT_SORT,
  matchesSearch,
  sortRows,
  type SongRow,
  type SortConfig,
  type SortField,
} from "@/lib/songs/filters";
import { formatDateMedium } from "@showbook/shared";
import { LIST_MAX_WIDTH } from "@/lib/list-layout";

const PAGE_SIZE = 20;

function useWindowWidth() {
  // SSR default — overwritten on mount by the effect below. Don't seed
  // from `window.innerWidth` here: React preserves the SSR state on
  // hydration and never reruns the useState initializer, so the layout
  // would stay frozen at the desktop default until a resize event fires.
  const [width, setWidth] = useState(1440);
  useEffect(() => {
    function onResize() {
      setWidth(window.innerWidth);
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

export default function SongsView() {
  const [sort, setSort] = useState<SortConfig>(DEFAULT_SORT);
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState<number | "all">("all");
  const [firstHeardOnly, setFirstHeardOnly] = useState(false);
  const [tourDebutOnly, setTourDebutOnly] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth <= 767;
  const isHalfWidth = windowWidth < 1024 && !isMobile;

  // The router applies the year / firstHeardOnly / tourDebutOnly
  // filters DB-side so the result set stays small even with thousands
  // of attended songs. The free-text search runs in the browser.
  const listQuery = trpc.songs.list.useQuery(
    {
      firstHeardOnly,
      tourDebutOnly,
      limit: 200,
      ...(yearFilter !== "all" ? { year: yearFilter } : {}),
    },
    { staleTime: 60_000 },
  );

  // Years are fetched independently so the dropdown stays populated
  // when the user picks a single year (the list query above narrows
  // server-side, which would otherwise collapse the available-years
  // set to just the active year).
  const yearsQuery = trpc.songs.years.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });
  const availableYears = yearsQuery.data ?? [];

  // Fire one telemetry ping per mount — same shape as the show-tab
  // events landed in Phase 1.
  const telemetryFired = useRef(false);
  useEffect(() => {
    if (telemetryFired.current) return;
    telemetryFired.current = true;
    void fetch("/api/telemetry/songs-view", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ surface: "page" }),
    }).catch(() => {
      // Telemetry is best-effort; ignore failures.
    });
  }, []);

  const allRows = useMemo<SongRow[]>(
    () => (listQuery.data ?? []) as SongRow[],
    [listQuery.data],
  );

  const filtered = useMemo(() => {
    let result = allRows;
    if (search) result = result.filter((r) => matchesSearch(r, search));
    return sortRows(result, sort);
  }, [allRows, search, sort]);

  useEffect(() => {
    setCurrentPage(0);
  }, [search, sort.field, sort.dir, yearFilter, firstHeardOnly, tourDebutOnly]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );

  function toggleSort(field: SortField) {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { field, dir: DEFAULT_DIR[field] },
    );
  }

  if (listQuery.isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        <div style={{ padding: "16px var(--page-pad-x)", borderBottom: "1px solid var(--rule)", flexShrink: 0, height: 52 }} />
        <div style={{ padding: "10px var(--page-pad-x)", borderBottom: "1px solid var(--rule)", flexShrink: 0, height: 44, background: "var(--surface)" }} />
        <div style={{ flex: 1, minHeight: 0, padding: "12px var(--page-pad-x) 24px", overflow: "hidden" }}>
          <div style={{ background: "var(--surface)" }}>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} style={{ height: 40, borderBottom: "1px solid var(--rule)", background: "var(--surface)" }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (listQuery.error) {
    return <CenteredMessage tone="error">Failed to load songs.</CenteredMessage>;
  }

  // Tighter column distribution: artist sized to its content, count
  // and date columns sized to their data so the spread between header
  // and value stays small even on very wide screens. Mobile collapses
  // artist under the title.
  // Tight columns: title takes the bulk of the row, artist is capped
  // so short names ("M83", "HAIM") don't leave a giant gap before the
  // numeric/date columns. Mobile collapses artist under the title so
  // the row stays scannable at 390px wide. The list is also wrapped
  // in a maxWidth container below so on very wide displays the rows
  // don't stretch full-width and the inter-column whitespace stays
  // reasonable.
  const gridCols = isMobile
    ? "minmax(0, 1fr) 36px 86px 28px"
    : isHalfWidth
    ? "minmax(0, 1fr) minmax(110px, 180px) 52px 92px 32px"
    : "minmax(0, 1fr) minmax(140px, 240px) 56px 96px 32px";

  const listMaxWidth = isMobile ? undefined : LIST_MAX_WIDTH;

  const rowGap = isMobile ? 10 : 16;
  const rowPadX = isMobile ? 12 : 18;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Header */}
      <div style={{ padding: "16px var(--page-pad-x)", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--rule)" }}>
        <div>
          <div className="eyebrow">Songs you&apos;ve heard live</div>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, color: "var(--ink)", letterSpacing: "-0.01em", lineHeight: 1.1, marginTop: 4 }}>
            Songs
          </h1>
        </div>
      </div>

      {/* Filter bar */}
      <div
        style={{
          padding: "11px var(--page-pad-x)",
          display: "flex",
          alignItems: "center",
          gap: isMobile ? 8 : 12,
          flexWrap: "wrap",
          background: "var(--surface)",
          borderBottom: "1px solid var(--rule)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            border: "1px solid var(--rule-strong)",
            minWidth: isMobile ? 0 : 200,
            flex: isMobile ? "1 1 100%" : undefined,
          }}
        >
          <Search size={12} color="var(--muted)" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="filter song titles, artists..."
            data-testid="songs-search"
            style={{
              border: "none",
              background: "transparent",
              color: "var(--ink)",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 11,
              outline: "none",
              width: "100%",
              letterSpacing: ".02em",
            }}
          />
        </div>

        <YearSelect
          years={availableYears}
          value={yearFilter}
          onChange={setYearFilter}
        />

        <ToggleChip
          label={isMobile ? "First only" : "First time only"}
          active={firstHeardOnly}
          onClick={() => setFirstHeardOnly((v) => !v)}
          testId="filter-first-heard"
        />
        <ToggleChip
          label={isMobile ? "Debuts" : "Tour debuts"}
          active={tourDebutOnly}
          onClick={() => setTourDebutOnly((v) => !v)}
          testId="filter-tour-debuts"
        />

        <div style={{ flex: 1 }} />
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10.5,
            color: "var(--faint)",
            letterSpacing: ".04em",
          }}
          data-testid="songs-result-count"
        >
          {filtered.length} song{filtered.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* List */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          background: "var(--bg)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "18px var(--page-pad-x) 8px", display: "flex", alignItems: "baseline", gap: 14 }}>
          <div
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 11,
              color: "var(--ink)",
              letterSpacing: ".1em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            {search ? "Matching" : "All songs"} &middot; {filtered.length}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: "28px var(--page-pad-x)" }}>
            <EmptyState
              kind="artists"
              title={search || yearFilter !== "all" || firstHeardOnly || tourDebutOnly ? "No songs match" : "No songs yet"}
              body={
                search || yearFilter !== "all" || firstHeardOnly || tourDebutOnly
                  ? "Loosen the filters above to see more of your live history."
                  : "Add a show with a setlist and your live-song catalog starts to grow here."
              }
            />
          </div>
        ) : (
          <div style={{ margin: "4px var(--page-pad-x) 0", background: "var(--surface)", maxWidth: listMaxWidth }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: gridCols,
                columnGap: rowGap,
                padding: `10px ${rowPadX}px`,
                borderBottom: "1px solid var(--rule)",
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 9.5,
                color: "var(--faint)",
                letterSpacing: ".12em",
                textTransform: "uppercase",
              }}
            >
              <SortHeader<SortField> field="title" label="Title" sort={sort} onToggle={toggleSort} />
              {!isMobile && (
                <SortHeader<SortField> field="performer" label="Artist" sort={sort} onToggle={toggleSort} />
              )}
              <SortHeader<SortField> field="count" label="Heard" sort={sort} onToggle={toggleSort} align="right" />
              <SortHeader<SortField> field="last" label="Last" sort={sort} onToggle={toggleSort} align="right" />
              <div style={{ textAlign: "center" }} />
            </div>

            {paged.map((row) => (
              <Link
                key={row.songId}
                href={`/songs/${row.songId}`}
                data-testid="songs-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: gridCols,
                  columnGap: rowGap,
                  padding: `${isMobile ? 10 : 11}px ${rowPadX}px`,
                  borderBottom: "1px solid var(--rule)",
                  alignItems: "center",
                  cursor: "pointer",
                  color: "inherit",
                  textDecoration: "none",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface2, var(--surface))")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: isMobile ? "column" : "row",
                    alignItems: isMobile ? "flex-start" : "center",
                    gap: isMobile ? 2 : 8,
                    minWidth: 0,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, maxWidth: "100%" }}>
                    <Music size={12} color="var(--muted)" style={{ flexShrink: 0 }} />
                    <span
                      style={{
                        fontFamily: "var(--font-geist-sans), sans-serif",
                        fontSize: 14,
                        fontWeight: 500,
                        color: "var(--ink)",
                        letterSpacing: -0.2,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {row.title}
                    </span>
                  </div>
                  {isMobile && (
                    <span
                      style={{
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontSize: 10.5,
                        color: "var(--muted)",
                        letterSpacing: ".02em",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: "100%",
                        paddingLeft: 20,
                      }}
                    >
                      {row.performerName}
                    </span>
                  )}
                </div>
                {!isMobile && (
                  <div
                    style={{
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 11,
                      color: "var(--muted)",
                      letterSpacing: ".02em",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {row.performerName}
                  </div>
                )}
                <div
                  style={{
                    textAlign: "right",
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 12,
                    fontWeight: 500,
                    color: row.timesHeard > 1 ? "var(--ink)" : "var(--faint)",
                    fontFeatureSettings: '"tnum"',
                  }}
                >
                  {row.timesHeard}
                </div>
                <div
                  style={{
                    textAlign: "right",
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 11,
                    color: "var(--muted)",
                    letterSpacing: ".02em",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatDateMedium(row.lastHeard)}
                </div>
                <div
                  style={{
                    textAlign: "center",
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 12,
                    color: row.isUserDebut ? "var(--accent)" : "var(--faint)",
                  }}
                  title={row.isUserDebut ? "Heard exactly once — your tour debut catch" : ""}
                >
                  {row.isUserDebut ? "🆕" : ""}
                </div>
              </Link>
            ))}
          </div>
        )}

        {filtered.length > 0 && (
          <PaginationFooter
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={PAGE_SIZE}
            totalItems={filtered.length}
            itemLabel="songs"
            onPageChange={setCurrentPage}
            maxWidth={listMaxWidth}
          />
        )}
      </div>
    </div>
  );
}

function ToggleChip({
  label,
  active,
  onClick,
  testId,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      data-active={active}
      style={{
        padding: "5px 10px",
        border: `1px solid ${active ? "var(--accent)" : "var(--rule-strong)"}`,
        background: active ? "var(--accent)" : "transparent",
        color: active ? "var(--accent-text)" : "var(--ink)",
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 10.5,
        letterSpacing: ".04em",
        cursor: "pointer",
        textTransform: "uppercase",
      }}
    >
      {label}
    </button>
  );
}

function YearSelect({
  years,
  value,
  onChange,
}: {
  years: number[];
  value: number | "all";
  onChange: (next: number | "all") => void;
}) {
  return (
    <select
      data-testid="filter-year"
      value={value === "all" ? "all" : String(value)}
      onChange={(e) => {
        const next = e.target.value;
        onChange(next === "all" ? "all" : parseInt(next, 10));
      }}
      style={{
        padding: "5px 10px",
        border: "1px solid var(--rule-strong)",
        background: "transparent",
        color: "var(--ink)",
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 10.5,
        letterSpacing: ".04em",
        textTransform: "uppercase",
      }}
    >
      <option value="all">All years</option>
      {years.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>
  );
}
