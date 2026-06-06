/**
 * Unit tests for resolvePerformerWikidataId. Wikidata search is mocked at
 * the `./wikidata` boundary and the DB is a minimal drizzle-shaped fake.
 * Mirrors resolve-performer-spotify-id's coverage of the race-guard
 * outcomes plus the QID-vs-MBID unique-violation isolation.
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

interface WikidataPerson {
  wikidataQid: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  musicbrainzId: string | null;
}

interface Script {
  people: WikidataPerson[];
  searchThrows: Error | null;
  // 'qid' → both writes throw (another row owns the QID).
  // 'mbid' → only the write that includes musicbrainzId throws.
  conflict: 'none' | 'qid' | 'mbid';
  raceLoss: boolean;
  setsSeen: Array<Record<string, unknown>>;
}

const SCRIPT: Script = {
  people: [],
  searchThrows: null,
  conflict: 'none',
  raceLoss: false,
  setsSeen: [],
};

function reset(opts: Partial<Script> = {}) {
  SCRIPT.people = opts.people ?? [];
  SCRIPT.searchThrows = opts.searchThrows ?? null;
  SCRIPT.conflict = opts.conflict ?? 'none';
  SCRIPT.raceLoss = opts.raceLoss ?? false;
  SCRIPT.setsSeen = [];
}

function uniqueErr() {
  const cause = Object.assign(
    new Error('duplicate key value violates unique constraint'),
    { code: '23505' },
  );
  return Object.assign(new Error('drizzle: update failed'), { cause });
}

const fakeDb = {
  update: () => ({
    set: (vals: Record<string, unknown>) => ({
      where: () => ({
        returning: () => {
          SCRIPT.setsSeen.push(vals);
          const hasMbid = 'musicbrainzId' in vals;
          if (SCRIPT.conflict === 'qid') return Promise.reject(uniqueErr());
          if (SCRIPT.conflict === 'mbid' && hasMbid)
            return Promise.reject(uniqueErr());
          if (SCRIPT.raceLoss) return Promise.resolve([]);
          return Promise.resolve([{ id: 'perf-1' }]);
        },
      }),
    }),
  }),
};

mock.module('@showbook/db', {
  namedExports: {
    db: fakeDb,
    performers: {
      id: 'performers.id',
      imageUrl: 'performers.image_url',
      musicbrainzId: 'performers.musicbrainz_id',
      wikidataQid: 'performers.wikidata_qid',
    },
  },
});

mock.module('../wikidata', {
  namedExports: {
    searchWikidataPeople: async (_q: string) => {
      if (SCRIPT.searchThrows) throw SCRIPT.searchThrows;
      return SCRIPT.people;
    },
  },
});

mock.module('../venue-matcher', {
  namedExports: {
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
  },
});

const person = (over: Partial<WikidataPerson> = {}): WikidataPerson => ({
  wikidataQid: 'Q40281836',
  name: 'Cole Escola',
  description: 'American actor',
  imageUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Cole.png?width=600',
  musicbrainzId: null,
  ...over,
});

let mod: typeof import('../resolve-performer-wikidata-id');

before(async () => {
  delete process.env.WIKIDATA_ENRICHMENT_DISABLED;
  mod = await import('../resolve-performer-wikidata-id');
});

describe('resolvePerformerWikidataId', () => {
  beforeEach(() => {
    reset();
    delete process.env.WIKIDATA_ENRICHMENT_DISABLED;
  });

  it('skips with failed when enrichment is disabled', async () => {
    process.env.WIKIDATA_ENRICHMENT_DISABLED = '1';
    reset({ people: [person()] });
    const out = await mod.resolvePerformerWikidataId('perf-1', 'Cole Escola');
    assert.equal(out.kind, 'failed');
    assert.equal(SCRIPT.setsSeen.length, 0);
  });

  it('returns failed when the search throws', async () => {
    reset({ searchThrows: new Error('wikidata 500') });
    const out = await mod.resolvePerformerWikidataId('perf-1', 'Cole Escola');
    assert.equal(out.kind, 'failed');
  });

  it('returns no_match when no result label matches the name exactly', async () => {
    reset({ people: [person({ name: 'Cole Escovedo' })] });
    const out = await mod.resolvePerformerWikidataId('perf-1', 'Cole Escola');
    assert.equal(out.kind, 'no_match');
  });

  it('updates QID and fills image + mbid on an exact match', async () => {
    reset({ people: [person({ musicbrainzId: 'mb-cole' })] });
    const out = await mod.resolvePerformerWikidataId('perf-1', 'Cole Escola');
    assert.equal(out.kind, 'updated');
    assert.equal(SCRIPT.setsSeen.length, 1);
    const set = SCRIPT.setsSeen[0];
    assert.equal(set.wikidataQid, 'Q40281836');
    assert.ok('imageUrl' in set);
    assert.ok('musicbrainzId' in set);
  });

  it('treats a race-lost UPDATE as skipped row_already_filled', async () => {
    reset({ people: [person()], raceLoss: true });
    const out = await mod.resolvePerformerWikidataId('perf-1', 'Cole Escola');
    assert.deepEqual(out, { kind: 'skipped', reason: 'row_already_filled' });
  });

  it('treats a QID owned by another row as skipped other_row_owns_id', async () => {
    reset({ people: [person()], conflict: 'qid' });
    const out = await mod.resolvePerformerWikidataId('perf-1', 'Cole Escola');
    assert.deepEqual(out, { kind: 'skipped', reason: 'other_row_owns_id' });
  });

  it('retries without the MBID when only the MBID collides, still updating', async () => {
    reset({ people: [person({ musicbrainzId: 'mb-taken' })], conflict: 'mbid' });
    const out = await mod.resolvePerformerWikidataId('perf-1', 'Cole Escola');
    assert.equal(out.kind, 'updated');
    // Two writes: first with mbid (throws), retry without mbid (succeeds).
    assert.equal(SCRIPT.setsSeen.length, 2);
    assert.ok('musicbrainzId' in SCRIPT.setsSeen[0]);
    assert.equal('musicbrainzId' in SCRIPT.setsSeen[1], false);
  });
});
