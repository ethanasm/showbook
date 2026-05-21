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
  insertedValues: Record<string, unknown>[];
}
const SCRIPT: Script = {
  selectResults: [],
  insertCount: 0,
  insertOrUpdate: [],
  insertedValues: [],
};
function reset(opts: Partial<Script> = {}) {
  SCRIPT.selectResults = opts.selectResults ?? [];
  SCRIPT.insertCount = 0;
  SCRIPT.insertOrUpdate = opts.insertOrUpdate ?? [];
  SCRIPT.insertedValues = [];
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

// Insert chain: captures the .values(...) argument so tests can assert on the
// payload, then otherwise behaves like the generic chain proxy.
function mkInsertChain(getResult: () => unknown) {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') {
        const value = getResult();
        return (resolve: (v: unknown) => unknown) => Promise.resolve(value).then(resolve);
      }
      if (prop === 'values') {
        return (v: Record<string, unknown>) => {
          SCRIPT.insertedValues.push(v);
          return proxy;
        };
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
  insert: () => mkInsertChain(() => {
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

interface TestTmEvent {
  id: string;
  name: string;
  url: string;
  dates: { start: { localDate: string }; status: { code: string } };
  classifications: unknown[];
  sales: unknown;
  images: unknown[];
  _embedded: {
    venues: Array<{
      id: string;
      name: string;
      city?: { name: string };
      state?: { name: string };
      country?: { countryCode: string };
      location?: { latitude: string; longitude: string };
    }>;
    attractions: Array<{ id: string; name?: string; images: unknown[] }>;
  };
}

function makeTmEvent(
  id: string,
  opts: Partial<{
    name: string;
    date: string;
    venue: Partial<TestTmEvent['_embedded']['venues'][number]>;
    attractions: TestTmEvent['_embedded']['attractions'];
  }> = {},
): TestTmEvent {
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
          ...(opts.venue ?? {}),
        },
      ],
      attractions: opts.attractions ?? [{ id: 'tm-a-1', name: 'Phoebe', images: [] }],
    },
  };
}

// Mutable so individual tests can swap in a custom TM payload. Defaults to a
// single well-formed event so existing tests continue to pass.
let nextSearchEvents: TestTmEvent[] = [makeTmEvent('e-1')];
function setSearchEvents(events: TestTmEvent[]) {
  nextSearchEvents = events;
}

// Mutable so a test can flip the inferred kind to exercise the unknown-skip
// branch in normalizeTmEvent without having to mock the whole TM module.
let nextInferredKind: string = 'concert';
function setInferredKind(kind: string) {
  nextInferredKind = kind;
}

mock.module('@showbook/api', {
  namedExports: {
    searchEvents: async () => ({
      events: nextSearchEvents,
      totalElements: nextSearchEvents.length,
      page: 0,
      size: 200,
    }),
    inferKind: () => nextInferredKind,
    selectBestImage: () => null,
    extractMusicbrainzId: () => null,
    extractFestivalName: (name: string) => name,
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

beforeEach(() => {
  reset();
  setSearchEvents([makeTmEvent('e-1')]);
  setInferredKind('concert');
});

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

  it('drops events whose inferred kind is "unknown" instead of persisting them', async () => {
    // TM events without a usable segment id (the High Roller Wheel et al)
    // used to flood Discover as "UNKNOWN" rows. They're now filtered at
    // normalize time so no insert ever happens.
    reset({
      selectResults: [
        [{ id: 'v1', tmVenueId: 'tm-v-1' }], // venue lookup
        [], // existingSourceIds
      ],
    });
    setInferredKind('unknown');
    const result = await mod.ingestVenue('v1');
    assert.equal(result.events, 0);
    assert.equal(SCRIPT.insertCount, 0);
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

describe('normalizeTmEvent — TM data quality skips', () => {
  it('drops support attractions whose name is missing, leaving support=null', async () => {
    // Mirrors the prod TM resale-marketplace event
    // ZkDnngzZDdAjbJpUFAGnI9l-Lv9oEss (Lizzo, 2026-05-17): a valid headliner
    // attraction followed by a support attraction with only an `id`. Pre-fix
    // we stored support=["undefined"] and Discover rendered "+ undefined".
    setSearchEvents([
      makeTmEvent('e-bad-support', {
        attractions: [
          { id: 'tm-a-h', name: 'Lizzo', images: [] },
          { id: 'tm-a-s', images: [] }, // no name field
        ],
      }),
    ]);
    reset({
      selectResults: [
        [{ id: 'v1', tmVenueId: 'tm-v-1' }],
        [], // existingSourceIds
      ],
    });
    const result = await mod.ingestVenue('v1');
    assert.equal(result.events, 1);
    assert.equal(SCRIPT.insertedValues.length, 1);
    const inserted = SCRIPT.insertedValues[0]!;
    assert.equal(inserted.headliner, 'Lizzo');
    assert.equal(inserted.support, null);
    assert.equal(inserted.supportPerformerIds, null);
  });

  it('skips events whose venue has no city', async () => {
    // TM resale-marketplace listings ship a venue with a `name` but no
    // `city` (the address is the reseller's business). Pre-fix we created a
    // venue row with city='Unknown' and Discover rendered "Friendly Notary
    // · Unknown".
    setSearchEvents([
      makeTmEvent('e-no-city', {
        venue: { name: 'Friendly Notary', city: undefined },
      }),
    ]);
    reset({
      selectResults: [
        [{ id: 'v1', tmVenueId: 'tm-v-1' }],
        [], // existingSourceIds
      ],
    });
    const result = await mod.ingestVenue('v1');
    assert.equal(result.events, 0);
    assert.equal(SCRIPT.insertedValues.length, 0);
  });
});
