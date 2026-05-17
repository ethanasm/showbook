/**
 * Unit tests for runBackfillPerformerMbids. setlist.fm is mocked at the
 * `@showbook/api` boundary (searchArtist + isUniqueViolation) and the DB
 * is replaced with a minimal drizzle-shaped fake — same pattern as
 * backfill-show-cover-images.test.ts.
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

interface Script {
  candidates: Array<{ id: string; name: string }>;
  searchResultsByName: Map<string, Array<{ mbid: string }>>;
  searchErrorsByName: Map<string, Error>;
  conflictMbids: Set<string>;
  updates: Array<{ id: string; musicbrainzId: string }>;
}

const SCRIPT: Script = {
  candidates: [],
  searchResultsByName: new Map(),
  searchErrorsByName: new Map(),
  conflictMbids: new Set(),
  updates: [],
};

function reset(opts: Partial<Script> = {}) {
  SCRIPT.candidates = opts.candidates ?? [];
  SCRIPT.searchResultsByName = opts.searchResultsByName ?? new Map();
  SCRIPT.searchErrorsByName = opts.searchErrorsByName ?? new Map();
  SCRIPT.conflictMbids = opts.conflictMbids ?? new Set();
  SCRIPT.updates = [];
}

const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => Promise.resolve(SCRIPT.candidates),
    }),
  }),
  update: (_table: unknown) => ({
    set: (vals: { musicbrainzId?: string }) => ({
      where: (predicate: { queryChunks?: unknown[] }) => {
        // `eq(performers.id, performer.id)` — id lands at index 3 of
        // the drizzle queryChunks array. Same trick as the
        // backfill-show-cover-images fake.
        let id = 'unknown';
        if (predicate && Array.isArray(predicate.queryChunks)) {
          const idChunk = predicate.queryChunks[3];
          if (typeof idChunk === 'string') id = idChunk;
        }
        const mbid = vals.musicbrainzId ?? '';
        if (SCRIPT.conflictMbids.has(mbid)) {
          // Match what drizzle-orm wrapping looks like: outer
          // DrizzleQueryError with a `.cause` that carries SQLSTATE 23505.
          const cause = Object.assign(
            new Error('duplicate key value violates unique constraint'),
            { code: '23505' },
          );
          const err = Object.assign(new Error('drizzle: insert failed'), {
            cause,
          });
          return Promise.reject(err);
        }
        SCRIPT.updates.push({ id, musicbrainzId: mbid });
        return Promise.resolve(undefined);
      },
    }),
  }),
};

mock.module('@showbook/db', {
  namedExports: {
    db: fakeDb,
    performers: {
      id: 'performers.id',
      name: 'performers.name',
      musicbrainzId: 'performers.musicbrainz_id',
    },
  },
});

mock.module('@showbook/api', {
  namedExports: {
    searchArtist: async (name: string) => {
      const err = SCRIPT.searchErrorsByName.get(name);
      if (err) throw err;
      return SCRIPT.searchResultsByName.get(name) ?? [];
    },
    isUniqueViolation: (err: unknown): boolean => {
      let cur = err;
      while (cur != null && typeof cur === 'object') {
        if ((cur as { code?: string }).code === '23505') return true;
        cur = (cur as { cause?: unknown }).cause;
      }
      return false;
    },
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

let mod: typeof import('../backfill-performer-mbids');

before(async () => {
  mod = await import('../backfill-performer-mbids');
});

describe('runBackfillPerformerMbids', () => {
  beforeEach(() => {
    reset();
  });

  it('returns zeros when no performers need backfill', async () => {
    reset({ candidates: [] });
    const result = await mod.runBackfillPerformerMbids();
    assert.deepEqual(result, { total: 0, updated: 0, missing: 0, skipped: 0, failed: 0 });
    assert.equal(SCRIPT.updates.length, 0);
  });

  it('writes the resolved MBID when setlist.fm returns a match', async () => {
    reset({
      candidates: [{ id: 'perf-1', name: 'The Last Dinner Party' }],
      searchResultsByName: new Map([
        ['The Last Dinner Party', [{ mbid: '2f0c90b1-84d5-47f1-ad75-ad8d30f53f70' }]],
      ]),
    });

    const result = await mod.runBackfillPerformerMbids();

    assert.equal(result.updated, 1);
    assert.equal(result.missing, 0);
    assert.equal(SCRIPT.updates.length, 1);
    assert.equal(SCRIPT.updates[0].id, 'perf-1');
    assert.equal(SCRIPT.updates[0].musicbrainzId, '2f0c90b1-84d5-47f1-ad75-ad8d30f53f70');
  });

  it('counts misses when setlist.fm returns no artists', async () => {
    reset({
      candidates: [{ id: 'perf-ghost', name: 'Ghost Local Opener' }],
      searchResultsByName: new Map([['Ghost Local Opener', []]]),
    });

    const result = await mod.runBackfillPerformerMbids();

    assert.equal(result.updated, 0);
    assert.equal(result.missing, 1);
    assert.equal(SCRIPT.updates.length, 0);
  });

  it('treats unique-violation on update as skipped, not failed', async () => {
    reset({
      candidates: [{ id: 'perf-dup', name: 'Phoebe Bridgers' }],
      searchResultsByName: new Map([
        ['Phoebe Bridgers', [{ mbid: 'mb-phoebe' }]],
      ]),
      conflictMbids: new Set(['mb-phoebe']),
    });

    const result = await mod.runBackfillPerformerMbids();

    assert.equal(result.updated, 0);
    assert.equal(result.missing, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.failed, 0);
    assert.equal(SCRIPT.updates.length, 0);
  });

  it('counts non-unique-violation update errors as failed', async () => {
    reset({
      candidates: [{ id: 'perf-err', name: 'Some Artist' }],
      searchErrorsByName: new Map([
        ['Some Artist', new Error('setlist.fm 500')],
      ]),
    });

    const result = await mod.runBackfillPerformerMbids();

    assert.equal(result.updated, 0);
    assert.equal(result.missing, 0);
    assert.equal(result.skipped, 0);
    assert.equal(result.failed, 1);
  });

  it('continues processing after a failure on one row', async () => {
    reset({
      candidates: [
        { id: 'perf-fail', name: 'Bad Search' },
        { id: 'perf-ok', name: 'Good Search' },
      ],
      searchErrorsByName: new Map([
        ['Bad Search', new Error('setlist.fm 500')],
      ]),
      searchResultsByName: new Map([
        ['Good Search', [{ mbid: 'mb-good' }]],
      ]),
    });

    const result = await mod.runBackfillPerformerMbids();

    assert.equal(result.total, 2);
    assert.equal(result.updated, 1);
    assert.equal(result.failed, 1);
    assert.equal(SCRIPT.updates.length, 1);
    assert.equal(SCRIPT.updates[0].id, 'perf-ok');
  });
});
