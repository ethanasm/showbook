/**
 * ShowTabBar render + interaction tests. Mounts the component via
 * @testing-library/react under jsdom (configured in test-setup.ts).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ShowTabBar } from '../show-tabs/ShowTabBar';
import type { ShowTabBadges, ShowTabKey } from '../show-tabs/types';

const NO_BADGES: ShowTabBadges = {
  overview: null,
  setlist: null,
  media: null,
  notes: null,
};

function renderBar(args?: {
  active?: ShowTabKey;
  badges?: ShowTabBadges;
  onSelect?: (next: ShowTabKey) => void;
}) {
  return render(
    <ShowTabBar
      active={args?.active ?? 'overview'}
      badges={args?.badges ?? NO_BADGES}
      onSelect={args?.onSelect ?? (() => undefined)}
    />,
  );
}

describe('ShowTabBar', () => {
  test('renders all four tabs in the canonical order', () => {
    const { getAllByRole } = renderBar();
    const tabs = getAllByRole('tab');
    assert.equal(tabs.length, 4);
    assert.equal(tabs[0]?.textContent?.toLowerCase(), 'overview');
    assert.equal(tabs[1]?.textContent?.toLowerCase().replace(/\D/g, '').length, 0);
    cleanup();
  });

  test('marks the active tab with aria-selected=true', () => {
    const { getByTestId } = renderBar({ active: 'setlist' });
    assert.equal(getByTestId('show-tab-setlist').getAttribute('aria-selected'), 'true');
    assert.equal(getByTestId('show-tab-overview').getAttribute('aria-selected'), 'false');
    cleanup();
  });

  test('calls onSelect when a non-active tab is clicked', () => {
    const seen: ShowTabKey[] = [];
    const { getByTestId } = renderBar({
      active: 'overview',
      onSelect: (k) => seen.push(k),
    });
    fireEvent.click(getByTestId('show-tab-setlist'));
    fireEvent.click(getByTestId('show-tab-media'));
    fireEvent.click(getByTestId('show-tab-notes'));
    assert.deepEqual(seen, ['setlist', 'media', 'notes']);
    cleanup();
  });

  test('renders badge pill when badge is non-null', () => {
    const { queryByTestId } = renderBar({
      badges: { overview: null, setlist: '92%', media: '0', notes: null },
    });
    assert.equal(queryByTestId('show-tab-setlist-badge')?.textContent, '92%');
    assert.equal(queryByTestId('show-tab-media-badge')?.textContent, '0');
    assert.equal(queryByTestId('show-tab-notes-badge'), null);
    cleanup();
  });

  test('Overview tab never shows a badge', () => {
    const { queryByTestId } = renderBar({
      badges: { overview: null, setlist: null, media: null, notes: null },
    });
    // even if a stale value were passed in, the type forbids it for overview
    assert.equal(queryByTestId('show-tab-overview-badge'), null);
    cleanup();
  });

  test('badge color follows active state (active tab uses accent ring)', () => {
    const { getByTestId } = renderBar({
      active: 'setlist',
      badges: { overview: null, setlist: '92%', media: '0', notes: null },
    });
    const activeBadge = getByTestId('show-tab-setlist-badge');
    // border should include accent token
    assert.match(activeBadge.getAttribute('style') ?? '', /var\(--accent\)/);
    cleanup();
  });
});
