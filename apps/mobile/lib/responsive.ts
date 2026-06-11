/**
 * Responsive helpers — phone vs tablet breakpoint at 900pt window width.
 *
 * Single source of truth for the tablet split-view decision: the tab
 * shell renders on every breakpoint, but at "tablet" the Shows tab
 * composes a two-pane list / detail split (components/SplitViewLayout)
 * instead of pushing detail as a stack route. The threshold matches the
 * design source's iPad-portrait floor; iPhone Pro Max landscape (~932pt)
 * DOES count as "tablet" by this rule, which is the intended behaviour —
 * a sidebar + detail pair fits fine at that width.
 *
 * Why the require() dance for react-native: this module is imported by
 * the test runner (apps/mobile/lib/__tests__/responsive.test.ts) in plain
 * Node via tsx, where react-native cannot be transformed (Flow types in
 * its index.js trip esbuild). Wrapping the load lets pure exports
 * (`isLargeScreen`, `breakpointForWidth`) be tested directly while the
 * hook still subscribes to Dimensions in the real app runtime.
 */

import { useEffect, useState } from 'react';

export type Breakpoint = 'phone' | 'tablet';

export const TABLET_MIN_WIDTH = 900;

export function isLargeScreen(width: number): boolean {
  return Number.isFinite(width) && width >= TABLET_MIN_WIDTH;
}

export function breakpointForWidth(width: number): Breakpoint {
  if (!Number.isFinite(width) || width <= 0) return 'phone';
  return isLargeScreen(width) ? 'tablet' : 'phone';
}

export const SPLIT_SIDEBAR_MIN_WIDTH = 320;
export const SPLIT_SIDEBAR_MAX_WIDTH = 380;
const SPLIT_SIDEBAR_FRACTION = 0.32;

/**
 * Width of the Shows split-view list sidebar for a given window width:
 * ~32% of the window, clamped to 320–380pt — the iPad-sidebar register
 * (Apple's split-view sidebars sit around 320pt). The floor keeps
 * ShowCard headliners from truncating; the cap stops the sidebar from
 * stretching cards into a sparse, hard-to-scan strip on a 13" iPad in
 * landscape (1366pt → 380 + 986 split).
 */
export function splitSidebarWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return SPLIT_SIDEBAR_MIN_WIDTH;
  return Math.min(
    SPLIT_SIDEBAR_MAX_WIDTH,
    Math.max(SPLIT_SIDEBAR_MIN_WIDTH, Math.round(width * SPLIT_SIDEBAR_FRACTION)),
  );
}

interface DimensionsApi {
  Dimensions: {
    get: (target: 'window' | 'screen') => { width: number; height: number };
    addEventListener: (
      type: 'change',
      listener: (info: { window: { width: number; height: number } }) => void,
    ) => { remove: () => void };
  };
}

let _rn: DimensionsApi | null = null;
let _rnTried = false;
function loadRN(): DimensionsApi | null {
  if (_rnTried) return _rn;
  _rnTried = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _rn = require('react-native') as DimensionsApi;
  } catch {
    _rn = null;
  }
  return _rn;
}

export function useBreakpoint(): Breakpoint {
  const [width, setWidth] = useState<number>(() => {
    const rn = loadRN();
    return rn ? rn.Dimensions.get('window').width : 0;
  });
  useEffect(() => {
    const rn = loadRN();
    if (!rn) return;
    const sub = rn.Dimensions.addEventListener('change', ({ window }) => {
      setWidth(window.width);
    });
    return () => sub.remove();
  }, []);
  return breakpointForWidth(width);
}
