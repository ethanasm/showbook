/**
 * Unit tests for discover-ingest's higher-level runners (ingestVenue,
 * ingestRegion, ingestPerformer, runDiscoverIngest). Mocks the imported
 * `db`, the @showbook/api boundary (matchOrCreate*, searchEvents,
 * inferKind, etc.) so the runners can be exercised without DB or
 * network.
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

interface Script {
  selectResults: unknown[][];
  insertCount: number;
  updateCount: number;
  deleteResults: unknown[][];
  executeCount: number;
}
const SCRIPT: Script = {
  selectResults: [],
  insertCount: 0,
  updateCount: 0,
  deleteResults: [],
  executeCount: 0,
};
function reset(opts: Partial<Script> = {}) {
  SCRIPT.selectResults = opts.selectResults ?? [];
  SCRIPT.deleteResults = opts.deleteResults ?? [];
  SCRIPT.insertCount = 0;
  SCRIPT.updateCount = 0;
  SCRIPT.executeCount = 0;
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

mock.module('@showbook/db', {
  namedExports: {
    db: {
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
      delete: () => mkChain(() => SCRIPT.deleteResults.shift() ?? []),
      execute: async () => {
        SCRIPT.executeCount += 1;
      },
    },
    announcements: {},
    userVenueFollows: {},
    userPerformerFollows: {},
    userRegions: {},
    venues: {},
    performers: {},
  },
});

mock.module('@showbook/api', {
  namedExports: {
    searchEvents: async () => ({ events: [], totalElements: 0, page: 0, size: 200 }),
    inferKind: () => 'concert',
    selectBestImage: () => null,
    extractMusicbrainzId: () => null,
    matchOrCreateVenue: async () => ({
      venue: { id: 'v1', name: 'V', city: 'C' },
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

describe('ingestVenue', () => {
  it('returns 0 when venue does not exist', async () => {
    reset({ selectResults: [[]] });
    const result = await mod.ingestVenue('00000000-0000-0000-0000-000000000000');
    assert.equal(result.events, 0);
  });

  it('returns 0 when venue has no TM id', async () => {
    reset({ selectResults: [[{ id: 'v1', tmVenueId: null }]] });
    const result = await mod.ingestVenue('v1');
    assert.equal(result.events, 0);
  });

  it('runs end to end for a venue with no TM events', async () => {
    reset({
      selectResults: [
        [{ id: 'v1', tmVenueId: 'tm-v-1' }], // venue lookup
        [], // existingSourceIds
      ],
    });
    const result = await mod.ingestVenue('v1');
    assert.equal(result.events, 0);
  });
});

describe('ingestRegion', () => {
  it('returns 0 when region does not exist', async () => {
    reset({ selectResults: [[]] });
    const result = await mod.ingestRegion('00000000-0000-0000-0000-000000000000');
    assert.equal(result.events, 0);
  });

  it('returns 0 when region is inactive', async () => {
    reset({
      selectResults: [
        [{ id: 'r1', latitude: 40, longitude: -74, radiusMiles: 25, active: false }],
      ],
    });
    const result = await mod.ingestRegion('r1');
    assert.equal(result.events, 0);
  });

  it('runs end to end with empty TM results', async () => {
    reset({
      selectResults: [
        [{ id: 'r1', latitude: 40, longitude: -74, radiusMiles: 25, active: true }],
        [], // followedVenueRows
        [], // existingSourceIds
      ],
    });
    const result = await mod.ingestRegion('r1');
    assert.equal(result.events, 0);
  });
});

describe('ingestPerformer', () => {
  it('returns 0 when performer does not exist', async () => {
    reset({ selectResults: [[]] });
    const result = await mod.ingestPerformer('00000000-0000-0000-0000-000000000000');
    assert.equal(result.events, 0);
  });

  it('returns 0 when performer has no TM id', async () => {
    reset({
      selectResults: [[{ id: 'p1', tmAttractionId: null }]],
    });
    const result = await mod.ingestPerformer('p1');
    assert.equal(result.events, 0);
  });

  it('runs end to end with empty TM results', async () => {
    reset({
      selectResults: [
        [{ id: 'p1', tmAttractionId: 'tm-p-1' }],
        [], // existingSourceIds
      ],
    });
    const result = await mod.ingestPerformer('p1');
    assert.equal(result.events, 0);
  });
});

describe('runDiscoverIngest', () => {
  it('completes phases 1-4 with no follows or regions', async () => {
    reset({
      selectResults: [
        [], // existingSourceIds
        [], // followedVenueRows
        [], // regionRows
        [], // followedPerformerRows
      ],
      deleteResults: [[]], // phase 4 cleanup returns nothing
    });
    const result = await mod.runDiscoverIngest();
    assert.equal(result.phase1Events, 0);
    assert.equal(result.phase2Events, 0);
    assert.equal(result.phase3Events, 0);
    assert.equal(result.pruned, 0);
  });
});
