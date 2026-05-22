/**
 * Unit tests for the search.futureShows tRPC procedure — the
 * Ticketmaster-backed "Future shows" section of global search.
 *
 * Ticketmaster is mocked so the test drives the mapping + filtering
 * branches without a network call: non-watchable kinds (sports / film /
 * unknown) are dropped, venue-less events are dropped, festival titles
 * run through extractFestivalName, and a TM outage degrades to [].
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

interface FakeTMAttraction {
  id: string;
  name: string;
  images?: { url: string }[];
}
interface FakeTMEvent {
  id: string;
  name: string;
  classifications?: unknown[];
  dates: { start: { localDate: string } };
  _embedded?: { venues?: unknown[]; attractions?: FakeTMAttraction[] };
}

let mockEvents: FakeTMEvent[] = [];
let mockShouldThrow = false;

mock.module('../ticketmaster.js', {
  namedExports: {
    searchEvents: async () => {
      if (mockShouldThrow) throw new Error('Ticketmaster unavailable');
      return {
        events: mockEvents,
        totalElements: mockEvents.length,
        totalPages: 1,
      };
    },
    // Kind is derived from the event name so each fixture can opt into a
    // segment without hand-rolling TM classification objects.
    inferKind: (_classifications: unknown, ctx?: { eventName?: string | null }) => {
      const n = ctx?.eventName ?? '';
      if (/fest/i.test(n)) return 'festival';
      if (/sports/i.test(n)) return 'sports';
      if (/film/i.test(n)) return 'film';
      if (/mystery/i.test(n)) return 'unknown';
      if (/comedy/i.test(n)) return 'comedy';
      return 'concert';
    },
    selectBestImage: (images?: { url: string }[]) => images?.[0]?.url ?? null,
    extractFestivalName: (name: string) => name.replace(/\s+day\s+\d+/i, '').trim(),
  },
});

let searchRouter: typeof import('../routers/search').searchRouter;
let makeFakeDb: typeof import('./_fake-db').makeFakeDb;
let fakeCtx: typeof import('./_fake-db').fakeCtx;

before(async () => {
  ({ searchRouter } = await import('../routers/search'));
  ({ makeFakeDb, fakeCtx } = await import('./_fake-db'));
});

beforeEach(() => {
  mockEvents = [];
  mockShouldThrow = false;
});

let userSeq = 0;
function caller() {
  // Fresh user id per call so the per-user rate-limit window never trips.
  return searchRouter.createCaller(
    fakeCtx(makeFakeDb(), `fs-${userSeq++}-${Math.random()}`) as never,
  );
}

function ev(over: Partial<FakeTMEvent> & { name: string }): FakeTMEvent {
  return {
    id: `evt-${over.name}`,
    classifications: [],
    dates: { start: { localDate: '2099-06-01' } },
    _embedded: {
      venues: [{ id: 'v1', name: 'The Venue', city: { name: 'Portland' } }],
      attractions: [],
    },
    ...over,
  };
}

describe('searchRouter.futureShows (unit)', () => {
  it('rejects a query shorter than 2 characters', async () => {
    await assert.rejects(() => caller().futureShows({ query: 'a' }));
  });

  it('maps a concert event with headliner + support performers', async () => {
    mockEvents = [
      ev({
        name: 'Main Act Tour',
        _embedded: {
          venues: [
            {
              id: 'v1',
              name: 'The Venue',
              city: { name: 'Portland' },
            },
          ],
          attractions: [
            { id: 'a1', name: 'Main Act', images: [{ url: 'img1' }] },
            { id: 'a2', name: 'Support Act', images: [] },
          ],
        },
      }),
    ];
    const result = await caller().futureShows({ query: 'main' });
    assert.equal(result.length, 1);
    const [show] = result;
    assert.equal(show!.kind, 'concert');
    // Concert title is the first attraction (the headliner), not the
    // raw event name.
    assert.equal(show!.title, 'Main Act');
    assert.equal(show!.venueName, 'The Venue');
    assert.equal(show!.venueCity, 'Portland');
    assert.equal(show!.performers.length, 2);
    assert.deepEqual(show!.performers[0], {
      name: 'Main Act',
      tmAttractionId: 'a1',
      imageUrl: 'img1',
    });
    assert.equal(show!.performers[1]!.imageUrl, null);
  });

  it('uses extractFestivalName for the festival title', async () => {
    mockEvents = [ev({ name: 'Sunset Fest Day 2' })];
    const result = await caller().futureShows({ query: 'sunset' });
    assert.equal(result.length, 1);
    assert.equal(result[0]!.kind, 'festival');
    assert.equal(result[0]!.title, 'Sunset Fest');
  });

  it('drops sports / film / unknown events (Discover watchability rule)', async () => {
    mockEvents = [
      ev({ name: 'Sports Night' }),
      ev({ name: 'Film Premiere' }),
      ev({ name: 'Mystery Thing' }),
      ev({ name: 'Real Concert' }),
    ];
    const result = await caller().futureShows({ query: 'thing' });
    assert.equal(result.length, 1);
    assert.equal(result[0]!.title, 'Real Concert');
  });

  it('drops events with no venue', async () => {
    mockEvents = [
      ev({ name: 'No Venue Show', _embedded: { venues: [], attractions: [] } }),
    ];
    const result = await caller().futureShows({ query: 'venue' });
    assert.deepEqual(result, []);
  });

  it('returns an empty list when Ticketmaster fails', async () => {
    mockShouldThrow = true;
    const result = await caller().futureShows({ query: 'anything' });
    assert.deepEqual(result, []);
  });
});
