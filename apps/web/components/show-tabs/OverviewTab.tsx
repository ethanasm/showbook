"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Ticket, CalendarPlus, Trash2, MoreHorizontal } from "lucide-react";
import { SectionFrame } from "./SectionFrame";
import { StatRow, type StatCell } from "./StatRow";
import "./show-tabs.css";

export interface OverviewLineupEntry {
  performerId: string;
  name: string;
  role: string;
  characterName?: string | null;
  sortOrder: number;
}

interface OverviewTabProps {
  showId: string;
  isPast: boolean;
  state: "past" | "ticketed" | "watching";
  cells: StatCell[];
  lineup: OverviewLineupEntry[];
  artistHistorySummary?: string | null;
  venueHistorySummary?: string | null;
  onMarkAttended?: () => void;
  onEdit: () => void;
  onAddToCalendarHref: string;
  onDelete: () => void;
  /**
   * Placeholders to drop in the music-layer slot (pre-show: vibe
   * radar + fan loyalty empty states). Pass nothing to hide the
   * music-layer block entirely.
   */
  musicLayerPlaceholder?: React.ReactNode;
}

/**
 * Overview tab — the canonical "what is this show" landing surface.
 * Shows the stat row, music-layer placeholder block (when supplied),
 * lineup, history, and actions. Past shows get the "went" badge in
 * the title block (handled by the parent's `ShowTitleBlock`); this
 * component only handles the tab body.
 */
export function OverviewTab({
  isPast,
  state,
  cells,
  lineup,
  artistHistorySummary,
  venueHistorySummary,
  onMarkAttended,
  onEdit,
  onAddToCalendarHref,
  onDelete,
  musicLayerPlaceholder,
}: OverviewTabProps) {
  const showActions: { label: string; icon: React.ReactNode; onClick?: () => void; href?: string; danger?: boolean; primary?: boolean; testId?: string }[] = [];
  if (state === "ticketed" && onMarkAttended) {
    showActions.push({
      label: "Mark as attended",
      icon: <Ticket size={13} />,
      onClick: onMarkAttended,
      primary: true,
    });
  }
  showActions.push({
    label: "Edit show",
    icon: <MoreHorizontal size={13} />,
    onClick: onEdit,
    // Legacy test contract — the e2e `show-detail.spec.ts` clicks this
    // testid; keep the name stable across the layout swap.
    testId: "action-edit-show",
  });
  showActions.push({
    label: "Add to calendar",
    icon: <CalendarPlus size={13} />,
    href: onAddToCalendarHref,
    testId: "add-to-calendar",
  });
  showActions.push({
    label: "Delete",
    icon: <Trash2 size={13} />,
    onClick: onDelete,
    danger: true,
  });

  return (
    <div>
      <StatRow cells={cells} />

      {musicLayerPlaceholder && (
        <SectionFrame title={isPast ? "Show shape" : "Music layer"}>
          {musicLayerPlaceholder}
        </SectionFrame>
      )}

      <SectionFrame title="Lineup" count={lineup.length}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {lineup.map((entry) => (
            <Link
              key={entry.performerId}
              href={`/artists/${entry.performerId}`}
              style={{
                display: "block",
                padding: "16px 18px",
                background: "var(--surface)",
                borderLeft: "2px solid var(--accent)",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 9.5,
                  color: "var(--faint)",
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                }}
              >
                {entry.role}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: 19,
                  fontWeight: 600,
                  color: "var(--ink)",
                  letterSpacing: -0.4,
                }}
              >
                {entry.name}
              </div>
              {entry.characterName && (
                <div
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 10.5,
                    color: "var(--muted)",
                    marginTop: 4,
                    letterSpacing: ".02em",
                  }}
                >
                  as {entry.characterName}
                </div>
              )}
            </Link>
          ))}
          {lineup.length === 0 && (
            <div
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                color: "var(--muted)",
                letterSpacing: ".02em",
              }}
            >
              No performers listed yet.
            </div>
          )}
        </div>
      </SectionFrame>

      <SectionFrame title="Your history">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 10,
          }}
        >
          {[
            { label: "Artist", value: artistHistorySummary ?? "First show with this lineup" },
            { label: "Venue", value: venueHistorySummary ?? "First time at this venue" },
          ].map((row) => (
            <div
              key={row.label}
              style={{
                padding: "14px 16px",
                background: "var(--surface)",
                border: "1px solid var(--rule)",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 9.5,
                  color: "var(--faint)",
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                }}
              >
                {row.label}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: 15,
                  color: "var(--ink)",
                  fontWeight: 500,
                  marginTop: 4,
                  letterSpacing: -0.2,
                }}
              >
                {row.value}
              </div>
            </div>
          ))}
        </div>
      </SectionFrame>

      <SectionFrame title="Actions">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {showActions.map((action) => {
            const style: React.CSSProperties = {
              padding: "10px 14px",
              background: action.primary ? "var(--accent)" : "transparent",
              border: action.primary
                ? "none"
                : `1px solid ${action.danger ? "rgba(230,57,70,0.25)" : "var(--rule-strong)"}`,
              color: action.primary
                ? "var(--accent-text)"
                : action.danger
                  ? "#E63946"
                  : "var(--ink)",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 13,
              fontWeight: action.primary ? 600 : 500,
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              cursor: "pointer",
              whiteSpace: "nowrap",
              textDecoration: "none",
            };
            if (action.href) {
              return (
                <a
                  key={action.label}
                  href={action.href}
                  style={style}
                  data-testid={action.testId}
                >
                  {action.icon} {action.label}
                </a>
              );
            }
            return (
              <button
                key={action.label}
                type="button"
                style={style}
                onClick={action.onClick}
                data-testid={action.testId}
              >
                {action.icon} {action.label}
              </button>
            );
          })}
        </div>
      </SectionFrame>
    </div>
  );
}

OverviewTab.useRouter = useRouter;
