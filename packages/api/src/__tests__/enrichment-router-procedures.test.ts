/**
 * Unit tests for enrichment router procedures with their external
 * dependencies mocked. Covers searchTM, fetchTMEventByUrl,
 * fetchSetlist, geocodeVenue, searchPlaces, placeDetails, parseChat,
 * extractCast — paths that orchestrate but don't touch the DB.
 */

import { describe, it, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';

mock.module('../ticketmaster.js', {
  namedExports: {
    searchEvents: async () => ({
      events: [
        {
          id: 'evt-1',
          name: 'Phoebe',
          url: 'https://tm/event/evt-1',
          dates: { start: { localDate: '2026-08-01' } },
          classifications: [],
          _embedded: {
            venues: [
              {
                id: 'tm-v',
                name: 'Greek',
                city: { name: 'Berkeley' },
                state: { stateCode: 'CA' },
                country: { countryCode: 'US' },
                location: { latitude: '37.8', longitude: '-122.2' },
              },
            ],
            attractions: [{ id: 'tm-a', name: 'Phoebe', images: [] }],
          },
        },
      ],
      totalElements: 1,
      page: 0,
      size: 5,
    }),
    getEvent: async (id: string) => {
      if (id === 'missing') return null;
      return {
        id,
        name: 'Phoebe',
        url: null,
        dates: { start: { localDate: '2026-08-01' } },
        classifications: [],
        _embedded: { venues: [], attractions: [] },
      };
    },
    inferKind: () => 'concert',
    selectBestImage: () => null,
  },
});

mock.module('../setlistfm.js', {
  namedExports: {
    searchArtist: async (name: string) => {
      if (name === 'unknown') return [];
      return [{ mbid: 'mbid-1', name }];
    },
    searchSetlist: async (mbid: string, date: string) => {
      if (date === 'no-setlist') return null;
      return { setlist: [{ name: 'set', songs: ['A'] }], tourName: 'Tour' };
    },
  },
});

mock.module('../groq.js', {
  namedExports: {
    parseShowInput: async () => ({
      headliner: 'X',
      venue_hint: null,
      date_hint: null,
      seat_hint: null,
      kind_hint: null,
    }),
    extractCast: async () => [],
    extractShowFromEmail: async () => null,
    extractShowFromPdfText: async () => null,
  },
});

mock.module('../google-places.js', {
  namedExports: {
    autocomplete: async () => [{ placeId: 'p1', description: 'X' }],
    getPlaceDetails: async (id: string) => {
      if (id === 'missing') return null;
      return {
        name: 'V',
        city: 'C',
        stateRegion: 'CA',
        country: 'US',
        latitude: 0,
        longitude: 0,
        googlePlaceId: id,
        photoUrl: null,
      };
    },
  },
});

mock.module('../geocode.js', {
  namedExports: {
    geocodeVenue: async () => ({ lat: 1, lng: 2, stateRegion: 'NY', country: 'US' }),
  },
});

mock.module('../gmail.js', {
  namedExports: {
    searchMessages: async () => ({ messages: [], nextPageToken: undefined }),
    getMessageBody: async () => ({
      subject: '',
      body: '',
      from: '',
      date: '',
    }),
    buildTicketSearchQuery: () => 'q',
    buildBulkScanQueries: () => ['q'],
  },
});

let enrichmentRouter: typeof import('../routers/enrichment').enrichmentRouter;
let makeFakeDb: typeof import('./_fake-db').makeFakeDb;
let fakeCtx: typeof import('./_fake-db').fakeCtx;

before(async () => {
  ({ enrichmentRouter } = await import('../routers/enrichment'));
  ({ makeFakeDb, fakeCtx } = await import('./_fake-db'));
});

const USER_ID = `enrich-${Math.random()}`;
function caller(userId = USER_ID) {
  return enrichmentRouter.createCaller(
    fakeCtx(makeFakeDb(), userId) as never,
  );
}

describe('enrichmentRouter procedures (mocked)', () => {
  it('searchTM maps events through mapEventToResult', async () => {
    const result = await caller().searchTM({ headliner: 'Phoebe' });
    assert.equal(result.length, 1);
    assert.equal(result[0]!.tmEventId, 'evt-1');
    assert.equal(result[0]!.kind, 'concert');
  });

  it('fetchTMEventByUrl extracts event id from URL path', async () => {
    const result = await caller().fetchTMEventByUrl({
      url: 'https://www.ticketmaster.com/event/abc123',
    });
    assert.equal(result.tmEventId, 'abc123');
  });

  it('fetchTMEventByUrl extracts event id from query parameter', async () => {
    const result = await caller().fetchTMEventByUrl({
      url: 'https://tm.com/?eventId=qid42',
    });
    assert.equal(result.tmEventId, 'qid42');
  });

  it('fetchTMEventByUrl falls back to raw input when no pattern matches', async () => {
    const result = await caller().fetchTMEventByUrl({ url: 'plainEventId' });
    assert.equal(result.tmEventId, 'plainEventId');
  });

  it('fetchTMEventByUrl throws NOT_FOUND when getEvent returns null', async () => {
    await assert.rejects(
      () => caller().fetchTMEventByUrl({ url: 'missing' }),
      (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
    );
  });

  it('fetchSetlist returns setlist when match exists', async () => {
    const result = await caller().fetchSetlist({
      performerName: 'Phoebe',
      date: '2026-08-01',
    });
    assert.ok(result);
    assert.equal(result?.tourName, 'Tour');
  });

  it('fetchSetlist returns mbid even when setlist is missing', async () => {
    const result = await caller().fetchSetlist({
      performerName: 'Phoebe',
      date: 'no-setlist',
    });
    assert.equal(result?.setlist, null);
    assert.equal(result?.mbid, 'mbid-1');
  });

  it('fetchSetlist returns null when no artist match', async () => {
    const result = await caller().fetchSetlist({
      performerName: 'unknown',
      date: '2026-08-01',
    });
    assert.equal(result, null);
  });

  it('geocodeVenue passes through to the geocoder', async () => {
    const result = await caller().geocodeVenue({
      venueName: 'X',
      city: 'C',
    });
    assert.deepEqual(result, { lat: 1, lng: 2, stateRegion: 'NY', country: 'US' });
  });

  it('searchPlaces accepts default venue type', async () => {
    const result = await caller().searchPlaces({ query: 'Greek' });
    assert.equal(result.length, 1);
  });

  it('searchPlaces accepts city type', async () => {
    const result = await caller().searchPlaces({ query: 'NYC', types: 'city' });
    assert.equal(result.length, 1);
  });

  it('placeDetails throws NOT_FOUND when missing', async () => {
    await assert.rejects(
      () => caller().placeDetails({ placeId: 'missing' }),
      (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
    );
  });

  it('placeDetails returns details when found', async () => {
    const result = await caller().placeDetails({ placeId: 'p1' });
    assert.equal(result.googlePlaceId, 'p1');
  });

  it('parseChat returns the parsed structure (mocked)', async () => {
    const result = await caller().parseChat({ freeText: 'foo' });
    assert.equal(result.headliner, 'X');
  });

  it('extractCast returns the parsed list', async () => {
    const result = await caller().extractCast({
      imageBase64: 'data:image/png;base64,xx',
    });
    assert.deepEqual(result.cast, []);
  });

  it('scanGmailForShow returns [] when there are no messages', async () => {
    const result = await caller().scanGmailForShow({
      accessToken: 'tok',
      headliner: 'X',
    });
    assert.deepEqual(result, []);
  });

  it('bulkScanGmail returns a result when no messages found', async () => {
    const result = await caller().bulkScanGmail({ accessToken: 'tok' });
    assert.ok(result);
  });

  it('extractFromPdf rejects when PDF text extraction yields empty', async () => {
    // pdf-parse reads the buffer; an invalid base64 will throw inside.
    await assert.rejects(() =>
      caller().extractFromPdf({ fileBase64: 'a' }),
    );
  });
});
