"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Ticket,
  CalendarPlus,
  Trash2,
  MoreHorizontal,
  XOctagon,
  Ban,
} from "lucide-react";
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
  onMarkAttended?: () => void;
  onEdit: () => void;
  onAddToCalendarHref: string;
  onDelete: () => void;
  /** Current manual ticket-status override, or null when unset. */
  ticketStatus?: "sold_out" | "cancelled" | null;
  /** Toggle a ticket-status override on/off (clears when already active). */
  onToggleTicketStatus?: (status: "sold_out" | "cancelled") => void;
  /**
   * Header for the performers section. Theatre shows label it "Cast";
   * everything else uses the default "Lineup".
   */
  lineupLabel?: string;
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
 * lineup, and actions. Past shows get the "went" badge in the title
 * block (handled by the parent's `ShowTitleBlock`); this component
 * only handles the tab body.
 */
export function OverviewTab({
  isPast,
  state,
  cells,
  lineup,
  onMarkAttended,
  onEdit,
  onAddToCalendarHref,
  onDelete,
  ticketStatus = null,
  onToggleTicketStatus,
  lineupLabel = "Lineup",
  musicLayerPlaceholder,
}: OverviewTabProps) {
  const showActions: { label: string; icon: React.ReactNode; onClick?: () => void; href?: string; danger?: boolean; primary?: boolean; active?: boolean; testId?: string }[] = [];
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
  if (onToggleTicketStatus) {
    const soldOut = ticketStatus === "sold_out";
    const cancelled = ticketStatus === "cancelled";
    showActions.push({
      label: soldOut ? "Clear sold out" : "Mark sold out",
      icon: <XOctagon size={13} />,
      onClick: () => onToggleTicketStatus("sold_out"),
      active: soldOut,
      testId: "action-mark-sold-out",
    });
    showActions.push({
      label: cancelled ? "Clear cancelled" : "Mark cancelled",
      icon: <Ban size={13} />,
      onClick: () => onToggleTicketStatus("cancelled"),
      active: cancelled,
      testId: "action-mark-cancelled",
    });
  }
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

      <SectionFrame title={lineupLabel} count={lineup.length}>
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

      <SectionFrame title="Actions">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {showActions.map((action) => {
            const style: React.CSSProperties = {
              padding: "10px 14px",
              background: action.primary
                ? "var(--accent)"
                : action.active
                  ? "var(--surface)"
                  : "transparent",
              border: action.primary
                ? "none"
                : `1px solid ${action.danger ? "rgba(230,57,70,0.25)" : action.active ? "var(--ink)" : "var(--rule-strong)"}`,
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
