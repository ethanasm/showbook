import { useEffect, useState } from "react";

/**
 * Returns `true` when the viewport is at or below the mobile breakpoint
 * used elsewhere in the design system (`@media (max-width: 899px)`).
 *
 * The 899px threshold covers every phone in any orientation —
 * including iPhone Pro Max landscape (932 is just outside, but Pro
 * Max portrait at 430 is well inside) — plus half-page browser
 * windows on a 14-inch laptop. Anything above is treated as desktop.
 *
 * Starts as `true` so the first server-rendered paint matches the
 * mobile layout. On a desktop viewport the effect flips it to false
 * on mount; on a mobile viewport the value stays true and matches
 * the CSS @media query, so SSR HTML is layout-correct on first paint.
 */
export function useIsMobile(maxWidth: number = 899): boolean {
  // Default `true` so the SSR-rendered HTML matches the mobile layout
  // for phone-sized viewports on first paint. The post-mount effect
  // resyncs from `matchMedia`, so desktop viewports flip to false on
  // hydration (a no-op visually because CSS @media already handles
  // the desktop case for the components that use this hook).
  const [isMobile, setIsMobile] = useState(true);
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
