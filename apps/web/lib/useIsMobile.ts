import { useEffect, useState } from "react";

/**
 * Returns `true` when the viewport is at or below the mobile breakpoint
 * used elsewhere in the design system (`@media (max-width: 767px)`).
 *
 * Starts as `false` so the first server-rendered paint matches desktop;
 * the effect resyncs on mount and on viewport changes.
 */
export function useIsMobile(maxWidth: number = 767): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [maxWidth]);
  return isMobile;
}
