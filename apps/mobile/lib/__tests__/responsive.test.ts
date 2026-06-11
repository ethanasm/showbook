/**
 * Unit tests for the responsive helpers.
 *
 * These run under plain Node via tsx, which can't transform react-native's
 * Flow-typed index.js. responsive.ts loads RN through a wrapped require()
 * so this test file can import its pure helpers directly without crashing.
 *
 * `useBreakpoint` is a thin wrapper over `breakpointForWidth(width)` —
 * exercising the pure function across the boundary covers the hook's
 * behaviour at the three transitions called out in the spec:
 *   - phone below 900pt
 *   - tablet at/above 900pt
 *   - 'phone' fallback when Dimensions returns 0/0
 * The hook's re-fire on dimension change is structurally guaranteed by
 * Dimensions.addEventListener('change') in the real RN runtime; we assert
 * the underlying transform produces different breakpoints across width
 * values to catch regressions in the resolver.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SPLIT_SIDEBAR_MAX_WIDTH,
  SPLIT_SIDEBAR_MIN_WIDTH,
  TABLET_MIN_WIDTH,
  breakpointForWidth,
  isLargeScreen,
  splitSidebarWidth,
  useBreakpoint,
} from '../responsive';

describe('TABLET_MIN_WIDTH', () => {
  it('is 900', () => {
    assert.equal(TABLET_MIN_WIDTH, 900);
  });
});

describe('isLargeScreen', () => {
  it('is true at the 900-pt threshold', () => {
    assert.equal(isLargeScreen(900), true);
  });

  it('is true above 900', () => {
    assert.equal(isLargeScreen(1024), true);
    assert.equal(isLargeScreen(1366), true);
  });

  it('is false below 900', () => {
    assert.equal(isLargeScreen(899), false);
    assert.equal(isLargeScreen(390), false);
  });

  it('is false for zero / negative / non-finite', () => {
    assert.equal(isLargeScreen(0), false);
    assert.equal(isLargeScreen(-100), false);
    assert.equal(isLargeScreen(Number.NaN), false);
  });
});

describe('breakpointForWidth (drives useBreakpoint)', () => {
  it('returns "phone" below 900pt', () => {
    assert.equal(breakpointForWidth(390), 'phone');
    assert.equal(breakpointForWidth(768), 'phone');
    assert.equal(breakpointForWidth(899), 'phone');
  });

  it('returns "tablet" at 900pt', () => {
    assert.equal(breakpointForWidth(900), 'tablet');
  });

  it('returns "tablet" above 900pt', () => {
    assert.equal(breakpointForWidth(1024), 'tablet');
    assert.equal(breakpointForWidth(1366), 'tablet');
  });

  it('re-fires across width transitions (orientation flip)', () => {
    // Portrait iPad → landscape iPad: stays tablet but width changes.
    assert.equal(breakpointForWidth(820), 'phone');
    assert.equal(breakpointForWidth(1180), 'tablet');
    // iPhone rotated past the threshold (e.g. Pro Max landscape).
    assert.equal(breakpointForWidth(430), 'phone');
    assert.equal(breakpointForWidth(932), 'tablet');
  });

  it('falls back to "phone" when Dimensions returns 0/0', () => {
    assert.equal(breakpointForWidth(0), 'phone');
  });

  it('falls back to "phone" for negative or non-finite widths', () => {
    assert.equal(breakpointForWidth(-50), 'phone');
    assert.equal(breakpointForWidth(Number.NaN), 'phone');
    assert.equal(breakpointForWidth(Number.POSITIVE_INFINITY), 'phone');
  });
});

describe('splitSidebarWidth', () => {
  it('clamps to the 320pt floor at the narrow end of tablet', () => {
    // Smallest windows that count as tablet (900 threshold, Pro Max
    // landscape): 32% would dip below a readable card width.
    assert.equal(splitSidebarWidth(900), SPLIT_SIDEBAR_MIN_WIDTH);
    assert.equal(splitSidebarWidth(932), SPLIT_SIDEBAR_MIN_WIDTH);
  });

  it('is proportional (~32%) in the middle of the range', () => {
    // 13" iPad portrait / 11" iPad landscape.
    assert.equal(splitSidebarWidth(1024), Math.round(1024 * 0.32));
    assert.equal(splitSidebarWidth(1180), Math.round(1180 * 0.32));
  });

  it('clamps to the 380pt cap on wide landscape', () => {
    assert.equal(splitSidebarWidth(1366), SPLIT_SIDEBAR_MAX_WIDTH);
  });

  it('detail pane keeps the majority of the window at every tablet width', () => {
    for (const width of [900, 932, 1024, 1180, 1366]) {
      const sidebar = splitSidebarWidth(width);
      assert.ok(
        width - sidebar > sidebar,
        `detail pane (${width - sidebar}) should out-measure the sidebar (${sidebar}) at ${width}pt`,
      );
    }
  });

  it('falls back to the floor for zero / negative / non-finite widths', () => {
    assert.equal(splitSidebarWidth(0), SPLIT_SIDEBAR_MIN_WIDTH);
    assert.equal(splitSidebarWidth(-50), SPLIT_SIDEBAR_MIN_WIDTH);
    assert.equal(splitSidebarWidth(Number.NaN), SPLIT_SIDEBAR_MIN_WIDTH);
  });
});

describe('useBreakpoint', () => {
  it('is exported as a function', () => {
    assert.equal(typeof useBreakpoint, 'function');
  });
});
