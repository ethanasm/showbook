"use client";

import "./design-system.css";

export type ShowKind = "concert" | "theatre" | "comedy" | "festival";

interface KindBadgeProps {
  kind: ShowKind;
}

const LABELS: Record<ShowKind, string> = {
  concert: "Concert",
  theatre: "Theatre",
  comedy: "Comedy",
  festival: "Festival",
};

export function KindBadge({ kind }: KindBadgeProps) {
  return (
    <span className={`kind-badge kind-badge--${kind}`}>{LABELS[kind]}</span>
  );
}
