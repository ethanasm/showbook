"use client";

import type { ShowTabBadges, ShowTabKey } from "./types";

interface ShowTabBarProps {
  active: ShowTabKey;
  badges: ShowTabBadges;
  onSelect: (next: ShowTabKey) => void;
  /** Tabs to omit from the bar (e.g. `setlist` for theatre/comedy shows). */
  hiddenTabs?: readonly ShowTabKey[];
}

const TABS: { key: ShowTabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "setlist", label: "Setlist" },
  { key: "media", label: "Media" },
  { key: "notes", label: "Notes" },
];

/**
 * Sticky tab bar — labels never change across pre/post show, only the
 * badge content does. The active tab is marked by a 2px `--ink` underline
 * and a 600 label; the counts beside each label are plain numbers rather
 * than ringed badges. Hover and focus light up muted-foreground for
 * non-active tabs.
 */
export function ShowTabBar({ active, badges, onSelect, hiddenTabs }: ShowTabBarProps) {
  const hidden = new Set(hiddenTabs ?? []);
  const visibleTabs = TABS.filter((tab) => !hidden.has(tab.key));
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
      {visibleTabs.map((tab) => {
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
                ? "2px solid var(--ink)"
                : "2px solid transparent",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 13.5,
              color: isActive ? "var(--ink)" : "var(--muted)",
              fontWeight: isActive ? 600 : 400,
              letterSpacing: "-0.01em",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              cursor: "pointer",
            }}
          >
            <span>{tab.label}</span>
            {badge != null && (
              <span
                data-testid={`show-tab-${tab.key}-badge`}
                style={{
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: 12,
                  color: "var(--muted)",
                  fontWeight: 400,
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
