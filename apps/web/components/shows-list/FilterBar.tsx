"use client";

import type { ShowKind } from "@/components/design-system";
import { KIND_ICONS, KIND_LABELS } from "@/lib/kind-icons";
import { ALL_KINDS } from "./helpers";

/**
 * Filter strip under the page header. Two modes:
 *   - logbook: year-only chips (All · 2024 · 2023 · … · older)
 *   - upcoming: state chips (All · Tickets · Watching)
 * Both modes share the kind toggles + the filtered-count read-out.
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
        <div
          data-testid="logbook-year-filter"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 0,
            border: "1px solid var(--rule-strong)",
          }}
        >
          {yearButtons.map((y, i, arr) => {
            const active = y === selectedYear;
            return (
              <div
                key={y}
                onClick={() => onSelectYear(y)}
                style={{
                  padding: "5px 11px",
                  borderRight:
                    i === arr.length - 1 ? "none" : "1px solid var(--rule-strong)",
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
        <div
          data-testid="upcoming-state-filter"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 0,
            border: "1px solid var(--rule-strong)",
          }}
        >
          {UPCOMING_CHIPS.map(({ k, l }, i, arr) => {
            const active = upcomingFilter === k;
            return (
              <button
                key={k}
                type="button"
                data-testid={`upcoming-filter-${k}`}
                onClick={() => onUpcomingFilterChange(k)}
                style={{
                  padding: "5px 11px",
                  borderRight:
                    i === arr.length - 1 ? "none" : "1px solid var(--rule-strong)",
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
              onClick={() => onSelectKind(active ? null : k)}
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
