/**
 * matchOrCreatePerformer end-to-end tests with @showbook/db mocked.
 * Covers the TM-id match path, MBID match path, name match path, and
 * the create+lock path. These run without DB by feeding a queue of
 * scripted select/insert results to a fake `db`.
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as realDb from '@showbook/db';

interface Script {
  selectResults: unknown[][];
  insertResults: unknown[][];
  updateResults: unknown[][];
  insertCount: number;
  insertThrows: unknown | null;
}
const SCRIPT: Script = {
  selectResults: [],
  insertResults: [],
  updateResults: [],
  insertCount: 0,
  insertThrows: null,
};
function reset(opts: Partial<Script> = {}) {
  SCRIPT.selectResults = opts.selectResults ?? [];
  SCRIPT.insertResults = opts.insertResults ?? [];
  SCRIPT.updateResults = opts.updateResults ?? [];
  SCRIPT.insertCount = 0;
  SCRIPT.insertThrows = opts.insertThrows ?? null;
}
function mkChain(getResult: () => unknown) {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') {
        try {
          const value = getResult();
          return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(value).then(resolve, reject);
        } catch (err) {
          return (
            _resolve: (v: unknown) => unknown,
            reject?: (e: unknown) => unknown,
          ) => Promise.reject(err).catch((e) => (reject ? reject(e) : Promise.reject(e)));
        }
      }
      return () => proxy;
    },
  };
  const proxy: object = new Proxy({}, handler);
  return proxy;
}

const fakeDb = {
  select: () => mkChain(() => SCRIPT.selectResults.shift() ?? []),
  insert: () => mkChain(() => {
    SCRIPT.insertCount += 1;
    if (SCRIPT.insertThrows) throw SCRIPT.insertThrows;
    return SCRIPT.insertResults.shift() ?? [];
  }),
  update: () => mkChain(() => SCRIPT.updateResults.shift() ?? []),
  transaction: async (fn: (tx: unknown) => unknown) => fn(fakeDb),
  execute: async () => undefined,
};

mock.module('@showbook/db', {
  namedExports: {
    ...realDb,
    db: fakeDb,
  },
});

let mod: typeof import('../performer-matcher');

before(async () => {
  mod = await import('../performer-matcher');
});

beforeEach(() => reset());

describe('matchOrCreatePerformer (mocked db)', () => {
  it('returns existing on TM attraction id match', async () => {
    const existing = {
      id: 'p1',
      name: 'Phoebe',
      ticketmasterAttractionId: 'tm-1',
      musicbrainzId: null,
      imageUrl: null,
    };
    reset({ selectResults: [[existing]] });
    const result = await mod.matchOrCreatePerformer({
      name: 'Phoebe',
      tmAttractionId: 'tm-1',
    });
    assert.equal(result.created, false);
    assert.equal(result.performer.id, 'p1');
  });

  it('returns existing on MBID match (and updates with TM id when new)', async () => {
    const existing = {
      id: 'p2',
      name: 'Phoebe',
      ticketmasterAttractionId: null,
      musicbrainzId: 'mbid-1',
      imageUrl: null,
    };
    const updated = { ...existing, ticketmasterAttractionId: 'tm-2' };
    reset({
      selectResults: [
        [], // TM lookup miss
        [existing], // MBID match
      ],
      updateResults: [[updated]],
    });
    const result = await mod.matchOrCreatePerformer({
      name: 'Phoebe',
      tmAttractionId: 'tm-2',
      musicbrainzId: 'mbid-1',
    });
    assert.equal(result.created, false);
    assert.equal(result.performer.ticketmasterAttractionId, 'tm-2');
  });

  it('returns existing on case-insensitive name match', async () => {
    const existing = {
      id: 'p3',
      name: 'Phoebe Bridgers',
      ticketmasterAttractionId: null,
      musicbrainzId: null,
      imageUrl: null,
    };
    reset({
      selectResults: [
        // No TM/MBID provided so those branches skip.
        [existing], // name match inside transaction
      ],
    });
    const result = await mod.matchOrCreatePerformer({
      name: 'phoebe bridgers',
    });
    assert.equal(result.created, false);
  });

  it('creates a new performer when no match exists', async () => {
    const created = {
      id: 'p-new',
      name: 'NewArtist',
      ticketmasterAttractionId: null,
      musicbrainzId: null,
      imageUrl: null,
    };
    reset({
      selectResults: [
        [], // name match miss inside transaction
      ],
      insertResults: [[created]],
    });
    const result = await mod.matchOrCreatePerformer({ name: 'NewArtist' });
    assert.equal(result.created, true);
    assert.equal(result.performer.id, 'p-new');
  });

  it('recovers from a unique-violation race via TM-id re-select', async () => {
    const existing = {
      id: 'p-race',
      name: 'Race',
      ticketmasterAttractionId: 'tm-race',
      musicbrainzId: null,
      imageUrl: null,
    };
    const violation = { code: '23505' };
    reset({
      selectResults: [
        [], // TM lookup miss
        [], // name match miss
        [existing], // TM re-select after unique violation
      ],
      insertThrows: violation,
    });
    const result = await mod.matchOrCreatePerformer({
      name: 'Race',
      tmAttractionId: 'tm-race',
    });
    assert.equal(result.created, false);
    assert.equal(result.performer.id, 'p-race');
  });
});
