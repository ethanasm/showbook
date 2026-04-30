"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationFooterProps {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  /** Used for the "X–Y of N <itemLabel>" string. Pluralized as-is. */
  itemLabel: string;
  onPageChange: (next: number) => void;
}

export function PaginationFooter({
  currentPage,
  totalPages,
  pageSize,
  totalItems,
  itemLabel,
  onPageChange,
}: PaginationFooterProps) {
  const atStart = currentPage === 0;
  const atEnd = currentPage >= totalPages - 1;
  const start = currentPage * pageSize + 1;
  const end = Math.min((currentPage + 1) * pageSize, totalItems);

  return (
    <div
      data-testid="pagination-footer"
      style={{
        // Pinned to the bottom of the viewport (= bottom of the nearest
        // flex-column scroll container). `margin-top: auto` keeps the footer
        // at the bottom even when the row list is short; `position: sticky`
        // keeps it visible once the list is long enough to scroll.
        position: "sticky",
        bottom: 0,
        zIndex: 5,
        margin: "auto 36px 0",
        background: "var(--surface)",
        borderTop: "1px solid var(--rule)",
        padding: "12px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <button
        onClick={() => onPageChange(Math.max(0, currentPage - 1))}
        disabled={atStart}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          border: "1px solid var(--rule-strong)",
          background: "transparent",
          color: atStart ? "var(--faint)" : "var(--ink)",
          padding: "5px 11px",
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 11,
          cursor: atStart ? "not-allowed" : "pointer",
          opacity: atStart ? 0.4 : 1,
        }}
        data-testid="pagination-prev"
      >
        <ChevronLeft size={12} /> Prev
      </button>
      <span
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 10.5,
          color: "var(--faint)",
          letterSpacing: ".06em",
        }}
      >
        {totalItems === 0
          ? `0 ${itemLabel}`
          : `${start}–${end} of ${totalItems}`}
      </span>
      <button
        onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))}
        disabled={atEnd}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          border: "1px solid var(--rule-strong)",
          background: "transparent",
          color: atEnd ? "var(--faint)" : "var(--ink)",
          padding: "5px 11px",
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 11,
          cursor: atEnd ? "not-allowed" : "pointer",
          opacity: atEnd ? 0.4 : 1,
        }}
        data-testid="pagination-next"
      >
        Next <ChevronRight size={12} />
      </button>
    </div>
  );
}
