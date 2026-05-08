/**
 * matchOrCreateVenue end-to-end tests with @showbook/db, geocode, and
 * ticketmaster mocked. Drives the TM id match, Place id match, name+city
 * match, and create-with-savepoint paths.
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as realDb from '@showbook/db';

interface Script {
  selectResults: unknown[][];
  insertResults: unknown[][];
  updateResults: unknown[][];
  insertThrows: unknown | null;
  geocode: ((name: string, city: string, stateRegion?: string | null) => Promise<unknown>) | null;
  searchVenues: ((params: unknown) => Promise<unknown[]>) | null;
}
const SCRIPT: Script = {
  selectResults: [],
  insertResults: [],
  updateResults: [],
  insertThrows: null,
  geocode: null,
  searchVenues: null,
};
function reset(opts: Partial<Script> = {}) {
  SCRIPT.selectResults = opts.selectResults ?? [];
  SCRIPT.insertResults = opts.insertResults ?? [];
  SCRIPT.updateResults = opts.updateResults ?? [];
  SCRIPT.insertThrows = opts.insertThrows ?? null;
  SCRIPT.geocode = opts.geocode ?? null;
  SCRIPT.searchVenues = opts.searchVenues ?? null;
}
function mkChain(getResult: () => unknown) {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') {
        try {
          const value = getResult();
          return (resolve: (v: unknown) => unknown) => Promise.resolve(value).then(resolve);
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
    if (SCRIPT.insertThrows) throw SCRIPT.insertThrows;
    return SCRIPT.insertResults.shift() ?? [];
  }),
  update: () => mkChain(() => SCRIPT.updateResults.shift() ?? []),
  transaction: async (fn: (tx: unknown) => unknown) => fn(fakeDb),
  execute: async () => undefined,
};

mock.module('@showbook/db', {
  namedExports: { ...realDb, db: fakeDb },
});

mock.module('../geocode.js', {
  namedExports: {
    geocodeVenue: async (name: string, city: string, stateRegion?: string | null) =>
      SCRIPT.geocode ? SCRIPT.geocode(name, city, stateRegion) : null,
  },
});

mock.module('../ticketmaster.js', {
  namedExports: {
    searchVenues: async (params: unknown) =>
      SCRIPT.searchVenues ? SCRIPT.searchVenues(params) : [],
  },
});

let mod: typeof import('../venue-matcher');

before(async () => {
  mod = await import('../venue-matcher');
});

beforeEach(() => reset());

describe('matchOrCreateVenue (mocked db)', () => {
  it('returns existing venue on TM venue id match', async () => {
    const existing = {
      id: 'v1',
      name: 'Greek',
      city: 'Berkeley',
      stateRegion: 'CA',
      country: 'US',
      ticketmasterVenueId: 'tm-v-1',
      googlePlaceId: null,
      photoUrl: null,
      latitude: 37.8,
      longitude: -122.2,
    };
    reset({ selectResults: [[existing]] });
    const result = await mod.matchOrCreateVenue({
      name: 'Greek',
      city: 'Berkeley',
      tmVenueId: 'tm-v-1',
    });
    assert.equal(result.created, false);
    assert.equal(result.venue.id, 'v1');
  });

  it('returns existing on Google Place ID match', async () => {
    const existing = {
      id: 'v2',
      name: 'Greek',
      city: 'Berkeley',
      stateRegion: null,
      country: 'US',
      ticketmasterVenueId: null,
      googlePlaceId: 'place-1',
      photoUrl: null,
      latitude: null,
      longitude: null,
    };
    reset({
      selectResults: [
        [existing], // TM lookup miss (no tmVenueId given) → falls into placeId branch
      ],
    });
    const result = await mod.matchOrCreateVenue({
      name: 'Greek',
      city: 'Berkeley',
      googlePlaceId: 'place-1',
    });
    assert.equal(result.created, false);
    assert.equal(result.venue.id, 'v2');
  });

  it('returns single name+city match', async () => {
    const existing = {
      id: 'v3',
      name: 'Greek',
      city: 'Berkeley',
      stateRegion: null,
      country: 'US',
      ticketmasterVenueId: null,
      googlePlaceId: null,
      photoUrl: null,
      latitude: 37,
      longitude: -122,
    };
    reset({
      selectResults: [[existing]],
    });
    const result = await mod.matchOrCreateVenue({
      name: 'Greek',
      city: 'Berkeley',
    });
    assert.equal(result.created, false);
  });

  it('returns first candidate + candidates list when name+city match is ambiguous', async () => {
    const a = { id: 'a', name: 'Greek', city: 'Berkeley', stateRegion: null, country: 'US', ticketmasterVenueId: null, googlePlaceId: null, photoUrl: null, latitude: null, longitude: null };
    const b = { ...a, id: 'b' };
    reset({ selectResults: [[a, b]] });
    const result = await mod.matchOrCreateVenue({
      name: 'Greek',
      city: 'Berkeley',
    });
    assert.equal(result.candidates?.length, 2);
    assert.equal(result.venue.id, 'a');
  });

  // Regression: TM splits "Orpheum Theatre" between a search-side id
  // (KovZpZAFaanA) and an event-side id with city-suffixed name "Orpheum
  // Theatre-San Francisco" (ZFr9jZedke). Without the normalized-name match
  // we'd create a duplicate venue and the announcements would land on it.
  it('matches an event-side "Name-City" against an existing "Name" via stripped match', async () => {
    const existing = {
      id: 'v-orpheum',
      name: 'Orpheum Theatre',
      city: 'San Francisco',
      stateRegion: 'California',
      country: 'US',
      ticketmasterVenueId: 'KovZpZAFaanA',
      googlePlaceId: null,
      photoUrl: null,
      latitude: 37.78,
      longitude: -122.4,
    };
    reset({
      selectResults: [
        [], // step 1: TM id match miss (event-side id ≠ stored id)
        [], // step 3: exact name+city miss
        [existing], // step 3b: stripped name match hits
      ],
    });
    const result = await mod.matchOrCreateVenue({
      name: 'Orpheum Theatre-San Francisco',
      city: 'San Francisco',
      tmVenueId: 'ZFr9jZedke',
    });
    assert.equal(result.created, false);
    assert.equal(result.venue.id, 'v-orpheum');
  });

  it('matches input "Name" against existing "Name-City" via reverse stripped match', async () => {
    const existing = {
      id: 'v-orpheum',
      name: 'Orpheum Theatre-San Francisco',
      city: 'San Francisco',
      stateRegion: 'California',
      country: 'US',
      ticketmasterVenueId: 'ZFr9jZedke',
      googlePlaceId: null,
      photoUrl: null,
      latitude: 37.78,
      longitude: -122.4,
    };
    reset({
      selectResults: [
        [], // step 3: exact name+city miss
        // step 3b skipped: input "Orpheum Theatre" has no city suffix to strip
        [existing], // step 3c: same-city scan finds the long-named row
      ],
    });
    const result = await mod.matchOrCreateVenue({
      name: 'Orpheum Theatre',
      city: 'San Francisco',
    });
    assert.equal(result.created, false);
    assert.equal(result.venue.id, 'v-orpheum');
  });

  it('creates a new venue when none exists', async () => {
    const created = {
      id: 'new',
      name: 'New Hall',
      city: 'NYC',
      stateRegion: null,
      country: 'US',
      ticketmasterVenueId: null,
      googlePlaceId: null,
      photoUrl: null,
      latitude: null,
      longitude: null,
    };
    reset({
      selectResults: [
        [], // name+city outside tx miss
        [], // recheck inside tx miss
      ],
      insertResults: [[created]],
    });
    const result = await mod.matchOrCreateVenue({
      name: 'New Hall',
      city: 'NYC',
      lat: 40,
      lng: -74,
    });
    assert.equal(result.created, true);
    assert.equal(result.venue.id, 'new');
  });

  it('uses Ticketmaster canonical name when input name is verbose', async () => {
    let insertedName: string | undefined;
    const fakeInsertingDb = {
      ...fakeDb,
      insert: () => {
        const proxy: any = new Proxy({}, {
          get(_t, prop) {
            if (prop === 'values') {
              return (vals: { name: string }) => {
                insertedName = vals.name;
                return proxy;
              };
            }
            if (prop === 'then') {
              return (resolve: (v: unknown) => unknown) =>
                Promise.resolve([{
                  id: 'v-tm', name: insertedName, city: 'New York',
                  stateRegion: 'NY', country: 'US',
                  ticketmasterVenueId: 'tm-canonical', googlePlaceId: null,
                  photoUrl: null, latitude: null, longitude: null,
                }]).then(resolve);
            }
            return () => proxy;
          },
        });
        return proxy;
      },
    };
    // Substitute the smarter db just for this test by re-mocking via the
    // existing transaction wrapper — since fakeDb.transaction passes itself
    // as `tx`, we briefly replace its insert.
    const origInsert = fakeDb.insert;
    (fakeDb as any).insert = fakeInsertingDb.insert;

    try {
      reset({
        selectResults: [
          [], // step 3 name+city miss
          [], // step 3b stripped name miss
          [], // step 3b reverse — same-city venues query
          [], // step 4 post-canonical name+city miss (after canonical resolved)
          [], // recheck inside tx miss
          [], // tm_id_mismatch same-city scan
        ],
        searchVenues: async () => [
          { id: 'tm-canonical', name: 'Beacon Theatre', city: { name: 'New York' } },
        ],
      });
      const result = await mod.matchOrCreateVenue({
        name: 'The Beacon Theatre @ Beacon Theater (NY)',
        city: 'New York',
      });
      assert.equal(result.created, true);
      assert.equal(insertedName, 'Beacon Theatre');
      assert.equal(result.venue.ticketmasterVenueId, 'tm-canonical');
    } finally {
      (fakeDb as any).insert = origInsert;
    }
  });

  it('falls back to Google Places name when TM has no match', async () => {
    let insertedName: string | undefined;
    const origInsert = fakeDb.insert;
    (fakeDb as any).insert = () => {
      const proxy: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === 'values') {
            return (vals: { name: string }) => {
              insertedName = vals.name;
              return proxy;
            };
          }
          if (prop === 'then') {
            return (resolve: (v: unknown) => unknown) =>
              Promise.resolve([{
                id: 'v-gp', name: insertedName, city: 'San Francisco',
                stateRegion: 'CA', country: 'US',
                ticketmasterVenueId: null, googlePlaceId: 'gp-1',
                photoUrl: null, latitude: 37.78, longitude: -122.43,
              }]).then(resolve);
          }
          return () => proxy;
        },
      });
      return proxy;
    };

    try {
      reset({
        selectResults: [
          [], // step 3 name+city miss
          [], // step 3b stripped miss
          [], // step 3b reverse
          [], // post-canonical name+city miss
          [], // recheck inside tx miss
        ],
        geocode: async () => ({
          name: 'The Fillmore',
          lat: 37.78,
          lng: -122.43,
          stateRegion: 'CA',
          country: 'US',
          googlePlaceId: 'gp-1',
        }),
        searchVenues: async () => [], // TM miss
      });
      const result = await mod.matchOrCreateVenue({
        name: 'The Fillmore Auditorium @ Fillmore SF',
        city: 'San Francisco',
      });
      assert.equal(result.created, true);
      assert.equal(insertedName, 'The Fillmore');
    } finally {
      (fakeDb as any).insert = origInsert;
    }
  });

  it('keeps input name when neither TM nor Google returns a canonical', async () => {
    let insertedName: string | undefined;
    const origInsert = fakeDb.insert;
    (fakeDb as any).insert = () => {
      const proxy: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === 'values') {
            return (vals: { name: string }) => {
              insertedName = vals.name;
              return proxy;
            };
          }
          if (prop === 'then') {
            return (resolve: (v: unknown) => unknown) =>
              Promise.resolve([{
                id: 'v-plain', name: insertedName, city: 'Nowhere',
                stateRegion: null, country: 'US',
                ticketmasterVenueId: null, googlePlaceId: null,
                photoUrl: null, latitude: null, longitude: null,
              }]).then(resolve);
          }
          return () => proxy;
        },
      });
      return proxy;
    };
    try {
      reset({
        selectResults: [[], [], []],
      });
      const result = await mod.matchOrCreateVenue({
        name: 'Some Verbose Gmail Name',
        city: 'Nowhere',
      });
      assert.equal(result.created, true);
      assert.equal(insertedName, 'Some Verbose Gmail Name');
    } finally {
      (fakeDb as any).insert = origInsert;
    }
  });
});

describe('venue-matcher helpers', () => {
  it('toStateCode handles 2-letter and full names', () => {
    assert.equal(mod.toStateCode('CA'), 'CA');
    assert.equal(mod.toStateCode('California'), 'CA');
    assert.equal(mod.toStateCode('Ontario'), 'ON');
    assert.equal(mod.toStateCode('Unknown'), undefined);
    assert.equal(mod.toStateCode(undefined), undefined);
  });

  it('venueNameVariants strips " at <parent>" and " - <org>"', () => {
    assert.deepEqual(mod.venueNameVariants('Greek Theater'), ['Greek Theater']);
    assert.deepEqual(
      mod.venueNameVariants('Greek Theater at UC Berkeley'),
      ['Greek Theater at UC Berkeley', 'Greek Theater'],
    );
    assert.deepEqual(
      mod.venueNameVariants('Carnegie - Live Nation'),
      ['Carnegie - Live Nation', 'Carnegie'],
    );
  });

  it('findTmVenueId returns null when results are empty', async () => {
    reset({ searchVenues: async () => [] });
    const result = await mod.findTmVenueId('Anywhere', 'NYC', 'NY');
    assert.equal(result, null);
  });

  it('findTmVenue returns id and canonical name when matched', async () => {
    reset({
      searchVenues: async () => [
        { id: 'tm-1', name: 'Beacon Theatre', city: { name: 'New York' } },
      ],
    });
    const result = await mod.findTmVenue('Beacon Theater', 'New York', 'NY');
    assert.deepEqual(result, { id: 'tm-1', name: 'Beacon Theatre' });
  });

  it('findTmVenue returns null when no result city matches', async () => {
    reset({
      searchVenues: async () => [
        { id: 'tm-other', name: 'Beacon Theatre', city: { name: 'Hopewell' } },
      ],
    });
    const result = await mod.findTmVenue('Beacon Theatre', 'New York', 'NY');
    assert.equal(result, null);
  });
});
