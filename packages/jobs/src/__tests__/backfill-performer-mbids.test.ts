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
  // Performer ids for which the row-state race guard should fail (the
  // UPDATE returns no rows because the WHERE clause's
  // `isNull(musicbrainz_id)` predicate evaluates false).
  raceLossPerformerIds: Set<string>;
  updates: Array<{ id: string; musicbrainzId: string }>;
}

const SCRIPT: Script = {
  candidates: [],
  searchResultsByName: new Map(),
  searchErrorsByName: new Map(),
  conflictMbids: new Set(),
  raceLossPerformerIds: new Set(),
  updates: [],
};

function reset(opts: Partial<Script> = {}) {
  SCRIPT.candidates = opts.candidates ?? [];
  SCRIPT.searchResultsByName = opts.searchResultsByName ?? new Map();
  SCRIPT.searchErrorsByName = opts.searchErrorsByName ?? new Map();
  SCRIPT.conflictMbids = opts.conflictMbids ?? new Set();
  SCRIPT.raceLossPerformerIds = opts.raceLossPerformerIds ?? new Set();
  SCRIPT.updates = [];
}

// Walk the drizzle predicate object recursively for any string that
// matches a known performer id. The MBID job now wraps the WHERE in
// `and(eq(id, x), isNull(musicbrainz_id))`, so the previous
// `queryChunks[3]` extraction no longer holds.
function findKnownId(predicate: unknown): string | undefined {
  const known = new Set(SCRIPT.candidates.map((c) => c.id));
  function walk(node: unknown): string | undefined {
    if (typeof node === 'string' && known.has(node)) return node;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item);
        if (found) return found;
      }
      return undefined;
    }
    if (node && typeof node === 'object') {
      for (const v of Object.values(node)) {
        const found = walk(v);
        if (found) return found;
      }
    }
    return undefined;
  }
  return walk(predicate);
}

const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => Promise.resolve(SCRIPT.candidates),
    }),
  }),
  update: (_table: unknown) => ({
    set: (vals: { musicbrainzId?: string }) => {
      const builder = {
        _id: 'unknown' as string,
        _vals: vals,
        where(predicate: unknown) {
          this._id = findKnownId(predicate) ?? 'unknown';
          // Match what drizzle-orm wrapping looks like: outer
          // DrizzleQueryError with a `.cause` that carries SQLSTATE 23505.
          const mbid = this._vals.musicbrainzId ?? '';
          if (SCRIPT.conflictMbids.has(mbid)) {
            const cause = Object.assign(
              new Error('duplicate key value violates unique constraint'),
              { code: '23505' },
            );
            const err = Object.assign(new Error('drizzle: insert failed'), {
              cause,
            });
            return Promise.reject(err);
          }
          // Default (no .returning chain): just commit and resolve.
          SCRIPT.updates.push({ id: this._id, musicbrainzId: mbid });
          return Promise.resolve(undefined);
        },
      };
      // Drizzle's `.where(...).returning(...)` chain. The MBID job now
      // calls `.returning({ id: performers.id })` so the row-state race
      // guard can tell apart "wrote one row" from "WHERE matched nothing".
      return {
        where(predicate: unknown) {
          builder._id = findKnownId(predicate) ?? 'unknown';
          const mbid = builder._vals.musicbrainzId ?? '';
          if (SCRIPT.conflictMbids.has(mbid)) {
            return {
              returning: () => {
                const cause = Object.assign(
                  new Error('duplicate key value violates unique constraint'),
                  { code: '23505' },
                );
                const err = Object.assign(new Error('drizzle: insert failed'), {
                  cause,
                });
                return Promise.reject(err);
              },
            };
          }
          if (SCRIPT.raceLossPerformerIds.has(builder._id)) {
            return { returning: () => Promise.resolve([]) };
          }
          SCRIPT.updates.push({ id: builder._id, musicbrainzId: mbid });
          return {
            returning: () => Promise.resolve([{ id: builder._id }]),
          };
        },
      };
    },
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

  it('treats a race-lost UPDATE (row filled between SELECT and UPDATE) as skipped, not updated', async () => {
    reset({
      candidates: [{ id: 'perf-raced', name: 'Boygenius' }],
      searchResultsByName: new Map([
        ['Boygenius', [{ mbid: 'mb-boygenius' }]],
      ]),
      raceLossPerformerIds: new Set(['perf-raced']),
    });

    const result = await mod.runBackfillPerformerMbids();

    assert.equal(result.updated, 0);
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
