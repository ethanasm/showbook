/**
 * Unit tests for the performer "upcoming shows" shaping helpers and the
 * on-sale-status functions that now live in ticketmaster.ts. All pure — no
 * network, no DB, no TICKETMASTER_API_KEY required.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeLiveAttractionEvents,
  shapeStoredUpcoming,
  dedupeUpcomingAgainstUserShows,
  type PerformerUpcomingRow,
  type StoredAnnouncementForShaping,
  type VenueForShaping,
} from '../performer-upcoming';
import {
  determineOnSaleStatus,
  parseOnSaleDate,
  type TMEvent,
} from '../ticketmaster';

const MUSIC_SEGMENT = 'KZFzniwnSyZfZ7v7nJ';
const TODAY = '2026-06-06';
const PERFORMER_ID = '11111111-1111-4111-8111-111111111111';
const TM_ATTRACTION_ID = 'K8vZ917abc';

function musicEvent(over: Partial<TMEvent> = {}): TMEvent {
  return {
    id: 'evt-1',
    name: 'Conan Gray',
    url: 'https://www.ticketmaster.com/conan-gray/event/evt-1',
    dates: { start: { localDate: '2026-08-01' } },
    classifications: [
      { primary: true, segment: { id: MUSIC_SEGMENT, name: 'Music' } },
    ],
    _embedded: {
      venues: [
        {
          id: 'tm-venue-1',
          name: 'Brooklyn Paramount',
          city: { name: 'Brooklyn' },
          state: { name: 'New York', stateCode: 'NY' },
        },
      ],
      attractions: [
        { id: TM_ATTRACTION_ID, name: 'Conan Gray' },
        { id: 'support-1', name: 'Opener Act' },
      ],
    },
    ...over,
  };
}

describe('normalizeLiveAttractionEvents', () => {
  it('shapes a concert, linking the headliner when this performer is top-billed', () => {
    const rows = normalizeLiveAttractionEvents([musicEvent()], {
      performerId: PERFORMER_ID,
      tmAttractionId: TM_ATTRACTION_ID,
      today: TODAY,
    });
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.id, 'tm-evt-1');
    assert.equal(row.ephemeral, true);
    assert.equal(row.kind, 'concert');
    assert.equal(row.headliner, 'Conan Gray');
    assert.equal(row.headlinerPerformerId, PERFORMER_ID);
    assert.deepEqual(row.support, ['Opener Act']);
    assert.equal(row.productionName, null);
    assert.equal(row.showDate, '2026-08-01');
    assert.equal(row.ticketUrl, 'https://www.ticketmaster.com/conan-gray/event/evt-1');
    assert.deepEqual(row.venue, {
      id: null,
      name: 'Brooklyn Paramount',
      city: 'Brooklyn',
      stateRegion: 'New York',
    });
  });

  it('leaves headlinerPerformerId null when this performer is only support', () => {
    const event = musicEvent({
      _embedded: {
        venues: [{ id: 'v', name: 'The Venue', city: { name: 'NYC' } }],
        attractions: [
          { id: 'other-headliner', name: 'Someone Else' },
          { id: TM_ATTRACTION_ID, name: 'Conan Gray' },
        ],
      },
    });
    const [row] = normalizeLiveAttractionEvents([event], {
      performerId: PERFORMER_ID,
      tmAttractionId: TM_ATTRACTION_ID,
      today: TODAY,
    });
    assert.equal(row!.headliner, 'Someone Else');
    assert.equal(row!.headlinerPerformerId, null);
    assert.deepEqual(row!.support, ['Conan Gray']);
  });

  it('treats festivals as production rows with every act listed as support', () => {
    const event = musicEvent({
      id: 'fest-1',
      name: 'Lollapalooza Music Festival 2026 - Friday',
      _embedded: {
        venues: [{ id: 'v', name: 'Grant Park', city: { name: 'Chicago' } }],
        attractions: [
          { id: 'a', name: 'Headliner A' },
          { id: 'b', name: 'Headliner B' },
        ],
      },
    });
    const [row] = normalizeLiveAttractionEvents([event], {
      performerId: PERFORMER_ID,
      tmAttractionId: TM_ATTRACTION_ID,
      today: TODAY,
    });
    assert.equal(row!.kind, 'festival');
    assert.equal(row!.headliner, 'Lollapalooza');
    assert.equal(row!.productionName, 'Lollapalooza');
    assert.equal(row!.headlinerPerformerId, null);
    assert.deepEqual(row!.support, ['Headliner A', 'Headliner B']);
  });

  it('drops events with no venue, past dates, unknown kind, and dupes', () => {
    const noVenue = musicEvent({ id: 'no-venue', _embedded: { attractions: [] } });
    const past = musicEvent({
      id: 'past',
      dates: { start: { localDate: '2020-01-01' } },
    });
    const unknown = musicEvent({ id: 'unknown', classifications: [] });
    const dupeA = musicEvent({ id: 'dupe', dates: { start: { localDate: '2026-07-01' } } });
    const dupeB = musicEvent({ id: 'dupe', dates: { start: { localDate: '2026-07-01' } } });

    const rows = normalizeLiveAttractionEvents(
      [noVenue, past, unknown, dupeA, dupeB],
      { performerId: PERFORMER_ID, tmAttractionId: TM_ATTRACTION_ID, today: TODAY },
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      ['tm-dupe'],
    );
  });

  it('sorts soonest-first and drops resale-only ticket URLs', () => {
    const later = musicEvent({
      id: 'later',
      url: 'https://www.ticketmaster.com/event/later', // resale-only bare URL
      dates: { start: { localDate: '2026-09-01' } },
    });
    const sooner = musicEvent({ id: 'sooner', dates: { start: { localDate: '2026-06-10' } } });
    const rows = normalizeLiveAttractionEvents([later, sooner], {
      performerId: PERFORMER_ID,
      tmAttractionId: TM_ATTRACTION_ID,
      today: TODAY,
    });
    assert.deepEqual(rows.map((r) => r.id), ['tm-sooner', 'tm-later']);
    assert.equal(rows[1]!.ticketUrl, null);
  });
});

describe('shapeStoredUpcoming', () => {
  it('maps a stored announcement + venue into the unified row shape', () => {
    const announcement: StoredAnnouncementForShaping = {
      id: 'a-1',
      kind: 'concert',
      headliner: 'Conan Gray',
      headlinerPerformerId: PERFORMER_ID,
      support: ['Opener'],
      productionName: null,
      showDate: '2026-08-01',
      onSaleStatus: 'on_sale',
      onSaleDate: new Date('2026-05-01T15:00:00Z'),
      ticketUrl: 'https://tm/x',
    };
    const venue: VenueForShaping = {
      id: 'v-1',
      name: 'Brooklyn Paramount',
      city: 'Brooklyn',
      stateRegion: 'New York',
    };
    const row = shapeStoredUpcoming(announcement, venue);
    assert.equal(row.id, 'a-1');
    assert.equal(row.ephemeral, false);
    assert.equal(row.venue.id, 'v-1');
    assert.equal(row.onSaleStatus, 'on_sale');
  });
});

describe('dedupeUpcomingAgainstUserShows', () => {
  const baseRow: PerformerUpcomingRow = {
    id: 'a-1',
    ephemeral: false,
    kind: 'concert',
    headliner: 'Conan Gray',
    headlinerPerformerId: PERFORMER_ID,
    support: null,
    productionName: null,
    showDate: '2026-08-01',
    onSaleStatus: 'on_sale',
    onSaleDate: null,
    ticketUrl: null,
    venue: { id: 'v', name: 'Venue', city: null, stateRegion: null },
  };

  it('drops stored rows the user already linked to a show', () => {
    const out = dedupeUpcomingAgainstUserShows(
      [baseRow],
      [],
      new Set(['a-1']),
    );
    assert.equal(out.length, 0);
  });

  it('keeps an ephemeral row even if its synthetic id is in the linked set', () => {
    const ephemeral = { ...baseRow, id: 'a-1', ephemeral: true };
    const out = dedupeUpcomingAgainstUserShows([ephemeral], [], new Set(['a-1']));
    assert.equal(out.length, 1);
  });

  it('drops rows that fuzzy-match a user show (same name + overlapping date)', () => {
    const out = dedupeUpcomingAgainstUserShows(
      [baseRow],
      [
        {
          date: '2026-08-01',
          endDate: null,
          productionName: null,
          headlinerName: 'Conan Gray',
        },
      ],
      new Set(),
    );
    assert.equal(out.length, 0);
  });

  it('keeps rows that match no user show', () => {
    const out = dedupeUpcomingAgainstUserShows(
      [baseRow],
      [
        {
          date: '2026-08-01',
          endDate: null,
          productionName: null,
          headlinerName: 'Totally Different Artist',
        },
      ],
      new Set(),
    );
    assert.equal(out.length, 1);
  });
});

describe('determineOnSaleStatus / parseOnSaleDate', () => {
  function ev(over: Partial<TMEvent>): TMEvent {
    return {
      id: 'e',
      name: 'n',
      dates: { start: { localDate: '2026-08-01' } },
      ...over,
    };
  }

  it('cancelled status wins', () => {
    assert.equal(
      determineOnSaleStatus(ev({ dates: { start: { localDate: '2026-08-01' }, status: { code: 'cancelled' } } })),
      'cancelled',
    );
  });

  it('announced when public sale is in the future with no active presale', () => {
    assert.equal(
      determineOnSaleStatus(
        ev({ sales: { public: { startDateTime: '2099-01-01T00:00:00Z' } } }),
      ),
      'announced',
    );
  });

  it('presale when a presale window is currently open and public sale is future', () => {
    assert.equal(
      determineOnSaleStatus(
        ev({
          sales: {
            public: { startDateTime: '2099-01-01T00:00:00Z' },
            presales: [{ startDateTime: '2000-01-01T00:00:00Z', endDateTime: '2099-01-01T00:00:00Z' }],
          },
        }),
      ),
      'presale',
    );
  });

  it('on_sale when public sale has opened and not ended', () => {
    assert.equal(
      determineOnSaleStatus(ev({ sales: { public: { startDateTime: '2000-01-01T00:00:00Z' } } })),
      'on_sale',
    );
  });

  it('sold_out on an explicit offsale status after sale opened', () => {
    assert.equal(
      determineOnSaleStatus(
        ev({ dates: { start: { localDate: '2026-08-01' }, status: { code: 'offsale' } } }),
      ),
      'sold_out',
    );
  });

  it('parseOnSaleDate returns null for missing and placeholder dates, a Date otherwise', () => {
    assert.equal(parseOnSaleDate(ev({})), null);
    assert.equal(
      parseOnSaleDate(ev({ sales: { public: { startDateTime: '1900-01-01T00:00:00Z' } } })),
      null,
    );
    const d = parseOnSaleDate(ev({ sales: { public: { startDateTime: '2026-05-01T15:00:00Z' } } }));
    assert.ok(d instanceof Date);
  });
});
