import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, render } from '@testing-library/react';
import { OverviewTab } from '../show-tabs/OverviewTab';

function renderTab(kind?:
  | 'concert'
  | 'theatre'
  | 'comedy'
  | 'festival'
  | 'sports'
  | 'film'
  | 'unknown') {
  return render(
    <OverviewTab
      showId="show-1"
      isPast={false}
      state="ticketed"
      kind={kind}
      cells={[]}
      lineup={[]}
      onEdit={() => undefined}
      onAddToCalendarHref="/cal"
      onDelete={() => undefined}
    />,
  );
}

describe('OverviewTab "Your history" defaults', () => {
  it('uses concert wording for concerts', () => {
    const { getByText } = renderTab('concert');
    assert.ok(getByText('First show with this lineup'));
    cleanup();
  });

  it('uses comedy-specific wording for comedy shows', () => {
    const { getByText, queryByText } = renderTab('comedy');
    assert.ok(getByText('First time seeing this comedian'));
    assert.equal(queryByText('First show with this lineup'), null);
    cleanup();
  });

  it('uses theatre-specific wording for theatre shows', () => {
    const { getByText, queryByText } = renderTab('theatre');
    assert.ok(getByText('First time seeing this production'));
    assert.equal(queryByText('First show with this lineup'), null);
    cleanup();
  });

  it('falls back to the concert wording when kind is missing', () => {
    const { getByText } = renderTab(undefined);
    assert.ok(getByText('First show with this lineup'));
    cleanup();
  });
});
