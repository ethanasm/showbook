/**
 * Unit tests for the Wikidata client. `globalThis.fetch` is stubbed and
 * routed by the `action=` query param so search + entity-claims calls can
 * be scripted independently. Covers the human filter, P18 image URL
 * construction, P434 MBID extraction, transient-retry, and error → [].
 */

import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

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

let searchWikidataPeople: typeof import('../wikidata').searchWikidataPeople;
let resolveWikidataEntity: typeof import('../wikidata').resolveWikidataEntity;
let commonsFilePathUrl: typeof import('../wikidata').commonsFilePathUrl;

before(async () => {
  const mod = await import('../wikidata');
  searchWikidataPeople = mod.searchWikidataPeople;
  resolveWikidataEntity = mod.resolveWikidataEntity;
  commonsFilePathUrl = mod.commonsFilePathUrl;
});

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

const ORIGINAL_FETCH = globalThis.fetch;

interface Routes {
  search?: (url: string) => Response;
  entities?: (url: string) => Response;
}

let routes: Routes = {};

function installFetch(r: Routes) {
  routes = r;
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.includes('wbsearchentities')) {
      if (!routes.search) throw new Error('unexpected search call');
      return routes.search(url);
    }
    if (url.includes('wbgetentities')) {
      if (!routes.entities) throw new Error('unexpected entities call');
      return routes.entities(url);
    }
    throw new Error(`unrouted url ${url}`);
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('commonsFilePathUrl', () => {
  it('builds a Special:FilePath URL with underscores + width', () => {
    assert.equal(
      commonsFilePathUrl('Cole Escola 2025.png', 400),
      'https://commons.wikimedia.org/wiki/Special:FilePath/Cole_Escola_2025.png?width=400',
    );
  });
});

describe('searchWikidataPeople', () => {
  beforeEach(() => {
    routes = {};
  });

  it('returns humans only, enriched with image + mbid + description', async () => {
    installFetch({
      search: () =>
        jsonResponse({
          search: [
            { id: 'Q1', label: 'Cole Escola', description: 'American actor' },
            { id: 'Q2', label: 'Some Film', description: '2024 film' },
          ],
        }),
      entities: () =>
        jsonResponse({
          entities: {
            Q1: {
              claims: {
                P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }],
                P18: [{ mainsnak: { datavalue: { value: 'Cole.png' } } }],
                P434: [{ mainsnak: { datavalue: { value: 'mb-cole' } } }],
              },
            },
            Q2: {
              claims: {
                P31: [{ mainsnak: { datavalue: { value: { id: 'Q11424' } } } }],
              },
            },
          },
        }),
    });

    const people = await searchWikidataPeople('Cole Escola');
    assert.equal(people.length, 1);
    assert.deepEqual(people[0], {
      wikidataQid: 'Q1',
      name: 'Cole Escola',
      description: 'American actor',
      imageUrl:
        'https://commons.wikimedia.org/wiki/Special:FilePath/Cole.png?width=600',
      musicbrainzId: 'mb-cole',
    });
  });

  it('returns [] on an empty query without calling fetch', async () => {
    const people = await searchWikidataPeople('   ');
    assert.deepEqual(people, []);
  });

  it('returns [] when search responds non-OK', async () => {
    installFetch({ search: () => jsonResponse({}, false, 500) });
    const people = await searchWikidataPeople('x');
    assert.deepEqual(people, []);
  });

  it('returns [] when search finds nothing', async () => {
    installFetch({ search: () => jsonResponse({ search: [] }) });
    const people = await searchWikidataPeople('nobody');
    assert.deepEqual(people, []);
  });
});

describe('resolveWikidataEntity', () => {
  beforeEach(() => {
    routes = {};
  });

  it('extracts image + mbid for a QID', async () => {
    installFetch({
      entities: () =>
        jsonResponse({
          entities: {
            Q9: {
              claims: {
                P18: [{ mainsnak: { datavalue: { value: 'Pic.jpg' } } }],
                P434: [{ mainsnak: { datavalue: { value: 'mb-9' } } }],
              },
            },
          },
        }),
    });
    const data = await resolveWikidataEntity('Q9');
    assert.equal(
      data.imageUrl,
      'https://commons.wikimedia.org/wiki/Special:FilePath/Pic.jpg?width=600',
    );
    assert.equal(data.musicbrainzId, 'mb-9');
  });

  it('retries once on a transient fetch failure then succeeds', async () => {
    let calls = 0;
    routes = {};
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return jsonResponse({
        entities: { Q9: { claims: {} } },
      });
    }) as unknown as typeof fetch;

    const data = await resolveWikidataEntity('Q9');
    assert.equal(calls, 2);
    assert.deepEqual(data, { imageUrl: null, musicbrainzId: null });
  });

  it('returns nulls when the entity is missing', async () => {
    installFetch({ entities: () => jsonResponse({ entities: {} }) });
    const data = await resolveWikidataEntity('Q404');
    assert.deepEqual(data, { imageUrl: null, musicbrainzId: null });
  });
});
