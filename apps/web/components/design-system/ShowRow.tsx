"use client";

import "./design-system.css";
import { StateChip, type ShowState } from "./StateChip";
import type { ShowKind } from "./KindBadge";

interface Show {
  kind: ShowKind;
  state: ShowState;
  headliner: string;
  venue: string;
  date: string;
  seat?: string;
}

interface ShowRowProps {
  show: Show;
  onClick?: () => void;
}

const KIND_COLORS: Record<string, { dark: string; light: string }> = {
  concert: { dark: "#3A86FF", light: "#2E6FD9" },
  theatre: { dark: "#E63946", light: "#D42F3A" },
  comedy: { dark: "#9D4EDD", light: "#8340C4" },
  festival: { dark: "#2A9D8F", light: "#238577" },
};

export function ShowRow({ show, onClick }: ShowRowProps) {
  const barClass =
    show.state === "past"
      ? "show-row__bar show-row__bar--past"
      : show.state === "ticketed"
        ? "show-row__bar show-row__bar--ticketed"
        : "show-row__bar show-row__bar--watching";

  // For past shows, use the kind color via CSS variable
  const barStyle: React.CSSProperties =
    show.state === "past"
      ? { background: `var(--kind-${show.kind})` }
      : {};

  return (
    <div className="show-row" onClick={onClick} role="button" tabIndex={0}>
      <div className={barClass} style={barStyle} />
      <div className="show-row__content">
        <div className="show-row__headliner">{show.headliner}</div>
        <div className="show-row__meta">
          {show.venue} · {show.date}
          {show.seat ? ` · ${show.seat}` : ""}
        </div>
      </div>
      <div className="show-row__right">
        {show.state !== "past" && <StateChip state={show.state} />}
      </div>
    </div>
  );
}
