import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useDebouncedValue } from '../useDebouncedValue';

describe('useDebouncedValue', () => {
  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('hello'));
    assert.equal(result.current, 'hello');
    cleanup();
  });

  it('updates after the delay elapses', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { result, rerender } = renderHook(
        ({ value }: { value: string }) => useDebouncedValue(value, 200),
        { initialProps: { value: 'a' } },
      );
      assert.equal(result.current, 'a');
      rerender({ value: 'b' });
      assert.equal(result.current, 'a');
      act(() => {
        mock.timers.tick(199);
      });
      assert.equal(result.current, 'a');
      act(() => {
        mock.timers.tick(2);
      });
      assert.equal(result.current, 'b');
    } finally {
      mock.timers.reset();
      cleanup();
    }
  });

  it('cancels pending update when value changes again', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { result, rerender } = renderHook(
        ({ value }: { value: number }) => useDebouncedValue(value, 100),
        { initialProps: { value: 1 } },
      );
      rerender({ value: 2 });
      act(() => {
        mock.timers.tick(50);
      });
      rerender({ value: 3 });
      act(() => {
        mock.timers.tick(99);
      });
      assert.equal(result.current, 1);
      act(() => {
        mock.timers.tick(2);
      });
      assert.equal(result.current, 3);
    } finally {
      mock.timers.reset();
      cleanup();
    }
  });

  it('respects custom delay', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { result, rerender } = renderHook(
        ({ value }: { value: string }) => useDebouncedValue(value, 1000),
        { initialProps: { value: 'x' } },
      );
      rerender({ value: 'y' });
      act(() => {
        mock.timers.tick(500);
      });
      assert.equal(result.current, 'x');
      act(() => {
        mock.timers.tick(600);
      });
      assert.equal(result.current, 'y');
    } finally {
      mock.timers.reset();
      cleanup();
    }
  });
});
