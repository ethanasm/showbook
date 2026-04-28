"use client";

import { ArrowUp, ArrowDown } from "lucide-react";

export interface SortConfig<T extends string> {
  field: T;
  dir: "asc" | "desc";
}

export function SortHeader<T extends string>({
  field,
  label,
  sort,
  onToggle,
  align,
}: {
  field: T;
  label: string;
  sort: SortConfig<T>;
  onToggle: (field: T) => void;
  align?: "right";
}) {
  const active = sort.field === field;
  const Arrow = sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onToggle(field)}
      data-testid={`sort-header-${field}`}
      data-sort-active={active ? sort.dir : undefined}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        width: "100%",
        fontFamily: "inherit",
        fontSize: "inherit",
        letterSpacing: "inherit",
        textTransform: "inherit",
        color: active ? "var(--ink)" : "var(--faint)",
        textAlign: align === "right" ? "right" : "left",
      }}
    >
      <span>{label}</span>
      {active ? (
        <Arrow size={10} />
      ) : (
        <span style={{ width: 10, height: 10, display: "inline-block" }} />
      )}
    </button>
  );
}
