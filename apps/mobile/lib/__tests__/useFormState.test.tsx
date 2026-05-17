/**
 * Unit tests for `useFormState`. The hook is pure React state + memoised
 * callbacks; `renderHook` from @testing-library/react under jsdom is
 * heavy for a one-off helper, so we exercise it through React's
 * server-side renderer plus an internal harness component instead. The
 * harness re-renders on every state change so the assertions can read
 * the latest values via a ref.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — bundled type stubs are not installed for react-test-renderer; tests stay JS-typed.
import TestRenderer from 'react-test-renderer';

import { useFormState } from '../useFormState';

interface Values {
  name: string;
  count: number;
  flag: boolean;
}

const INITIAL: Values = { name: 'a', count: 0, flag: false };

function Harness({
  onState,
}: {
  onState: (s: ReturnType<typeof useFormState<Values>>) => void;
}) {
  const state = useFormState<Values>(INITIAL);
  onState(state);
  return null;
}

function renderHarness() {
  let latest!: ReturnType<typeof useFormState<Values>>;
  const onState = (s: typeof latest) => {
    latest = s;
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(React.createElement(Harness, { onState }));
  });
  return { get: () => latest, act: TestRenderer.act, renderer };
}

describe('useFormState', () => {
  it('returns the initial values on first render', () => {
    const h = renderHarness();
    assert.deepEqual(h.get().values, INITIAL);
  });

  it('set() updates a single field without touching the others', () => {
    const h = renderHarness();
    h.act(() => {
      h.get().set('name', 'b');
    });
    assert.deepEqual(h.get().values, { name: 'b', count: 0, flag: false });
  });

  it('set() preserves type-safety with non-string fields', () => {
    const h = renderHarness();
    h.act(() => {
      h.get().set('count', 42);
      h.get().set('flag', true);
    });
    assert.equal(h.get().values.count, 42);
    assert.equal(h.get().values.flag, true);
  });

  it('patch() merges multiple fields at once', () => {
    const h = renderHarness();
    h.act(() => {
      h.get().patch({ name: 'c', count: 7 });
    });
    assert.deepEqual(h.get().values, { name: 'c', count: 7, flag: false });
  });

  it('reset() replaces the entire state', () => {
    const h = renderHarness();
    h.act(() => {
      h.get().set('name', 'd');
      h.get().reset({ name: 'fresh', count: 99, flag: true });
    });
    assert.deepEqual(h.get().values, { name: 'fresh', count: 99, flag: true });
  });

  it('set / patch / reset callbacks are stable across renders', () => {
    const h = renderHarness();
    const first = h.get();
    h.act(() => {
      h.get().set('name', 'e');
    });
    const second = h.get();
    assert.equal(first.set, second.set, 'set should be referentially stable');
    assert.equal(first.patch, second.patch, 'patch should be referentially stable');
    assert.equal(first.reset, second.reset, 'reset should be referentially stable');
  });
});
