"use client";

import "./design-system.css";
import { StateChip, type ShowState } from "./StateChip";
import type { ShowKind } from "./KindBadge";
import {
  Music,
  Clapperboard,
  Laugh,
  Tent,
  ChevronRight,
} from "lucide-react";

export interface Show {
  kind: ShowKind;
  state: ShowState;
  headliner: string;
  support?: string[];
  venue: string;
  neighborhood?: string;
  date: { month: string; day: string; year: string; dow: string };
  seat?: string;
  paid?: number;
}

interface ShowRowProps {
  show: Show;
  selected?: boolean;
  onClick?: () => void;
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

export function ShowRow({ show, selected, onClick }: ShowRowProps) {
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
  const paidDisplay = show.paid != null ? `$${show.paid}` : "—";
  const paidClass =
    show.paid != null
      ? "show-row__paid"
      : "show-row__paid show-row__paid--empty";

  /* ── row class ── */
  const rowClass = selected
    ? "show-row show-row--selected"
    : "show-row";

  return (
    <div className={rowClass} onClick={onClick} role="button" tabIndex={0}>
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
        <div className="show-row__headliner">{show.headliner}</div>
        {show.support && show.support.length > 0 && (
          <div className="show-row__support">
            + {show.support.join(", ")}
          </div>
        )}
      </div>

      {/* 5. Venue + neighborhood */}
      <div className="show-row__venue-cell">
        <div className="show-row__venue">{show.venue}</div>
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
        {show.state === "past" && (
          <ChevronRight size={14} className="show-row__chevron" />
        )}
      </div>
    </div>
  );
}
