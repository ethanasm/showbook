import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

interface Script {
  candidates: unknown[];
  searchEventsResults: Array<{ events: unknown[] }>;
  searchAttractionsResults: unknown[][];
  selectBestImageReturns: Array<string | null>;
  updates: Array<{ id: string; coverImageUrl: string }>;
  executeCount: number;
}

const SCRIPT: Script = {
  candidates: [],
  searchEventsResults: [],
  searchAttractionsResults: [],
  selectBestImageReturns: [],
  updates: [],
  executeCount: 0,
};

function reset(opts: Partial<Script> = {}) {
  SCRIPT.candidates = opts.candidates ?? [];
  SCRIPT.searchEventsResults = opts.searchEventsResults ?? [];
  SCRIPT.searchAttractionsResults = opts.searchAttractionsResults ?? [];
  SCRIPT.selectBestImageReturns = opts.selectBestImageReturns ?? [];
  SCRIPT.updates = [];
  SCRIPT.executeCount = 0;
}

// Minimal drizzle-like fake. The job uses a single chained select(), and
// update().set().where() per row.
const fakeDb = {
  select: () => ({
    from: () => ({
      leftJoin: () => ({
        where: () => Promise.resolve(SCRIPT.candidates),
      }),
    }),
  }),
  update: (_table: unknown) => ({
    set: (vals: { coverImageUrl?: string }) => ({
      where: (predicate: { queryChunks?: unknown[] }) => {
        // Real drizzle-orm `eq(shows.id, row.id)` produces a SQL builder
        // whose queryChunks place the right-hand value at index 3.
        let id = 'unknown';
        if (predicate && Array.isArray(predicate.queryChunks)) {
          const idChunk = predicate.queryChunks[3];
          if (typeof idChunk === 'string') id = idChunk;
        }
        SCRIPT.updates.push({
          id,
          coverImageUrl: vals.coverImageUrl ?? '',
        });
        return Promise.resolve();
      },
    }),
  }),
  execute: async () => {
    SCRIPT.executeCount += 1;
    return undefined;
  },
};

mock.module('@showbook/db', {
  namedExports: {
    db: fakeDb,
    shows: { id: 'shows.id' },
    venues: { id: 'venues.id' },
  },
});

mock.module('@showbook/api', {
  namedExports: {
    searchEvents: async () =>
      SCRIPT.searchEventsResults.shift() ?? { events: [] },
    searchAttractions: async () => SCRIPT.searchAttractionsResults.shift() ?? [],
    selectBestImage: () =>
      SCRIPT.selectBestImageReturns.length > 0
        ? SCRIPT.selectBestImageReturns.shift() ?? null
        : null,
  },
});

mock.module('@showbook/observability', {
  namedExports: {
    child: () => ({
      info: () => {},
      warn: () => {},
      error: () => {},
      child() {
        return this;
      },
    }),
    flushObservability: async () => {},
  },
});

let mod: typeof import('../backfill-show-cover-images');

before(async () => {
  mod = await import('../backfill-show-cover-images');
});

describe('runBackfillShowCoverImages', () => {
  beforeEach(() => {
    reset();
  });

  it('returns zeros when no candidate rows', async () => {
    reset({ candidates: [] });
    const result = await mod.runBackfillShowCoverImages();
    assert.deepEqual(result, { total: 0, updated: 0, missing: 0, failed: 0 });
    assert.equal(SCRIPT.updates.length, 0);
  });

  it('uses TM event search image when venue+date are present', async () => {
    reset({
      candidates: [
        {
          id: 'show-1',
          productionName: 'Oh, Mary!',
          date: '2026-06-01',
          endDate: null,
          tmVenueId: 'tm-venue-1',
        },
      ],
      searchEventsResults: [{ events: [{ images: [{ url: 'https://tm/img.jpg' }] }] }],
      selectBestImageReturns: ['https://tm/img.jpg'],
    });
    const result = await mod.runBackfillShowCoverImages();
    assert.equal(result.updated, 1);
    assert.equal(result.missing, 0);
    assert.equal(SCRIPT.updates.length, 1);
    assert.equal(SCRIPT.updates[0].id, 'show-1');
    assert.equal(SCRIPT.updates[0].coverImageUrl, 'https://tm/img.jpg');
  });

  it('falls back to attraction search when no event match', async () => {
    reset({
      candidates: [
        {
          id: 'show-2',
          productionName: 'Ragtime',
          date: '2026-06-03',
          endDate: null,
          tmVenueId: null, // forces straight to attraction path
        },
      ],
      searchAttractionsResults: [
        [{ name: 'Ragtime', images: [{ url: 'https://tm/ragtime.jpg' }] }],
      ],
      selectBestImageReturns: ['https://tm/ragtime.jpg'],
    });
    const result = await mod.runBackfillShowCoverImages();
    assert.equal(result.updated, 1);
    assert.equal(SCRIPT.updates[0].coverImageUrl, 'https://tm/ragtime.jpg');
  });

  it('counts missing when neither path returns an image', async () => {
    reset({
      candidates: [
        {
          id: 'show-3',
          productionName: 'Obscure Off-Broadway',
          date: '2026-07-01',
          endDate: null,
          tmVenueId: null,
        },
      ],
      searchAttractionsResults: [[]],
    });
    const result = await mod.runBackfillShowCoverImages();
    assert.equal(result.updated, 0);
    assert.equal(result.missing, 1);
    assert.equal(SCRIPT.updates.length, 0);
  });

  it('skips attraction matches whose name does not match', async () => {
    reset({
      candidates: [
        {
          id: 'show-4',
          productionName: 'Hamlet',
          date: '2026-08-01',
          endDate: null,
          tmVenueId: null,
        },
      ],
      // TM returns "Hamilton" — wrong show, must not be used.
      searchAttractionsResults: [
        [{ name: 'Hamilton', images: [{ url: 'https://tm/wrong.jpg' }] }],
      ],
    });
    const result = await mod.runBackfillShowCoverImages();
    assert.equal(result.updated, 0);
    assert.equal(result.missing, 1);
  });

  it('caches lookups by productionName across rows', async () => {
    reset({
      candidates: [
        { id: 'show-a', productionName: 'Wicked', date: null, endDate: null, tmVenueId: null },
        { id: 'show-b', productionName: 'wicked', date: null, endDate: null, tmVenueId: null },
      ],
      // Only one attraction result — second row should hit the cache.
      searchAttractionsResults: [
        [{ name: 'Wicked', images: [{ url: 'https://tm/wicked.jpg' }] }],
      ],
      selectBestImageReturns: ['https://tm/wicked.jpg'],
    });
    const result = await mod.runBackfillShowCoverImages();
    assert.equal(result.updated, 2);
    assert.equal(SCRIPT.updates.length, 2);
    assert.equal(SCRIPT.updates[0].coverImageUrl, 'https://tm/wicked.jpg');
    assert.equal(SCRIPT.updates[1].coverImageUrl, 'https://tm/wicked.jpg');
  });
});
