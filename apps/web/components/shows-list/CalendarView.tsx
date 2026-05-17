"use client";

import type React from "react";
import { getHeadliner } from "@/lib/show-accessors";
import {
  MONTH_NAMES,
  MONTHS,
  type CalView,
  type ShowData,
  getDaysInMonth,
  getFirstDayOfWeek,
  toDateParts,
} from "./helpers";

/**
 * Calendar view for the Shows list page. Two sub-views:
 *   - "month" — full grid with day cells, an event sidebar, and
 *     prev/next/today nav across years.
 *   - "year"  — 12 mini-month grids with a single dot per
 *     show-bearing day, plus a year stepper.
 *
 * `shows` is the filtered list rendered as events; `allShows` is
 * the unfiltered list used to compute the navigable year bounds so
 * year-filter toggles in the toolbar don't shrink the range.
 */
export interface CalendarViewProps {
  shows: ShowData[];
  allShows: ShowData[];
  calView: CalView;
  calMonth: number;
  calYear: number;
  setCalView: (next: CalView) => void;
  setCalMonth: (next: number) => void;
  setCalYear: React.Dispatch<React.SetStateAction<number>>;
  isMobile: boolean;
}

export function CalendarView({
  shows,
  allShows,
  calView,
  calMonth,
  calYear,
  setCalView,
  setCalMonth,
  setCalYear,
  isMobile,
}: CalendarViewProps) {
  const today = new Date();

  // Bounds span from Jan of the earliest show year to Dec of the latest
  // show year (always including the current year so "Today" is reachable
  // even when the user has no shows yet). Use the unfiltered show set so
  // that year filters in the toolbar don't shrink the navigable range.
  // Date-TBD watching rows have a null date — they're surfaced on the
  // Date-TBD rail and would crash `new Date(null + "T00:00:00")` if we
  // mapped them blindly, so drop them here.
  const boundsSource = (allShows.length > 0 ? allShows : shows) as ShowData[];
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
    return (
      <YearView
        shows={shows}
        today={today}
        calYear={calYear}
        setCalYear={setCalYear}
        setCalMonth={setCalMonth}
        setCalView={setCalView}
        viewToggle={viewToggle}
        atMinYear={atMinYear}
        atMaxYear={atMaxYear}
        isMobile={isMobile}
      />
    );
  }

  const daysInMonth = getDaysInMonth(calYear, calMonth);
  const firstDay = getFirstDayOfWeek(calYear, calMonth);
  const dayShowsMap = buildDayShowsMap(calYear, calMonth);

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);

  const isToday = (d: number | null) =>
    d !== null &&
    calYear === today.getFullYear() &&
    calMonth === today.getMonth() &&
    d === today.getDate();

  let pastInMonth = 0,
    upInMonth = 0,
    watchInMonth = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dayShows = dayShowsMap.get(d) ?? [];
    for (const s of dayShows) {
      if (s.state === "past") pastInMonth++;
      else if (s.state === "ticketed") upInMonth++;
      else if (s.state === "watching") watchInMonth++;
    }
  }

  const railShows = shows
    .filter((s) => {
      if (!s.date) return false;
      const d = new Date(s.date + "T00:00:00");
      const m = d.getMonth();
      const y = d.getFullYear();
      return (
        (y === calYear && m === calMonth) ||
        (y === calYear && m === calMonth + 1) ||
        (calMonth === 11 && y === calYear + 1 && m === 0)
      );
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <div
      style={{
        background: "var(--bg)",
        padding: isMobile ? "18px 16px 24px" : "22px var(--page-pad-x) var(--page-pad-x)",
        ...(isMobile ? {} : { flex: 1, minHeight: 0, overflow: "auto" }),
      }}
    >
      {/* Month toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: isMobile ? "stretch" : "center",
          justifyContent: "space-between",
          flexDirection: isMobile ? "column" : "row",
          gap: isMobile ? 10 : 0,
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <div
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 30,
              fontWeight: 600,
              color: "var(--ink)",
              letterSpacing: -0.9,
            }}
          >
            {MONTH_NAMES[calMonth]}{" "}
            <span style={{ color: "var(--faint)", fontWeight: 400 }}>{calYear}</span>
          </div>
          <div
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 11,
              color: "var(--muted)",
              letterSpacing: ".06em",
            }}
          >
            {pastInMonth} past &middot; {upInMonth} upcoming &middot; {watchInMonth} watching
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {viewToggle}
          {toolbarNav}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 320px",
          gap: isMobile ? 18 : 22,
          minHeight: 0,
        }}
      >
        {/* Calendar grid */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--rule)" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              borderBottom: "1px solid var(--rule)",
            }}
          >
            {dows.map((d, i) => (
              <div
                key={i}
                style={{
                  padding: "9px 10px",
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 10,
                  color: "var(--faint)",
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                }}
              >
                {d}
              </div>
            ))}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gridAutoRows: "minmax(92px, 1fr)",
            }}
          >
            {cells.map((d, i) => {
              const todayCell = isToday(d);
              const evs = d ? (dayShowsMap.get(d) ?? []) : [];
              return (
                <div
                  key={i}
                  style={{
                    padding: "7px 9px",
                    borderRight: i % 7 === 6 ? "none" : "1px solid var(--rule)",
                    borderBottom: "1px solid var(--rule)",
                    background: todayCell ? "var(--surface2)" : "transparent",
                    opacity: d ? 1 : 0.35,
                    display: "flex",
                    flexDirection: "column",
                    gap: 5,
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 11,
                      color: todayCell
                        ? "var(--ink)"
                        : d
                          ? "var(--muted)"
                          : "var(--faint)",
                      fontWeight: todayCell ? 600 : 400,
                      letterSpacing: ".02em",
                    }}
                  >
                    {d ?? ""}
                  </div>
                  {evs.map((s) => (
                    <div
                      key={s.id}
                      style={{
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontSize: 10,
                        color: "var(--ink)",
                        padding: "3px 6px",
                        background:
                          s.state === "past"
                            ? "transparent"
                            : `var(--kind-${s.kind}, rgba(255,255,255,0.1))`,
                        borderLeft: `2px solid var(--kind-${s.kind})`,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        letterSpacing: ".01em",
                      }}
                    >
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
          <div
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10.5,
              color: "var(--ink)",
              letterSpacing: ".1em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            This month & next
          </div>
          {railShows.map((show) => {
            const dp = toDateParts(show.date);
            const stateTag =
              show.state === "past"
                ? "past"
                : show.state === "ticketed"
                  ? "tix"
                  : "watch";
            return (
              <div
                key={show.id}
                style={{
                  padding: "12px 14px",
                  background: "var(--surface)",
                  borderLeft: `2px solid var(--kind-${show.kind})`,
                  display: "grid",
                  gridTemplateColumns: "58px 1fr auto",
                  columnGap: 12,
                  alignItems: "start",
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: "var(--font-geist-sans), sans-serif",
                      fontSize: 15,
                      fontWeight: 500,
                      color: stateTag === "past" ? "var(--muted)" : "var(--ink)",
                      letterSpacing: -0.3,
                      lineHeight: 1,
                      fontFeatureSettings: '"tnum"',
                    }}
                  >
                    {dp.month} {dp.day}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 9.5,
                      color: "var(--faint)",
                      marginTop: 3,
                    }}
                  >
                    {dp.dow.toLowerCase()}
                  </div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "var(--font-geist-sans), sans-serif",
                      fontSize: 13,
                      fontWeight: 500,
                      color: stateTag === "past" ? "var(--muted)" : "var(--ink)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {getHeadliner(show)}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 10,
                      color: "var(--muted)",
                      marginTop: 2,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {show.venue.name.toLowerCase()}
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 9.5,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    color:
                      stateTag === "past"
                        ? "var(--faint)"
                        : stateTag === "watch"
                          ? "var(--muted)"
                          : "var(--ink)",
                    fontWeight: 500,
                  }}
                >
                  {stateTag}
                </div>
              </div>
            );
          })}
          {railShows.length === 0 && (
            <div
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10.5,
                color: "var(--faint)",
              }}
            >
              No shows this month or next
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface YearViewProps {
  shows: ShowData[];
  today: Date;
  calYear: number;
  setCalYear: React.Dispatch<React.SetStateAction<number>>;
  setCalMonth: (next: number) => void;
  setCalView: (next: CalView) => void;
  viewToggle: React.ReactNode;
  atMinYear: boolean;
  atMaxYear: boolean;
  isMobile: boolean;
}

function YearView({
  shows,
  today,
  calYear,
  setCalYear,
  setCalMonth,
  setCalView,
  viewToggle,
  atMinYear,
  atMaxYear,
  isMobile,
}: YearViewProps) {
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
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 9,
            color: "var(--ink)",
            letterSpacing: ".08em",
            textTransform: "uppercase",
            fontWeight: 500,
            marginBottom: 4,
          }}
        >
          {MONTHS[month]}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 1,
          }}
        >
          {dows.map((d, i) => (
            <div
              key={i}
              style={{
                fontSize: 6,
                color: "var(--faint)",
                textAlign: "center",
                fontFamily: "var(--font-geist-mono), monospace",
              }}
            >
              {d}
            </div>
          ))}
          {cells.map((d, ci) => {
            const dateKey = d
              ? `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
              : null;
            const hasDot = dateKey ? (dateShowsMap.get(dateKey) ?? []).length > 0 : false;
            const isToday =
              d !== null &&
              year === today.getFullYear() &&
              month === today.getMonth() &&
              d === today.getDate();
            return (
              <div
                key={ci}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 10,
                  position: "relative",
                }}
              >
                {d && (
                  <>
                    {isToday && (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          background: "var(--accent)",
                          opacity: 0.15,
                          borderRadius: 1,
                        }}
                      />
                    )}
                    {hasDot && (
                      <div
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: "50%",
                          background: "var(--accent)",
                        }}
                      />
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
    <div
      style={{
        background: "var(--bg)",
        padding: isMobile ? "18px 16px 24px" : "22px var(--page-pad-x) var(--page-pad-x)",
        ...(isMobile ? {} : { flex: 1, minHeight: 0, overflow: "auto" }),
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: isMobile ? "stretch" : "center",
          justifyContent: "space-between",
          flexDirection: isMobile ? "column" : "row",
          gap: isMobile ? 10 : 0,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 30,
            fontWeight: 600,
            color: "var(--ink)",
            letterSpacing: -0.9,
          }}
        >
          {calYear}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {viewToggle}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => {
                if (!atMinYear) setCalYear((y) => y - 1);
              }}
              disabled={atMinYear}
              data-testid="cal-year-prev"
              style={{
                padding: "7px 12px",
                border: "1px solid var(--rule-strong)",
                background: "transparent",
                color: atMinYear ? "var(--faint)" : "var(--ink)",
                cursor: atMinYear ? "not-allowed" : "pointer",
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                opacity: atMinYear ? 0.4 : 1,
              }}
            >
              ‹ {calYear - 1}
            </button>
            <button
              onClick={() => {
                if (!atMaxYear) setCalYear((y) => y + 1);
              }}
              disabled={atMaxYear}
              data-testid="cal-year-next"
              style={{
                padding: "7px 12px",
                border: "1px solid var(--rule-strong)",
                background: "transparent",
                color: atMaxYear ? "var(--faint)" : "var(--ink)",
                cursor: atMaxYear ? "not-allowed" : "pointer",
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                opacity: atMaxYear ? 0.4 : 1,
              }}
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
