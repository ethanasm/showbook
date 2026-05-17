"use client";

import type { ShowKind } from "@/components/design-system";
import { KIND_ICONS, KIND_LABELS } from "@/lib/kind-icons";
import { ALL_KINDS } from "./helpers";
import "@/components/design-system/segmented-filter.css";

/**
 * Filter strip under the page header. Two modes:
 *   - logbook: year-only chips (All time · 2024 · 2023 · … · older)
 *   - upcoming: state chips (All · Tickets · Watching)
 * Both modes share the kind toggles + the filtered-count read-out.
 *
 * The chip group uses the shared `.segmented-filter` styling so the
 * year/state strip and the kind strip render as flush segmented
 * controls with identical heights, matching the /map filter bar.
 */
export type UpcomingFilter = "all" | "ticketed" | "watching";

export interface FilterBarProps {
  isMobile: boolean;
  isLogbook: boolean;
  /** Year buttons shown when `isLogbook` is true. */
  yearButtons: string[];
  selectedYear: string;
  onSelectYear: (next: string) => void;
  upcomingFilter: UpcomingFilter;
  onUpcomingFilterChange: (next: UpcomingFilter) => void;
  selectedKind: ShowKind | null;
  onSelectKind: (next: ShowKind | null) => void;
  filteredCount: number;
}

const UPCOMING_CHIPS: { k: UpcomingFilter; l: string }[] = [
  { k: "all", l: "All" },
  { k: "ticketed", l: "Tickets" },
  { k: "watching", l: "Watching" },
];

export function FilterBar({
  isMobile,
  isLogbook,
  yearButtons,
  selectedYear,
  onSelectYear,
  upcomingFilter,
  onUpcomingFilterChange,
  selectedKind,
  onSelectKind,
  filteredCount,
}: FilterBarProps) {
  return (
    <div
      style={{
        padding: isMobile ? "11px 16px" : "11px var(--page-pad-x)",
        display: "flex",
        alignItems: "center",
        gap: isMobile ? 12 : 18,
        flexWrap: "wrap",
        background: "var(--surface)",
        borderBottom: isMobile ? "1px solid var(--rule-strong)" : "1px solid var(--rule)",
        // Mobile: pin the in-list filter row so users can flip year / kind /
        // upcoming-vs-watching mid-scroll without scrolling back to the top.
        // Desktop has the sidebar + a non-scrolling header band, so sticky is
        // mobile-only.
        ...(isMobile ? { position: "sticky" as const, top: 0, zIndex: 5 } : {}),
      }}
    >
      {/* Mode-specific primary filter */}
      {isLogbook ? (
        <div data-testid="logbook-year-filter" className="segmented-filter">
          {yearButtons.map((y) => {
            const active = y === selectedYear;
            return (
              <button
                key={y}
                type="button"
                onClick={() => onSelectYear(y)}
                className={`segmented-filter__btn ${
                  active ? "segmented-filter__btn--active" : ""
                }`}
              >
                {y}
              </button>
            );
          })}
        </div>
      ) : (
        <div data-testid="upcoming-state-filter" className="segmented-filter">
          {UPCOMING_CHIPS.map(({ k, l }) => {
            const active = upcomingFilter === k;
            return (
              <button
                key={k}
                type="button"
                data-testid={`upcoming-filter-${k}`}
                onClick={() => onUpcomingFilterChange(k)}
                className={`segmented-filter__btn ${
                  active ? "segmented-filter__btn--active" : ""
                }`}
              >
                {l}
              </button>
            );
          })}
        </div>
      )}

      {/* Kind chips — All kinds is the no-filter sentinel. */}
      <div className="segmented-filter">
        <button
          key="all"
          type="button"
          onClick={() => onSelectKind(null)}
          className={`segmented-filter__btn segmented-filter__btn--kind ${
            selectedKind === null ? "segmented-filter__btn--active" : ""
          }`}
        >
          All kinds
        </button>
        {ALL_KINDS.map((k) => {
          const KIcon = KIND_ICONS[k];
          const active = selectedKind === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => onSelectKind(active ? null : k)}
              className={`segmented-filter__btn segmented-filter__btn--kind ${
                active ? `segmented-filter__btn--active-${k}` : ""
              }`}
            >
              <KIcon size={12} color={active ? "var(--bg)" : `var(--kind-${k})`} />
              {KIND_LABELS[k]}
            </button>
          );
        })}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Filtered count */}
      <div
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 10.5,
          color: "var(--faint)",
          letterSpacing: ".04em",
        }}
      >
        {filteredCount} show{filteredCount !== 1 ? "s" : ""}
      </div>
    </div>
  );
}
