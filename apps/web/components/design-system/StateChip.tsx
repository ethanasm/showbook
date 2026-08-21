"use client";

import "./design-system.css";

export type ShowState = "ticketed" | "watching" | "past";

interface StateChipProps {
  state: "ticketed" | "watching";
}

/**
 * The state used to be a pill — `TIX` filled gold, `WATCHING` outlined in
 * ink — which put a chip on every row of every list. It is now the word
 * itself: `Ticketed` carries emphasis through weight and `--accent-strong`,
 * `Watching` sits in `--muted`. The component keeps its name and class hooks
 * so call sites and tests don't have to care.
 */
const LABELS: Record<"ticketed" | "watching", string> = {
  ticketed: "Ticketed",
  watching: "Watching",
};

export function StateChip({ state }: StateChipProps) {
  const className =
    state === "ticketed"
      ? "state-chip state-chip--ticketed"
      : "state-chip state-chip--watching";

  return <span className={className}>{LABELS[state]}</span>;
}
