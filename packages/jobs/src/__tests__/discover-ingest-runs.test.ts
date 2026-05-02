/**
 * Drives discover-ingest's upsertRun path by feeding multiple TM events
 * at the same venue with the same headliner — run-grouping should
 * coalesce them into a single multi-night run.
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

interface Script {
  selectResults: unknown[][];
  insertCount: number;
  updateCount: number;
}
const SCRIPT: Script = {
  selectResults: [],
  insertCount: 0,
  updateCount: 0,
};
function reset(opts: Partial<Script> = {}) {
  SCRIPT.selectResults = opts.selectResults ?? [];
  SCRIPT.insertCount = 0;
  SCRIPT.updateCount = 0;
}
function mkChain(getResult: () => unknown) {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') {
        const value = getResult();
        return (resolve: (v: unknown) => unknown) => Promise.resolve(value).then(resolve);
      }
      return () => proxy;
    },
  };
  const proxy: object = new Proxy({}, handler);
  return proxy;
}

const fakeDb = {
  select: () => mkChain(() => SCRIPT.selectResults.shift() ?? []),
  selectDistinct: () => mkChain(() => SCRIPT.selectResults.shift() ?? []),
  selectDistinctOn: () => mkChain(() => SCRIPT.selectResults.shift() ?? []),
  insert: () => mkChain(() => {
    SCRIPT.insertCount += 1;
    return [];
  }),
  update: () => mkChain(() => {
    SCRIPT.updateCount += 1;
    return [];
  }),
  delete: () => mkChain(() => []),
  execute: async () => undefined,
};

mock.module('@showbook/db', {
  namedExports: {
    db: fakeDb,
    announcements: {},
    userVenueFollows: {},
    userPerformerFollows: {},
    userRegions: {},
    venues: {},
    performers: {},
  },
});

function tmEvent(id: string, date: string) {
  return {
    id,
    name: 'Hamilton',
    url: null,
    dates: { start: { localDate: date }, status: { code: 'onsale' } },
    classifications: [],
    sales: null,
    images: [],
    _embedded: {
      venues: [
        {
          id: 'tm-v-1',
          name: 'Richard Rodgers',
          city: { name: 'NYC' },
          state: { name: 'New York' },
          country: { countryCode: 'US' },
          location: { latitude: '40.76', longitude: '-73.98' },
        },
      ],
      attractions: [{ id: 'tm-a-1', name: 'Hamilton', images: [] }],
    },
  };
}

mock.module('@showbook/api', {
  namedExports: {
    searchEvents: async () => ({
      events: [
        tmEvent('e-1', '2026-08-01'),
        tmEvent('e-2', '2026-08-02'),
        tmEvent('e-3', '2026-08-03'),
      ],
      totalElements: 3,
      page: 0,
      size: 200,
    }),
    inferKind: () => 'theatre',
    selectBestImage: () => null,
    extractMusicbrainzId: () => null,
    matchOrCreateVenue: async () => ({
      venue: { id: 'v1', name: 'Richard Rodgers', city: 'NYC' },
      created: false,
    }),
    matchOrCreatePerformer: async (input: { name: string }) => ({
      performer: { id: `perf-${input.name}`, name: input.name },
      created: false,
    }),
  },
});

let mod: typeof import('../discover-ingest');

before(async () => {
  mod = await import('../discover-ingest');
});

beforeEach(() => reset());

describe('ingestVenue with a multi-night run', () => {
  it('upserts a fresh run row when no existing run is found', async () => {
    reset({
      selectResults: [
        [{ id: 'v1', tmVenueId: 'tm-v-1' }], // venue
        [], // existingSourceIds
        [], // upsertRun: existing lookup → none
      ],
    });
    const result = await mod.ingestVenue('v1');
    assert.equal(result.events, 1); // 1 run created
    assert.ok(SCRIPT.insertCount >= 1);
  });

  it('extends an existing run when one is found', async () => {
    const existing = {
      id: 'a-existing',
      kind: 'theatre',
      productionName: 'Hamilton',
      venueId: 'v1',
      performanceDates: ['2026-07-30'],
      runStartDate: '2026-07-30',
      runEndDate: '2026-07-30',
      headlinerPerformerId: 'perf-Hamilton',
      support: null,
      supportPerformerIds: null,
      onSaleDate: null,
      onSaleStatus: 'on_sale',
      ticketUrl: null,
    };
    reset({
      selectResults: [
        [{ id: 'v1', tmVenueId: 'tm-v-1' }],
        [], // existingSourceIds
        [existing], // upsertRun: existing lookup
      ],
    });
    const result = await mod.ingestVenue('v1');
    assert.equal(result.events, 1); // extended
    assert.ok(SCRIPT.updateCount >= 1);
  });
});
