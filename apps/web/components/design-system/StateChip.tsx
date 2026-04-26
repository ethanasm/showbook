"use client";

import "./design-system.css";

export type ShowState = "ticketed" | "watching" | "past";

interface StateChipProps {
  state: "ticketed" | "watching";
}

const LABELS: Record<"ticketed" | "watching", string> = {
  ticketed: "TIX",
  watching: "WATCHING",
};

export function StateChip({ state }: StateChipProps) {
  const className =
    state === "ticketed"
      ? "state-chip state-chip--ticketed"
      : "state-chip state-chip--watching";

  return <span className={className}>{LABELS[state]}</span>;
}
