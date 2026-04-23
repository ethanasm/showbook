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
  return <span className="state-chip">{LABELS[state]}</span>;
}
