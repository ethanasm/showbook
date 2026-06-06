/**
 * Unit tests for runBackfillPerformerWikidataIds. The resolver is mocked
 * at the `@showbook/api` boundary (it owns the DB writes + race guards,
 * tested separately) and the candidate query is a minimal drizzle-shaped
 * fake — same pattern as backfill-performer-mbids.test.ts.
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

interface Outcome {
  kind: 'updated' | 'no_match' | 'skipped' | 'failed';
}

interface Script {
  candidates: Array<{ id: string; name: string }>;
  outcomesByName: Map<string, Outcome>;
  calls: Array<{ id: string; name: string }>;
}

const SCRIPT: Script = {
  candidates: [],
  outcomesByName: new Map(),
  calls: [],
};

function reset(opts: Partial<Script> = {}) {
  SCRIPT.candidates = opts.candidates ?? [];
  SCRIPT.outcomesByName = opts.outcomesByName ?? new Map();
  SCRIPT.calls = [];
}

const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        orderBy: () => Promise.resolve(SCRIPT.candidates),
      }),
    }),
  }),
};

mock.module('@showbook/db', {
  namedExports: {
    db: fakeDb,
    performers: {
      id: 'performers.id',
      name: 'performers.name',
      wikidataQid: 'performers.wikidata_qid',
      ticketmasterAttractionId: 'performers.ticketmaster_attraction_id',
      createdAt: 'performers.created_at',
    },
  },
});

mock.module('@showbook/api', {
  namedExports: {
    resolvePerformerWikidataId: async (id: string, name: string) => {
      SCRIPT.calls.push({ id, name });
      return SCRIPT.outcomesByName.get(name) ?? { kind: 'no_match' };
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

let mod: typeof import('../backfill-performer-wikidata-ids');

before(async () => {
  mod = await import('../backfill-performer-wikidata-ids');
});

describe('runBackfillPerformerWikidataIds', () => {
  beforeEach(() => reset());

  it('returns zeros when no performers need backfill', async () => {
    reset({ candidates: [] });
    const result = await mod.runBackfillPerformerWikidataIds();
    assert.deepEqual(result, {
      total: 0,
      updated: 0,
      missing: 0,
      skipped: 0,
      failed: 0,
    });
    assert.equal(SCRIPT.calls.length, 0);
  });

  it('tallies each resolver outcome kind', async () => {
    reset({
      candidates: [
        { id: 'p1', name: 'Updated One' },
        { id: 'p2', name: 'No Match' },
        { id: 'p3', name: 'Skipped' },
        { id: 'p4', name: 'Failed' },
      ],
      outcomesByName: new Map([
        ['Updated One', { kind: 'updated' }],
        ['No Match', { kind: 'no_match' }],
        ['Skipped', { kind: 'skipped' }],
        ['Failed', { kind: 'failed' }],
      ]),
    });

    const result = await mod.runBackfillPerformerWikidataIds();

    assert.deepEqual(result, {
      total: 4,
      updated: 1,
      missing: 1,
      skipped: 1,
      failed: 1,
    });
    assert.equal(SCRIPT.calls.length, 4);
    assert.deepEqual(SCRIPT.calls[0], { id: 'p1', name: 'Updated One' });
  });
});
