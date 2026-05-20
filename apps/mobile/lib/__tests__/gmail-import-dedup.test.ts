/**
 * Unit tests for the dedup helper. Mirrors the web app's `isDuplicate`
 * check in `apps/web/components/shows-list/ShowsListView.tsx`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isDuplicateTicket, type DedupShow } from '../gmail-import/dedup';

const ANCHOR_DATE = '2026-06-12';

function show(date: string | null, headliner: string): DedupShow {
  return {
    date,
    showPerformers: [
      { role: 'headliner', performer: { name: headliner } },
    ],
  };
}

describe('isDuplicateTicket', () => {
  it('detects an exact headliner + date match', () => {
    const existing = [show(ANCHOR_DATE, 'Phoebe Bridgers')];
    const result = isDuplicateTicket(
      { headliner: 'Phoebe Bridgers', date: ANCHOR_DATE },
      existing,
    );
    assert.equal(result, true);
  });

  it('matches case-insensitively on headliner', () => {
    const existing = [show(ANCHOR_DATE, 'phoebe bridgers')];
    const result = isDuplicateTicket(
      { headliner: 'PHOEBE BRIDGERS', date: ANCHOR_DATE },
      existing,
    );
    assert.equal(result, true);
  });

  it('does not match when only the headliner matches', () => {
    const existing = [show('2026-08-01', 'Phoebe Bridgers')];
    const result = isDuplicateTicket(
      { headliner: 'Phoebe Bridgers', date: ANCHOR_DATE },
      existing,
    );
    assert.equal(result, false);
  });

  it('does not match when only the date matches', () => {
    const existing = [show(ANCHOR_DATE, 'Some Other Band')];
    const result = isDuplicateTicket(
      { headliner: 'Phoebe Bridgers', date: ANCHOR_DATE },
      existing,
    );
    assert.equal(result, false);
  });

  it('never treats a null-date ticket as a duplicate', () => {
    const existing = [show(null, 'Phoebe Bridgers')];
    const result = isDuplicateTicket(
      { headliner: 'Phoebe Bridgers', date: null },
      existing,
    );
    assert.equal(result, false);
  });

  it('ignores support performers — only headliner row counts', () => {
    const existing: DedupShow[] = [
      {
        date: ANCHOR_DATE,
        showPerformers: [
          { role: 'headliner', performer: { name: 'Big Thief' } },
          { role: 'support', performer: { name: 'Phoebe Bridgers' } },
        ],
      },
    ];
    const result = isDuplicateTicket(
      { headliner: 'Phoebe Bridgers', date: ANCHOR_DATE },
      existing,
    );
    assert.equal(result, false);
  });

  it('returns false on an empty existing list', () => {
    assert.equal(
      isDuplicateTicket(
        { headliner: 'Phoebe Bridgers', date: ANCHOR_DATE },
        [],
      ),
      false,
    );
  });
});
