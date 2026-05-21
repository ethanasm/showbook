/**
 * Hook-side smoke test for `useLiveCountdown`. Pure formatter
 * behaviour (cadence transitions across the doors anchor) lives in
 * `packages/shared/src/__tests__/useLiveCountdown.test.ts` — that's
 * the place to add branch coverage; this file just confirms the
 * hook produces a string and tears down its timeout on unmount.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { renderHook, cleanup } from '@testing-library/react';
import { useLiveCountdown } from '@showbook/shared/hooks';

describe('useLiveCountdown', () => {
  it('returns the fallback when dateYmd is null', () => {
    const { result } = renderHook(() =>
      useLiveCountdown(null, { fallback: 'soon' }),
    );
    assert.equal(result.current, 'soon');
    cleanup();
  });

  it('returns "date TBD" by default when dateYmd is null', () => {
    const { result } = renderHook(() => useLiveCountdown(null));
    assert.equal(result.current, 'date TBD');
    cleanup();
  });

  it('produces a string for a valid date and unmounts cleanly', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { result, unmount } = renderHook(() =>
        useLiveCountdown('2030-01-01', { doorsHour: 19 }),
      );
      assert.equal(typeof result.current, 'string');
      assert.ok(result.current.length > 0);
      // The hook installs a self-rescheduling setTimeout — unmount
      // should cancel it without throwing.
      assert.doesNotThrow(() => unmount());
    } finally {
      mock.timers.reset();
      cleanup();
    }
  });
});
