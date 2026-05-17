/**
 * Unit tests for runBackfillPerformerTicketmasterIds. TM Discovery is
 * mocked at the `@showbook/api` boundary (searchAttractions +
 * extractMusicbrainzId + isUniqueViolation). DB is a minimal drizzle-
 * shaped fake — same pattern as backfill-performer-mbids.test.ts.
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

interface AttractionFixture {
  id: string;
  name: string;
  mbid?: string;
}

interface PerformerCandidate {
  id: string;
  name: string;
  musicbrainzId: string | null;
}

interface SetCall {
  performerId: string;
  values: Record<string, unknown>;
}

interface Script {
  candidates: PerformerCandidate[];
  searchResultsByName: Map<string, AttractionFixture[]>;
  searchErrorsByName: Map<string, Error>;
  // Performer ids whose TM-id UPDATE should raise a unique-violation
  // (another performer row already owns the TM id).
  tmIdConflictPerformerIds: Set<string>;
  // Performer ids whose MBID UPDATE should raise a unique-violation
  // (another performer row already owns the MBID).
  mbidConflictPerformerIds: Set<string>;
  // Performer ids for which the TM-id race guard should fail (UPDATE
  // returns no rows because WHERE matched nothing — i.e. the row was
  // already filled by a concurrent writer).
  tmIdRaceLossPerformerIds: Set<string>;
  // Captured `.set(...)` payloads for assertions.
  setCalls: SetCall[];
}

const SCRIPT: Script = {
  candidates: [],
  searchResultsByName: new Map(),
  searchErrorsByName: new Map(),
  tmIdConflictPerformerIds: new Set(),
  mbidConflictPerformerIds: new Set(),
  tmIdRaceLossPerformerIds: new Set(),
  setCalls: [],
};

function reset(opts: Partial<Script> = {}) {
  SCRIPT.candidates = opts.candidates ?? [];
  SCRIPT.searchResultsByName = opts.searchResultsByName ?? new Map();
  SCRIPT.searchErrorsByName = opts.searchErrorsByName ?? new Map();
  SCRIPT.tmIdConflictPerformerIds = opts.tmIdConflictPerformerIds ?? new Set();
  SCRIPT.mbidConflictPerformerIds = opts.mbidConflictPerformerIds ?? new Set();
  SCRIPT.tmIdRaceLossPerformerIds = opts.tmIdRaceLossPerformerIds ?? new Set();
  SCRIPT.setCalls = [];
}

// Drizzle WHERE-predicate walker that pulls the matching candidate id
// out of any nesting level — the job's WHERE wraps `eq(id, x)` in
// `and(eq(id, x), isNull(col))`.
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

function makeUniqueViolation(): Error {
  const cause = Object.assign(
    new Error('duplicate key value violates unique constraint'),
    { code: '23505' },
  );
  return Object.assign(new Error('drizzle: update failed'), { cause });
}

const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => Promise.resolve(SCRIPT.candidates),
    }),
  }),
  update: (_table: unknown) => ({
    set: (values: Record<string, unknown>) => {
      // Detect whether the call site uses `.returning(...)` (TM-id
      // write, race-guarded) vs the plain MBID side-effect UPDATE
      // (no `.returning`). Both share the same `.where(...)` step.
      const builder = {
        _id: 'unknown' as string,
        where(predicate: unknown) {
          this._id = findKnownId(predicate) ?? 'unknown';

          const isTmIdWrite =
            Object.prototype.hasOwnProperty.call(values, 'ticketmasterAttractionId');
          const isMbidWrite =
            Object.prototype.hasOwnProperty.call(values, 'musicbrainzId');

          if (isTmIdWrite && SCRIPT.tmIdConflictPerformerIds.has(this._id)) {
            // TM-id unique violation surfaces via the `.returning` chain.
            return {
              returning: () => Promise.reject(makeUniqueViolation()),
            };
          }
          if (isTmIdWrite && SCRIPT.tmIdRaceLossPerformerIds.has(this._id)) {
            // Row already filled between SELECT and UPDATE — WHERE
            // matched nothing, RETURNING yields the empty array.
            return { returning: () => Promise.resolve([]) };
          }
          if (
            isMbidWrite &&
            !isTmIdWrite &&
            SCRIPT.mbidConflictPerformerIds.has(this._id)
          ) {
            // MBID side-effect UPDATE has no .returning chain — the
            // promise itself rejects.
            return Promise.reject(makeUniqueViolation());
          }

          SCRIPT.setCalls.push({ performerId: this._id, values: { ...values } });
          return {
            returning: () => Promise.resolve([{ id: this._id }]),
            then: (resolve: (v: unknown) => unknown) => resolve(undefined),
          };
        },
      };
      return builder;
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
      ticketmasterAttractionId: 'performers.ticketmaster_attraction_id',
    },
  },
});

mock.module('@showbook/api', {
  namedExports: {
    searchAttractions: async (name: string) => {
      const err = SCRIPT.searchErrorsByName.get(name);
      if (err) throw err;
      const fixtures = SCRIPT.searchResultsByName.get(name) ?? [];
      // Shape each fixture into the bits of TMAttraction the job uses.
      return fixtures.map((f) => ({
        id: f.id,
        name: f.name,
        externalLinks: f.mbid
          ? { musicbrainz: [{ id: f.mbid }] }
          : undefined,
      }));
    },
    extractMusicbrainzId: (
      attraction: { externalLinks?: { musicbrainz?: Array<{ id: string }> } },
    ): string | undefined =>
      attraction.externalLinks?.musicbrainz?.[0]?.id,
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

let mod: typeof import('../backfill-performer-ticketmaster-ids');

before(async () => {
  mod = await import('../backfill-performer-ticketmaster-ids');
});

describe('runBackfillPerformerTicketmasterIds', () => {
  beforeEach(() => {
    reset();
  });

  it('returns zeros when no performers need backfill', async () => {
    reset({ candidates: [] });
    const result = await mod.runBackfillPerformerTicketmasterIds();
    assert.deepEqual(result, {
      total: 0,
      updated: 0,
      missing: 0,
      skipped: 0,
      failed: 0,
    });
    assert.equal(SCRIPT.setCalls.length, 0);
  });

  it('writes TM id only when the row already has an MBID', async () => {
    reset({
      candidates: [
        { id: 'perf-tdp', name: 'The Last Dinner Party', musicbrainzId: 'mb-existing' },
      ],
      searchResultsByName: new Map([
        [
          'The Last Dinner Party',
          [{ id: 'K8vZ9171Cof', name: 'The Last Dinner Party', mbid: 'mb-from-tm' }],
        ],
      ]),
    });

    const result = await mod.runBackfillPerformerTicketmasterIds();

    assert.equal(result.updated, 1);
    assert.equal(result.missing, 0);
    assert.equal(SCRIPT.setCalls.length, 1);
    assert.deepEqual(SCRIPT.setCalls[0], {
      performerId: 'perf-tdp',
      values: { ticketmasterAttractionId: 'K8vZ9171Cof' },
    });
  });

  it('writes both TM id and MBID when the row had no MBID and TM exposes one', async () => {
    reset({
      candidates: [
        { id: 'perf-bg', name: 'Boygenius', musicbrainzId: null },
      ],
      searchResultsByName: new Map([
        [
          'Boygenius',
          [{ id: 'K8vZ9176H67', name: 'Boygenius', mbid: 'mb-boygenius' }],
        ],
      ]),
    });

    const result = await mod.runBackfillPerformerTicketmasterIds();

    assert.equal(result.updated, 1);
    assert.equal(SCRIPT.setCalls.length, 2);
    assert.deepEqual(SCRIPT.setCalls[0], {
      performerId: 'perf-bg',
      values: { ticketmasterAttractionId: 'K8vZ9176H67' },
    });
    assert.deepEqual(SCRIPT.setCalls[1], {
      performerId: 'perf-bg',
      values: { musicbrainzId: 'mb-boygenius' },
    });
  });

  it('never includes musicbrainzId in the .set() payload when TM has no MBID', async () => {
    reset({
      candidates: [
        { id: 'perf-no-mbid', name: 'Phoebe Bridgers', musicbrainzId: null },
      ],
      searchResultsByName: new Map([
        [
          'Phoebe Bridgers',
          [{ id: 'K8vZ9171Coa', name: 'Phoebe Bridgers' /* no mbid */ }],
        ],
      ]),
    });

    const result = await mod.runBackfillPerformerTicketmasterIds();

    assert.equal(result.updated, 1);
    assert.equal(SCRIPT.setCalls.length, 1);
    assert.equal('musicbrainzId' in SCRIPT.setCalls[0].values, false);
    assert.deepEqual(SCRIPT.setCalls[0].values, {
      ticketmasterAttractionId: 'K8vZ9171Coa',
    });
  });

  it('matches case-insensitively via normalizeName', async () => {
    reset({
      candidates: [
        { id: 'perf-pb', name: 'phoebe bridgers', musicbrainzId: null },
      ],
      searchResultsByName: new Map([
        [
          'phoebe bridgers',
          [{ id: 'K8vZ9171Coa', name: 'Phoebe Bridgers' }],
        ],
      ]),
    });

    const result = await mod.runBackfillPerformerTicketmasterIds();

    assert.equal(result.updated, 1);
    assert.equal(SCRIPT.setCalls[0].values.ticketmasterAttractionId, 'K8vZ9171Coa');
  });

  it('counts misses when TM returns no exact name match', async () => {
    reset({
      candidates: [
        { id: 'perf-ghost', name: 'Ghost Local Opener', musicbrainzId: null },
      ],
      searchResultsByName: new Map([
        [
          'Ghost Local Opener',
          [{ id: 'K-other', name: 'Some Other Band' }],
        ],
      ]),
    });

    const result = await mod.runBackfillPerformerTicketmasterIds();

    assert.equal(result.updated, 0);
    assert.equal(result.missing, 1);
    assert.equal(SCRIPT.setCalls.length, 0);
  });

  it('treats a TM-id unique-violation as skipped (other_row_owns_id)', async () => {
    reset({
      candidates: [
        { id: 'perf-dup', name: 'Duplicate Artist', musicbrainzId: null },
      ],
      searchResultsByName: new Map([
        [
          'Duplicate Artist',
          [{ id: 'K-dup', name: 'Duplicate Artist' }],
        ],
      ]),
      tmIdConflictPerformerIds: new Set(['perf-dup']),
    });

    const result = await mod.runBackfillPerformerTicketmasterIds();

    assert.equal(result.updated, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.failed, 0);
    assert.equal(SCRIPT.setCalls.length, 0);
  });

  it('treats a race-lost TM-id UPDATE (returning [] ) as skipped (row_already_filled)', async () => {
    reset({
      candidates: [
        { id: 'perf-raced', name: 'Some Artist', musicbrainzId: null },
      ],
      searchResultsByName: new Map([
        [
          'Some Artist',
          [{ id: 'K-raced', name: 'Some Artist', mbid: 'mb-raced' }],
        ],
      ]),
      tmIdRaceLossPerformerIds: new Set(['perf-raced']),
    });

    const result = await mod.runBackfillPerformerTicketmasterIds();

    assert.equal(result.updated, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.failed, 0);
    // The MBID side-effect path must be skipped entirely when the TM-id
    // write was a no-op.
    assert.equal(SCRIPT.setCalls.length, 0);
  });

  it('does NOT decrement the TM-id-updated count when the MBID side-effect fails', async () => {
    reset({
      candidates: [
        { id: 'perf-mbid-fail', name: 'Some Artist', musicbrainzId: null },
      ],
      searchResultsByName: new Map([
        [
          'Some Artist',
          [{ id: 'K-ok', name: 'Some Artist', mbid: 'mb-conflict' }],
        ],
      ]),
      mbidConflictPerformerIds: new Set(['perf-mbid-fail']),
    });

    const result = await mod.runBackfillPerformerTicketmasterIds();

    assert.equal(result.updated, 1);
    assert.equal(result.skipped, 0);
    assert.equal(result.failed, 0);
    // TM-id write recorded; MBID rejection swallowed without re-adding
    // to setCalls.
    assert.equal(SCRIPT.setCalls.length, 1);
    assert.deepEqual(SCRIPT.setCalls[0].values, {
      ticketmasterAttractionId: 'K-ok',
    });
  });

  it('counts non-unique-violation lookup errors as failed', async () => {
    reset({
      candidates: [
        { id: 'perf-err', name: 'Some Artist', musicbrainzId: null },
      ],
      searchErrorsByName: new Map([
        ['Some Artist', new Error('TM Discovery 500')],
      ]),
    });

    const result = await mod.runBackfillPerformerTicketmasterIds();

    assert.equal(result.updated, 0);
    assert.equal(result.failed, 1);
  });

  it('continues processing after a failure on one row', async () => {
    reset({
      candidates: [
        { id: 'perf-fail', name: 'Bad Search', musicbrainzId: null },
        { id: 'perf-ok', name: 'Good Search', musicbrainzId: 'mb-existing' },
      ],
      searchErrorsByName: new Map([
        ['Bad Search', new Error('TM Discovery 500')],
      ]),
      searchResultsByName: new Map([
        ['Good Search', [{ id: 'K-good', name: 'Good Search' }]],
      ]),
    });

    const result = await mod.runBackfillPerformerTicketmasterIds();

    assert.equal(result.total, 2);
    assert.equal(result.updated, 1);
    assert.equal(result.failed, 1);
    assert.equal(SCRIPT.setCalls.length, 1);
    assert.deepEqual(SCRIPT.setCalls[0], {
      performerId: 'perf-ok',
      values: { ticketmasterAttractionId: 'K-good' },
    });
  });
});
