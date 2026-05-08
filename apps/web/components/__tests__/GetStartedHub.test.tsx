import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { GetStartedHub, useGetStartedDismissed } from '../home/GetStartedHub';

const STORAGE_KEY = 'showbook:get-started-dismissed';

describe('GetStartedHub', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('expanded variant renders all four doors', () => {
    const { getByTestId } = render(<GetStartedHub variant="expanded" />);
    assert.ok(getByTestId('get-started-door-gmail'));
    assert.ok(getByTestId('get-started-door-discover'));
    assert.ok(getByTestId('get-started-door-spotify'));
    assert.ok(getByTestId('get-started-door-add'));
  });

  it('expanded variant labels Spotify door so users know it powers Discover', () => {
    const { getByText } = render(<GetStartedHub variant="expanded" />);
    assert.ok(
      getByText(/Powers your Discover feed/i),
      'Spotify subtitle must mention Discover so users are not surprised by an empty Artists list',
    );
  });

  it('card variant fires onDismiss when X is clicked', () => {
    let dismissCount = 0;
    const { getByLabelText } = render(
      <GetStartedHub variant="card" onDismiss={() => dismissCount++} />,
    );
    fireEvent.click(getByLabelText('Dismiss get started'));
    assert.equal(dismissCount, 1);
  });
});

describe('useGetStartedDismissed', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to not dismissed', () => {
    const { result } = renderHook(() => useGetStartedDismissed());
    assert.equal(result.current.dismissed, false);
  });

  it('reads dismissed flag from localStorage on mount', () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    const { result } = renderHook(() => useGetStartedDismissed());
    assert.equal(result.current.dismissed, true);
  });

  it('dismiss() persists and flips state', () => {
    const { result } = renderHook(() => useGetStartedDismissed());
    act(() => {
      result.current.dismiss();
    });
    assert.equal(result.current.dismissed, true);
    assert.equal(window.localStorage.getItem(STORAGE_KEY), '1');
  });
});
