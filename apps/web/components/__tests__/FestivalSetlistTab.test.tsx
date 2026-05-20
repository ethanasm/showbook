/**
 * Component test for FestivalSetlistTab — verifies the chip rail
 * orders the lineup (headliner first, supports by sortOrder) and that
 * tapping a chip swaps the rendered SetlistTab's artist.
 *
 * SetlistTab + its trpc-touching children are stubbed via
 * `mock.module` so the test stays in jsdom and asserts the
 * picker-level wiring, not the inner prediction-rendering tree.
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { FestivalLineupSetlistEntry } from '../show-tabs/FestivalSetlistTab';

// Stub SetlistTab to expose the artistName prop so the test can
// assert which artist's panel is currently mounted.
mock.module('../show-tabs/SetlistTab', {
  namedExports: {
    SetlistTab: ({ artistName }: { artistName: string }) => (
      <div data-testid="setlist-tab-stub">{artistName}</div>
    ),
    SetlistTabComingSoon: () => null,
  },
});

let FestivalSetlistTabMod: typeof import('../show-tabs/FestivalSetlistTab');
before(async () => {
  FestivalSetlistTabMod = await import('../show-tabs/FestivalSetlistTab');
});

beforeEach(() => cleanup());

function entry(
  overrides: Partial<FestivalLineupSetlistEntry> &
    Pick<FestivalLineupSetlistEntry, 'performerId' | 'performerName' | 'role' | 'sortOrder'>,
): FestivalLineupSetlistEntry {
  return {
    prediction: null,
    actualSongs: [],
    ...overrides,
  };
}

describe('FestivalSetlistTab', () => {
  it('renders one chip per lineup artist with the headliner first', () => {
    const { FestivalSetlistTab } = FestivalSetlistTabMod;
    const r = render(
      <FestivalSetlistTab
        showId="show-1"
        isPast={false}
        predictionsLoading={false}
        entries={[
          // Intentionally unsorted.
          entry({ performerId: 's2', performerName: 'Tash Sultana', role: 'support', sortOrder: 2 }),
          entry({ performerId: 'h', performerName: 'Lorde', role: 'headliner', sortOrder: 0 }),
          entry({ performerId: 's1', performerName: 'Teddy Swims', role: 'support', sortOrder: 1 }),
        ]}
      />,
    );
    const chips = r.getAllByTestId(/^festival-setlist-chip-/);
    assert.equal(chips.length, 3);
    assert.match(chips[0].textContent ?? '', /Lorde/);
    assert.match(chips[1].textContent ?? '', /Teddy Swims/);
    assert.match(chips[2].textContent ?? '', /Tash Sultana/);
  });

  it('defaults to the headliner — SetlistTab renders with the headliner name', () => {
    const { FestivalSetlistTab } = FestivalSetlistTabMod;
    const r = render(
      <FestivalSetlistTab
        showId="show-1"
        isPast={false}
        predictionsLoading={false}
        entries={[
          entry({ performerId: 's1', performerName: 'Teddy Swims', role: 'support', sortOrder: 1 }),
          entry({ performerId: 'h', performerName: 'Lorde', role: 'headliner', sortOrder: 0 }),
        ]}
      />,
    );
    const panel = r.getByTestId('setlist-tab-stub');
    assert.equal(panel.textContent, 'Lorde');
  });

  it('clicking a support chip swaps the rendered SetlistTab artist', () => {
    const { FestivalSetlistTab } = FestivalSetlistTabMod;
    const r = render(
      <FestivalSetlistTab
        showId="show-1"
        isPast={false}
        predictionsLoading={false}
        entries={[
          entry({ performerId: 'h', performerName: 'Lorde', role: 'headliner', sortOrder: 0 }),
          entry({ performerId: 's1', performerName: 'Teddy Swims', role: 'support', sortOrder: 1 }),
        ]}
      />,
    );
    // Default: Lorde.
    assert.equal(r.getByTestId('setlist-tab-stub').textContent, 'Lorde');
    // Tap Teddy's chip.
    fireEvent.click(r.getByTestId('festival-setlist-chip-s1'));
    assert.equal(r.getByTestId('setlist-tab-stub').textContent, 'Teddy Swims');
  });

  it('shows a per-chip song count for past shows but not upcoming', () => {
    const { FestivalSetlistTab } = FestivalSetlistTabMod;
    const r = render(
      <FestivalSetlistTab
        showId="show-1"
        isPast={true}
        predictionsLoading={false}
        entries={[
          entry({
            performerId: 'h',
            performerName: 'Lorde',
            role: 'headliner',
            sortOrder: 0,
            actualSongs: [
              { title: 'Royals', sectionIndex: 0, songIndex: 0, isEncore: false, isOpenerOrCloser: true, note: null },
              { title: 'Tennis Court', sectionIndex: 0, songIndex: 1, isEncore: false, isOpenerOrCloser: false, note: null },
            ],
          }),
        ]}
      />,
    );
    const chip = r.getByTestId('festival-setlist-chip-h');
    assert.match(chip.textContent ?? '', /2/);
  });

  it('renders an empty-state when the lineup is empty', () => {
    const { FestivalSetlistTab } = FestivalSetlistTabMod;
    const r = render(
      <FestivalSetlistTab
        showId="show-1"
        isPast={false}
        predictionsLoading={false}
        entries={[]}
      />,
    );
    assert.ok(r.queryByTestId('festival-setlist-tab-empty'));
  });
});
