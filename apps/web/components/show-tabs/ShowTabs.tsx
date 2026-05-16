"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ShowTabBar } from "./ShowTabBar";
import { ShowTabPanel } from "./ShowTabPanel";
import { ShowDetailRightRail } from "./ShowDetailRightRail";
import { parseShowTab, type ShowTabBadges, type ShowTabKey } from "./types";

interface ShowTabsProps {
  showId: string;
  isPast: boolean;
  badges: ShowTabBadges;
  /** One ReactNode per tab key — caller mounts the tab content. */
  panels: Record<ShowTabKey, ReactNode>;
  /** Optional right-rail slot manifest; hidden when empty. */
  rightRail?: React.ComponentProps<typeof ShowDetailRightRail>["slots"];
  /**
   * Callback fired after a tab switch lands. The page-level
   * `useTrackTabView` hook subscribes here to emit the
   * `setlist_intel.show_tab.viewed` event.
   */
  onTabChange?: (tab: ShowTabKey) => void;
}

/**
 * Top-level shell — owns the URL `?tab=…` round-trip + crossfade,
 * delegates panel content to the caller. Default tab is `overview`.
 */
export function ShowTabs({
  showId,
  isPast,
  badges,
  panels,
  rightRail,
  onTabChange,
}: ShowTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const urlTab = parseShowTab(searchParams?.get("tab"));
  const [active, setActive] = useState<ShowTabKey>(urlTab);

  // Keep state in sync when the user navigates back/forward.
  useEffect(() => {
    setActive(urlTab);
  }, [urlTab]);

  const selectTab = useCallback(
    (next: ShowTabKey) => {
      if (next === active) return;
      setActive(next);
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (next === "overview") {
        params.delete("tab");
      } else {
        params.set("tab", next);
      }
      const query = params.toString();
      const href = query ? `${pathname}?${query}` : pathname ?? "/";
      router.replace(href, { scroll: false });
      onTabChange?.(next);
    },
    [active, onTabChange, pathname, router, searchParams],
  );

  // Emit a view event for the initial tab too — Axiom can roll the
  // initial paint into the same query as click-driven switches.
  useEffect(() => {
    onTabChange?.(active);
    // Only fire on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      data-testid={`show-tabs-${showId}`}
      style={{ display: "flex", minHeight: 0, gap: 0 }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <ShowTabBar active={active} badges={badges} onSelect={selectTab} />
        <ShowTabPanel tabKey="overview" active={active}>
          {panels.overview}
        </ShowTabPanel>
        <ShowTabPanel tabKey="setlist" active={active}>
          {panels.setlist}
        </ShowTabPanel>
        <ShowTabPanel tabKey="media" active={active}>
          {panels.media}
        </ShowTabPanel>
        <ShowTabPanel tabKey="notes" active={active}>
          {panels.notes}
        </ShowTabPanel>
      </div>
      {rightRail && (
        <ShowDetailRightRail isPast={isPast} slots={rightRail} />
      )}
    </div>
  );
}
