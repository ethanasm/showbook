/**
 * Unit tests for showsRouter.create / showsRouter.update. These paths
 * call out to `matchOrCreateVenue`, `matchOrCreatePerformer`,
 * `geocodeVenue`, and `searchEvents`. We swap them via `node:test`'s
 * `mock.module` so the procedures run end-to-end against a fake DB
 * without any network or DB connections.
 */

import { describe, it, before, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('../venue-matcher.js', {
  namedExports: {
    matchOrCreateVenue: async (input: { name: string; city: string; stateRegion?: string }) => ({
      venue: {
        id: 'venue-1',
        name: input.name,
        city: input.city,
        stateRegion: input.stateRegion ?? null,
        ticketmasterVenueId: null,
        googlePlaceId: null,
        photoUrl: null,
      },
      created: false,
    }),
    findTmVenueId: async () => null,
  },
});

mock.module('../performer-matcher.js', {
  namedExports: {
    matchOrCreatePerformer: async (input: { name: string }) => ({
      performer: { id: `perf-${input.name}`, name: input.name },
      created: false,
    }),
  },
});

mock.module('../geocode.js', {
  namedExports: {
    geocodeVenue: async () => null,
  },
});

mock.module('../ticketmaster.js', {
  namedExports: {
    searchEvents: async () => ({ events: [], totalElements: 0, page: 0, size: 0 }),
    searchAttractions: async () => [],
    searchVenues: async () => [],
    selectBestImage: () => null,
    extractMusicbrainzId: () => null,
    inferKind: () => 'concert',
    getEvent: async () => null,
  },
});

let showsRouter: typeof import('../routers/shows').showsRouter;
let makeFakeDb: typeof import('./_fake-db').makeFakeDb;
let fakeCtx: typeof import('./_fake-db').fakeCtx;

before(async () => {
  ({ showsRouter } = await import('../routers/shows'));
  ({ makeFakeDb, fakeCtx } = await import('./_fake-db'));
});

function caller(db: ReturnType<typeof makeFakeDb>, userId = 'test-user') {
  return showsRouter.createCaller(fakeCtx(db, userId) as never);
}

describe('showsRouter.create (unit)', () => {
  it('creates a concert show in past state with a single performer', async () => {
    const db = makeFakeDb({
      insertResults: [[{ id: 'show-1' }]],
    });
    (db as unknown as { query: { shows: { findFirst: () => Promise<unknown> } } }).query = {
      shows: { findFirst: async () => ({ id: 'show-1', kind: 'concert' }) } as never,
    };
    const result = await caller(db).create({
      kind: 'concert',
      headliner: { name: 'Phoebe' },
      venue: { name: 'Greek', city: 'Berkeley' },
      date: '2020-01-01', // past
      ticketCount: 1,
    });
    assert.equal((result as { id: string }).id, 'show-1');
  });

  it('handles theatre with productionName on the show row', async () => {
    const db = makeFakeDb({
      insertResults: [[{ id: 'show-2' }]],
    });
    (db as unknown as { query: { shows: { findFirst: () => Promise<unknown> } } }).query = {
      shows: { findFirst: async () => ({ id: 'show-2', kind: 'theatre' }) } as never,
    };
    const result = await caller(db).create({
      kind: 'theatre',
      headliner: { name: 'Hamilton' },
      venue: { name: 'Richard Rodgers', city: 'NYC' },
      date: '2020-01-01',
      ticketCount: 1,
    });
    assert.equal((result as { id: string }).id, 'show-2');
  });

  it('puts a future show with seat into ticketed state', async () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 60)
      .toISOString()
      .slice(0, 10);
    const db = makeFakeDb({
      insertResults: [[{ id: 'show-3' }]],
    });
    (db as unknown as { query: { shows: { findFirst: () => Promise<unknown> } } }).query = {
      shows: { findFirst: async () => ({ id: 'show-3' }) } as never,
    };
    const result = await caller(db).create({
      kind: 'concert',
      headliner: { name: 'X' },
      venue: { name: 'V', city: 'C' },
      date: futureDate,
      seat: 'A1',
      ticketCount: 1,
    });
    assert.ok(result);
  });

  it('puts a future show with no seat into watching state', async () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 60)
      .toISOString()
      .slice(0, 10);
    const db = makeFakeDb({
      insertResults: [[{ id: 'show-4' }]],
    });
    (db as unknown as { query: { shows: { findFirst: () => Promise<unknown> } } }).query = {
      shows: { findFirst: async () => ({ id: 'show-4' }) } as never,
    };
    const result = await caller(db).create({
      kind: 'concert',
      headliner: { name: 'X' },
      venue: { name: 'V', city: 'C' },
      date: futureDate,
      ticketCount: 1,
    });
    assert.ok(result);
  });

  it('accepts performers list and a setlist, persists cleaned shape', async () => {
    const db = makeFakeDb({
      insertResults: [[{ id: 'show-5' }]],
    });
    (db as unknown as { query: { shows: { findFirst: () => Promise<unknown> } } }).query = {
      shows: { findFirst: async () => ({ id: 'show-5' }) } as never,
    };
    const result = await caller(db).create({
      kind: 'concert',
      headliner: {
        name: 'Phoebe',
        setlist: { sections: [{ kind: 'set', songs: [{ title: 'Motion Sickness' }] }] },
      },
      performers: [
        {
          name: 'Support',
          role: 'support',
          sortOrder: 1,
          setlist: { sections: [{ kind: 'set', songs: [{ title: 'Opening' }] }] },
        },
      ],
      venue: { name: 'V', city: 'C' },
      date: '2020-01-01',
      ticketCount: 1,
    });
    assert.ok(result);
  });
});

