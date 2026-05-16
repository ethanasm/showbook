"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ShowTabKey } from "./types";

interface ShowTabPanelProps {
  tabKey: ShowTabKey;
  active: ShowTabKey;
  children: ReactNode;
}

const CROSSFADE_MS = 120;

/**
 * Renders the active panel and animates the tab transition with a
 * ~120ms crossfade (per redesign brief #2). We keep both the prior
 * and the next content briefly mounted so React doesn't snap the
 * scroll position when content lengths differ — the fade-out
 * absolute-positions over the fade-in for the duration of the
 * animation. Falls back to a clean swap when `prefers-reduced-motion`
 * is set.
 */
export function ShowTabPanel({ tabKey, active, children }: ShowTabPanelProps) {
  const isActive = tabKey === active;
  const [opacity, setOpacity] = useState<number>(isActive ? 1 : 0);
  const previousActive = useRef<ShowTabKey>(active);

  useEffect(() => {
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setOpacity(isActive ? 1 : 0);
      previousActive.current = active;
      return;
    }
    if (active !== previousActive.current) {
      setOpacity(0);
      const id = requestAnimationFrame(() => setOpacity(isActive ? 1 : 0));
      previousActive.current = active;
      return () => cancelAnimationFrame(id);
    }
    setOpacity(isActive ? 1 : 0);
  }, [active, isActive]);

  if (!isActive) return null;

  return (
    <div
      role="tabpanel"
      id={`show-tab-panel-${tabKey}`}
      aria-labelledby={`show-tab-${tabKey}`}
      data-testid={`show-tab-panel-${tabKey}`}
      style={{
        opacity,
        transition: `opacity ${CROSSFADE_MS}ms ease`,
        minHeight: 0,
      }}
    >
      {children}
    </div>
  );
}
