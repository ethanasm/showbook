import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import {
  GetStartedHub,
  useGetStartedDismissed,
  type GetStartedStep,
} from '../home/GetStartedHub';

const STORAGE_KEY = 'showbook:get-started-dismissed';

const STEPS: GetStartedStep[] = [
  { id: 'add', label: 'Add your first show', done: true, href: '/add' },
  { id: 'follow', label: 'Follow an artist or venue', done: false, href: '/discover' },
  { id: 'region', label: 'Set a home region', done: false, href: '/discover?tab=regions' },
];

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

  it('expanded variant labels Spotify door so users know it powers Discover, not shows', () => {
    const { getByText } = render(<GetStartedHub variant="expanded" />);
    assert.ok(
      getByText(/Follow your Spotify artists/i),
      'Spotify door title must lead with following artists',
    );
    assert.ok(
      getByText(/won't add shows/i),
      'Spotify subtitle must say it does not add shows so users are not surprised by an empty list',
    );
  });

  it('card variant fires onDismiss when X is clicked', () => {
    let dismissCount = 0;
    const { getByLabelText } = render(
      <GetStartedHub variant="card" steps={STEPS} onDismiss={() => dismissCount++} />,
    );
    fireEvent.click(getByLabelText('Dismiss get started'));
    assert.equal(dismissCount, 1);
  });

  it('card variant renders the checklist with progress', () => {
    const { getByTestId } = render(<GetStartedHub variant="card" steps={STEPS} />);
    assert.equal(getByTestId('get-started-progress').textContent, '1 of 3');
    assert.ok(getByTestId('get-started-step-add'));
    assert.ok(getByTestId('get-started-step-follow'));
    assert.ok(getByTestId('get-started-step-region'));
  });

  it('pending steps link to their surface; done steps do not', () => {
    const { getByTestId } = render(<GetStartedHub variant="card" steps={STEPS} />);
    const followStep = getByTestId('get-started-step-follow');
    assert.equal(followStep.tagName, 'A');
    assert.equal(followStep.getAttribute('href'), '/discover');
    const doneStep = getByTestId('get-started-step-add');
    assert.notEqual(doneStep.tagName, 'A');
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
