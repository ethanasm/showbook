"use client";

import type { ShowTabBadges, ShowTabKey } from "./types";

interface ShowTabBarProps {
  active: ShowTabKey;
  badges: ShowTabBadges;
  onSelect: (next: ShowTabKey) => void;
}

const TABS: { key: ShowTabKey; label: string }[] = [
  { key: "overview", label: "overview" },
  { key: "setlist", label: "setlist" },
  { key: "media", label: "media" },
  { key: "notes", label: "notes" },
];

/**
 * Sticky tab bar — labels never change across pre/post show, only the
 * badge content does. Active tab gets a 2px accent-gold underline plus
 * accent-colored badge ring. Hover and focus light up muted-foreground
 * for non-active tabs.
 */
export function ShowTabBar({ active, badges, onSelect }: ShowTabBarProps) {
  return (
    <nav
      role="tablist"
      aria-label="Show sections"
      data-testid="show-tab-bar"
      style={{
        display: "flex",
        gap: 0,
        padding: "0 var(--page-pad-x)",
        borderBottom: "1px solid var(--rule)",
        background: "var(--bg)",
        position: "sticky",
        top: 0,
        zIndex: 2,
      }}
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        const badge = badges[tab.key];
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`show-tab-panel-${tab.key}`}
            id={`show-tab-${tab.key}`}
            data-testid={`show-tab-${tab.key}`}
            onClick={() => onSelect(tab.key)}
            style={{
              padding: "14px 0",
              marginRight: 26,
              background: "transparent",
              border: "none",
              borderBottom: isActive
                ? "2px solid var(--accent)"
                : "2px solid transparent",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 12,
              letterSpacing: ".04em",
              color: isActive ? "var(--ink)" : "var(--muted)",
              fontWeight: isActive ? 500 : 400,
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              cursor: "pointer",
              textTransform: "lowercase",
            }}
          >
            <span>{tab.label}</span>
            {badge != null && (
              <span
                data-testid={`show-tab-${tab.key}-badge`}
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 9.5,
                  color: isActive ? "var(--accent)" : "var(--faint)",
                  padding: "1px 6px",
                  border: `1px solid ${isActive ? "var(--accent)" : "var(--rule-strong)"}`,
                  letterSpacing: ".04em",
                }}
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
