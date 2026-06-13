"use client";

import { Search, X } from "lucide-react";

/**
 * Pinned, controlled search input used at the top of the Shows and
 * Discover lists. Purely presentational — the owning page holds the
 * query state and applies `matchesSearchQuery` to its list. Filtering
 * is client-side and instant (no debounce needed for in-memory lists).
 *
 * Rendered inside each page's non-scrolling header band, and made
 * `position: sticky` so it stays put if the surrounding region scrolls
 * (notably the whole-page scroll on mobile web).
 */
export function ListSearchBar({
  value,
  onChange,
  placeholder,
  isMobile,
  testId,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  isMobile?: boolean;
  testId?: string;
}) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 6,
        padding: isMobile ? "10px 16px" : "10px var(--page-pad-x)",
        background: "var(--bg)",
        borderBottom: "1px solid var(--rule)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "var(--surface)",
          border: "1px solid var(--rule-strong)",
          borderRadius: 8,
        }}
      >
        <Search size={15} color="var(--muted)" aria-hidden />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          data-testid={testId}
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            color: "var(--ink)",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 14,
            letterSpacing: -0.1,
            minWidth: 0,
          }}
        />
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear search"
            data-testid={testId ? `${testId}-clear` : undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              background: "transparent",
              color: "var(--muted)",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <X size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
