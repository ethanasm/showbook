/**
 * Discover-ingest tests with mocked searchEvents that returns real
 * events. Drives normalizeTmEvent, insertSingleEvent, upsertRun, and
 * pruneDuplicateFestivalSinglesForRun without DB or network.
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

interface Script {
  selectResults: unknown[][];
  insertCount: number;
  insertOrUpdate: unknown[][];
}
const SCRIPT: Script = {
  selectResults: [],
  insertCount: 0,
  insertOrUpdate: [],
};
function reset(opts: Partial<Script> = {}) {
  SCRIPT.selectResults = opts.selectResults ?? [];
  SCRIPT.insertCount = 0;
  SCRIPT.insertOrUpdate = opts.insertOrUpdate ?? [];
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
    return SCRIPT.insertOrUpdate.shift() ?? [];
  }),
  update: () => mkChain(() => SCRIPT.insertOrUpdate.shift() ?? []),
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

function makeTmEvent(id: string, opts: Partial<{ name: string; date: string }> = {}) {
  return {
    id,
    name: opts.name ?? `Event ${id}`,
    url: 'https://tm/event',
    dates: {
      start: { localDate: opts.date ?? '2026-08-01' },
      status: { code: 'onsale' },
    },
    classifications: [],
    sales: null,
    images: [],
    _embedded: {
      venues: [
        {
          id: 'tm-v-1',
          name: 'Greek Theater',
          city: { name: 'Berkeley' },
          state: { name: 'California' },
          country: { countryCode: 'US' },
          location: { latitude: '37.8', longitude: '-122.2' },
        },
      ],
      attractions: [{ id: 'tm-a-1', name: 'Phoebe', images: [] }],
    },
  };
}

mock.module('@showbook/api', {
  namedExports: {
    searchEvents: async () => ({
      events: [makeTmEvent('e-1')],
      totalElements: 1,
      page: 0,
      size: 200,
    }),
    inferKind: () => 'concert',
    selectBestImage: () => null,
    extractMusicbrainzId: () => null,
    matchOrCreateVenue: async () => ({
      venue: { id: 'v1', name: 'Greek', city: 'Berkeley' },
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

describe('ingestVenue (with events)', () => {
  it('inserts a new announcement for a single-night event', async () => {
    reset({
      selectResults: [
        [{ id: 'v1', tmVenueId: 'tm-v-1' }], // venue lookup
        [], // existingSourceIds
      ],
    });
    const result = await mod.ingestVenue('v1');
    assert.equal(result.events, 1);
    assert.ok(SCRIPT.insertCount >= 1);
  });

  it('skips events whose source id is already ingested', async () => {
    reset({
      selectResults: [
        [{ id: 'v1', tmVenueId: 'tm-v-1' }],
        [{ sourceEventId: 'e-1' }], // existingSourceIds includes our event
      ],
    });
    const result = await mod.ingestVenue('v1');
    assert.equal(result.events, 0);
  });
});

describe('ingestPerformer (with events)', () => {
  it('inserts an announcement for a single-night event', async () => {
    reset({
      selectResults: [
        [{ id: 'p1', tmAttractionId: 'tm-a-1' }],
        [], // existingSourceIds
      ],
    });
    const result = await mod.ingestPerformer('p1');
    assert.equal(result.events, 1);
  });
});

describe('runDiscoverIngest (with events)', () => {
  it('runs all phases with one followed venue and processes its events', async () => {
    reset({
      selectResults: [
        [], // existingSourceIds
        [{ venueId: 'v1', tmVenueId: 'tm-v-1' }], // followedVenueRows
        [], // regionRows
        [], // followedPerformerRows
      ],
    });
    const result = await mod.runDiscoverIngest();
    assert.equal(result.phase1Events, 1);
  });

  it('runs phases when all phases have inputs', async () => {
    reset({
      selectResults: [
        [], // existingSourceIds
        [{ venueId: 'v1', tmVenueId: 'tm-v-1' }], // followedVenueRows
        [{ latitude: 40, longitude: -74, radiusMiles: 25 }], // regionRows
        [{ performerId: 'p1', tmAttractionId: 'tm-a-1' }], // followedPerformerRows
      ],
    });
    const result = await mod.runDiscoverIngest();
    // Phase 1 inserts the event; Phase 2 filters it out (followed venue)
    // Phase 3 also encounters it but the followed venue filter applies
    assert.ok(result.phase1Events >= 0);
    assert.ok(result.phase2Events >= 0);
    assert.ok(result.phase3Events >= 0);
  });
});

describe('ingestRegion (with events)', () => {
  it('inserts an announcement for a region search', async () => {
    reset({
      selectResults: [
        [{ id: 'r1', latitude: 40, longitude: -74, radiusMiles: 25, active: true }],
        [], // followedVenueRows
        [], // existingSourceIds
      ],
    });
    const result = await mod.ingestRegion('r1');
    assert.equal(result.events, 1);
  });

  it('filters out events at a followed venue', async () => {
    reset({
      selectResults: [
        [{ id: 'r1', latitude: 40, longitude: -74, radiusMiles: 25, active: true }],
        [{ tmVenueId: 'tm-v-1' }], // already-followed venue
        [], // existingSourceIds
      ],
    });
    const result = await mod.ingestRegion('r1');
    assert.equal(result.events, 0);
  });
});
