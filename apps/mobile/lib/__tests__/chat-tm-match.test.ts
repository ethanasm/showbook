/**
 * Unit tests for the mobile chat-add Ticketmaster helpers.
 *
 * `isUpcomingDateHint` / `tmDateWindow` are re-exported from
 * `@showbook/shared` (covered in depth there); these spot-check the
 * re-export wiring. `tmResultToFormParams` is the mobile-specific
 * mapping from a picked `enrichment.searchTM` result to the
 * `/add/form` query params — it mirrors the web Form-tab prefill.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isUpcomingDateHint,
  tmDateWindow,
  tmResultToFormParams,
  type TmChatMatch,
} from '../chat-tm-match';

const baseMatch = (overrides: Partial<TmChatMatch> = {}): TmChatMatch => ({
  tmEventId: 'tm-1',
  name: 'Radiohead',
  date: '2099-08-15',
  venueName: 'Madison Square Garden',
  venueCity: 'New York',
  kind: 'concert',
  performers: [],
  ...overrides,
});

describe('re-exported date gate', () => {
  it('isUpcomingDateHint rejects past + accepts future', () => {
    assert.equal(isUpcomingDateHint('2000-01-01'), false);
    assert.equal(isUpcomingDateHint('2099-12-31'), true);
    assert.equal(isUpcomingDateHint(null), false);
  });

  it('tmDateWindow brackets the date by 3 days', () => {
    assert.deepEqual(tmDateWindow('2099-06-15'), {
      startDate: '2099-06-12T00:00:00Z',
      endDate: '2099-06-18T23:59:59Z',
    });
  });
});

describe('tmResultToFormParams', () => {
  it('maps a concert: first attraction headlines, the rest support', () => {
    const params = tmResultToFormParams(
      baseMatch({
        performers: [
          { name: 'Radiohead', tmAttractionId: 'a1', imageUrl: 'r.jpg' },
          { name: 'Opener', tmAttractionId: 'a2', imageUrl: null },
        ],
      }),
    );
    assert.equal(params.kindHint, 'concert');
    assert.equal(params.headliner, 'Radiohead');
    assert.equal(params.venueHint, 'Madison Square Garden');
    assert.equal(params.venueCity, 'New York');
    assert.equal(params.dateHint, '2099-08-15');
    assert.deepEqual(JSON.parse(params.performersJson!), [
      { name: 'Opener', tier: 'support', tmAttractionId: 'a2' },
    ]);
  });

  it('falls back to the event name when a concert has no attractions', () => {
    const params = tmResultToFormParams(baseMatch({ performers: [] }));
    assert.equal(params.headliner, 'Radiohead');
    assert.equal(params.performersJson, undefined);
  });

  it('maps a festival: event name is the festival, every attraction is lineup', () => {
    const params = tmResultToFormParams(
      baseMatch({
        name: 'Outside Lands',
        kind: 'festival',
        performers: [
          { name: 'Act A', tmAttractionId: 'a1', imageUrl: 'a.jpg' },
          { name: 'Act B', tmAttractionId: 'a2', imageUrl: null },
        ],
      }),
    );
    assert.equal(params.kindHint, 'festival');
    assert.equal(params.headliner, 'Outside Lands');
    const lineup = JSON.parse(params.performersJson!);
    assert.equal(lineup.length, 2);
    assert.deepEqual(lineup[0], {
      name: 'Act A',
      tier: 'support',
      tmAttractionId: 'a1',
      imageUrl: 'a.jpg',
    });
  });

  it('maps theatre: production name only, no lineup', () => {
    const params = tmResultToFormParams(
      baseMatch({
        name: 'Hamilton',
        kind: 'theatre',
        performers: [{ name: 'Cast', tmAttractionId: 'a1', imageUrl: null }],
      }),
    );
    assert.equal(params.kindHint, 'theatre');
    assert.equal(params.headliner, 'Hamilton');
    assert.equal(params.performersJson, undefined);
  });

  it('normalizes an unknown / non-watchable kind to concert', () => {
    assert.equal(tmResultToFormParams(baseMatch({ kind: 'film' })).kindHint, 'concert');
    assert.equal(tmResultToFormParams(baseMatch({ kind: 'unknown' })).kindHint, 'concert');
    assert.equal(tmResultToFormParams(baseMatch({ kind: 'comedy' })).kindHint, 'comedy');
  });

  it('omits venue params when the event has no venue', () => {
    const params = tmResultToFormParams(
      baseMatch({ venueName: null, venueCity: null }),
    );
    assert.equal(params.venueHint, undefined);
    assert.equal(params.venueCity, undefined);
  });
});