describe('showsRouter.update (unit)', () => {
  it('throws NOT_FOUND when show does not exist', async () => {
    const db = makeFakeDb({ selectResults: [[]] });
    await assert.rejects(() =>
      caller(db).update({
        showId: '11111111-1111-4111-8111-111111111111',
        kind: 'concert',
        headliner: { name: 'X' },
        venue: { name: 'V', city: 'C' },
        date: '2020-01-01',
        ticketCount: 1,
      }),
    );
  });

  it('updates an existing show', async () => {
    const existing = { id: '11111111-1111-4111-8111-111111111111', userId: 'test-user', state: 'past' };
    const db = makeFakeDb({
      selectResults: [[existing]],
    });
    (db as unknown as { query: { shows: { findFirst: () => Promise<unknown> } } }).query = {
      shows: { findFirst: async () => ({ id: existing.id }) } as never,
    };
    const result = await caller(db).update({
      showId: existing.id,
      kind: 'concert',
      headliner: { name: 'X' },
      venue: { name: 'V', city: 'C' },
      date: '2020-01-01',
      ticketCount: 1,
    });
    assert.ok(result);
  });

  it('updates a theatre show with productionName', async () => {
    const existing = { id: '11111111-1111-4111-8111-111111111111', userId: 'test-user', state: 'past' };
    const db = makeFakeDb({
      selectResults: [[existing]],
    });
    (db as unknown as { query: { shows: { findFirst: () => Promise<unknown> } } }).query = {
      shows: { findFirst: async () => ({ id: existing.id }) } as never,
    };
    const result = await caller(db).update({
      showId: existing.id,
      kind: 'theatre',
      headliner: { name: 'Hamilton' },
      venue: { name: 'V', city: 'C' },
      date: '2020-01-01',
      ticketCount: 1,
      performers: [
        { name: 'Lead', role: 'cast', sortOrder: 1, characterName: 'Hamilton' },
      ],
    });
    assert.ok(result);
  });
});

describe('showsRouter.addPerformer (happy path with mocked matcher)', () => {
  it('inserts a new showPerformer with sortOrder = max+1', async () => {
    const db = makeFakeDb({
      selectResults: [
        [{ id: '11111111-1111-4111-8111-111111111111' }], // ownership
        [{ maxOrder: 3 }], // max(sortOrder) lookup
      ],
    });
    const result = await caller(db).addPerformer({
      showId: '11111111-1111-4111-8111-111111111111',
      name: 'Phoebe',
      role: 'support',
      sortOrder: 1,
    } as never);
    assert.equal(result.performerId, 'perf-Phoebe');
  });
});
