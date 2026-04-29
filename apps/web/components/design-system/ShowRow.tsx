"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import "./design-system.css";
import { StateChip, type ShowState } from "./StateChip";
import type { ShowKind } from "./KindBadge";
import {
  Music,
  Clapperboard,
  Laugh,
  Tent,
  ChevronRight,
  ChevronDown,
} from "lucide-react";

export interface Show {
  kind: ShowKind;
  state: ShowState;
  headliner: string;
  headlinerId?: string;
  support?: string[];
  supportPerformers?: { id: string; name: string }[];
  venue: string;
  venueId?: string;
  showId?: string;
  neighborhood?: string;
  date: { month: string; day: string; year: string; dow: string };
  seat?: string;
  paid?: number;
  ticketCount?: number;
}

interface ShowRowProps {
  show: Show;
  selected?: boolean;
  missingCoords?: boolean;
  /** When provided, the chevron becomes an inline expand/collapse button. */
  onExpandToggle?: () => void;
  /** Legacy: row-level click handler (used when showId is absent). */
  onClick?: () => void;
  /** Suppress the decorative chevron on the right side of the row. */
  hideChevron?: boolean;
}

const KIND_ICONS: Record<ShowKind, React.ComponentType<{ size?: number; className?: string }>> = {
  concert: Music,
  theatre: Clapperboard,
  comedy: Laugh,
  festival: Tent,
};

const KIND_LABELS: Record<ShowKind, string> = {
  concert: "Concert",
  theatre: "Theatre",
  comedy: "Comedy",
  festival: "Festival",
};

export function ShowRow({
  show,
  selected,
  missingCoords,
  onExpandToggle,
  onClick,
  hideChevron,
}: ShowRowProps) {
  const router = useRouter();

  /* ── bar modifier ── */
  const barClass =
    show.state === "past"
      ? "show-row__bar show-row__bar--past"
      : show.state === "ticketed"
        ? "show-row__bar show-row__bar--ticketed"
        : "show-row__bar show-row__bar--watching";

  const barStyle: React.CSSProperties =
    show.state === "past"
      ? { borderColor: `var(--kind-${show.kind})` }
      : {};

  /* ── kind icon ── */
  const KindIcon = KIND_ICONS[show.kind];

  /* ── paid formatting ── */
  const count = show.ticketCount ?? 1;
  const perTicket = show.paid != null && count > 0 ? show.paid / count : null;
  const paidDisplay = perTicket != null ? `$${Math.round(perTicket)}${count > 1 ? "/ea" : ""}` : "—";
  const paidClass =
    show.paid != null
      ? "show-row__paid"
      : "show-row__paid show-row__paid--empty";

  /* ── row class ── */
  const rowClass = selected
    ? "show-row show-row--selected"
    : "show-row";

  function handleRowActivate() {
    if (show.showId) {
      router.push(`/shows/${show.showId}`);
    } else if (onClick) {
      onClick();
    }
  }

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleRowActivate();
    }
  }

  return (
    <div
      className={rowClass}
      onClick={handleRowActivate}
      onKeyDown={handleRowKeyDown}
      role={show.showId ? "link" : "button"}
      tabIndex={0}
    >
      {/* 1. Left bar */}
      <div className="show-row__bar-cell">
        <div className={barClass} style={barStyle} />
      </div>

      {/* 2. Date */}
      <div className="show-row__date">
        <div className="show-row__date-top">
          {show.date.month} {show.date.day}
        </div>
        <div className="show-row__date-bottom">
          {show.date.year} &middot; {show.date.dow}
        </div>
      </div>

      {/* 3. Kind icon + label */}
      <div className="show-row__kind">
        <KindIcon size={14} className={`show-row__kind-icon show-row__kind-icon--${show.kind}`} />
        <span className={`show-row__kind-label show-row__kind-label--${show.kind}`}>
          {KIND_LABELS[show.kind]}
        </span>
      </div>

      {/* 4. Headliner + support */}
      <div className="show-row__headliner-cell">
        {show.headlinerId ? (
          <Link
            href={`/artists/${show.headlinerId}`}
            className="show-row__headliner show-row__headliner--link"
            onClick={(e) => e.stopPropagation()}
          >
            {show.headliner}
          </Link>
        ) : (
          <div className="show-row__headliner">{show.headliner}</div>
        )}
        {show.support && show.support.length > 0 && (
          <div className="show-row__support">
            +{" "}
            {show.support.map((name, i) => {
              const id = show.supportPerformers?.find((p) => p.name === name)?.id;
              return (
                <span key={`${name}-${i}`}>
                  {id ? (
                    <Link
                      href={`/artists/${id}`}
                      className="show-row__support-link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {name}
                    </Link>
                  ) : (
                    name
                  )}
                  {i < (show.support?.length ?? 0) - 1 ? ", " : ""}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. Venue + neighborhood */}
      <div className="show-row__venue-cell">
        <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
          {show.venueId ? (
            <Link
              href={`/venues/${show.venueId}`}
              className="show-row__venue show-row__venue--link"
              onClick={(e) => e.stopPropagation()}
            >
              {show.venue}
            </Link>
          ) : (
            <div className="show-row__venue">{show.venue}</div>
          )}
          {missingCoords && (
            <span
              title="No coordinates — won't appear on map"
              style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--kind-theatre)", flexShrink: 0, opacity: 0.7 }}
            />
          )}
        </div>
        {show.neighborhood && (
          <div className="show-row__neighborhood">{show.neighborhood}</div>
        )}
      </div>

      {/* 6. Seat */}
      <div className="show-row__seat">
        {show.seat ?? "—"}
      </div>

      {/* 7. Paid */}
      <div className={paidClass}>
        {paidDisplay}
      </div>

      {/* 8. State + chevron */}
      <div className="show-row__state">
        {show.state === "ticketed" && <StateChip state="ticketed" />}
        {show.state === "watching" && <StateChip state="watching" />}
        {!hideChevron && (
          onExpandToggle ? (
            <button
              type="button"
              className="show-row__expand"
              aria-label={selected ? "Collapse details" : "Expand details"}
              aria-expanded={selected ? true : false}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onExpandToggle();
              }}
            >
              {selected ? (
                <ChevronDown size={14} className="show-row__chevron" />
              ) : (
                <ChevronRight size={14} className="show-row__chevron" />
              )}
            </button>
          ) : (
            show.state === "past" && (
              <ChevronRight size={14} className="show-row__chevron" />
            )
          )
        )}
      </div>
    </div>
  );
}
