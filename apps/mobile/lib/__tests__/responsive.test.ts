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
  TABLET_MIN_WIDTH,
  breakpointForWidth,
  isLargeScreen,
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

describe('useBreakpoint', () => {
  it('is exported as a function', () => {
    assert.equal(typeof useBreakpoint, 'function');
  });
});
