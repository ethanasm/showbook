/**
 * Tests for geocode.ts. Stubs both global fetch (Nominatim) and the
 * google-places module by setting GOOGLE_PLACES_API_KEY to control which
 * code path runs and intercepting all fetches.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { geocodeVenue } from '../geocode';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env.GOOGLE_PLACES_API_KEY;

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function stubFetch(handler: FetchHandler) {
  globalThis.fetch = handler as typeof globalThis.fetch;
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  // Default: no Google key — geocodeVenue's first try{} short-circuits to []
  // from autocomplete and we drop straight to Nominatim.
  delete process.env.GOOGLE_PLACES_API_KEY;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_KEY === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
  else process.env.GOOGLE_PLACES_API_KEY = ORIGINAL_KEY;
});

// ── Google Places path ────────────────────────────────────────────────

// Plan §C: pass the venue's stateRegion into the Google autocomplete query
// so ambiguous names (e.g. "Warfield" — there are venues with that name in
// multiple US states) disambiguate to the right place. Without this, prod
// has been silently dropping the Place ID and photo for TM-picked venues.
test('geocodeVenue: includes stateRegion in the autocomplete input when provided', async () => {
  process.env.GOOGLE_PLACES_API_KEY = 'gk';
  let autocompleteInput: string | null = null;
  stubFetch(async (url, init) => {
    const u = String(url);
    if (u.includes('places:autocomplete')) {
      const body =
        init?.body && typeof init.body === 'string'
          ? (JSON.parse(init.body) as { input?: string })
          : null;
      autocompleteInput = body?.input ?? null;
      return jsonResponse({
        suggestions: [{ placePrediction: { placeId: 'p-w' } }],
      });
    }
    if (u.includes('/places/p-w')) {
      return jsonResponse({
        location: { latitude: 37.7795, longitude: -122.4195 },
        addressComponents: [
          { types: ['administrative_area_level_1'], longText: 'CA' },
        ],
        photos: [{ name: 'places/p-w/photos/abc' }],
      });
    }
    throw new Error(`unexpected fetch: ${u}`);
  });

  await geocodeVenue('Warfield', 'San Francisco', 'CA');
  assert.equal(autocompleteInput, 'Warfield, San Francisco, CA');
});

test('geocodeVenue: returns details from Google Places when available', async () => {
  process.env.GOOGLE_PLACES_API_KEY = 'gk';
  let calls = 0;
  stubFetch(async (url) => {
    calls++;
    const u = String(url);
    if (u.includes('places:autocomplete')) {
      return jsonResponse({
        suggestions: [
          { placePrediction: { placeId: 'p-1', text: { text: 'X' } } },
        ],
      });
    }
    if (u.includes('/places/p-1')) {
      return jsonResponse({
        displayName: { text: 'The Fillmore' },
        location: { latitude: 37.78, longitude: -122.43 },
        addressComponents: [
          { types: ['locality'], longText: 'San Francisco' },
          { types: ['administrative_area_level_1'], longText: 'CA' },
          { types: ['country'], longText: 'US' },
        ],
        photos: [{ name: 'places/p-1/photos/abc' }],
      });
    }
    throw new Error(`unexpected fetch: ${u}`);
  });

  const result = await geocodeVenue('The Fillmore', 'San Francisco');
  assert.deepEqual(result, {
    lat: 37.78,
    lng: -122.43,
    stateRegion: 'CA',
    country: 'US',
    googlePlaceId: 'p-1',
    photoUrl: 'places/p-1/photos/abc',
  });
  assert.equal(calls, 2);
});

test('geocodeVenue: falls through to Nominatim when Google details lat is 0', async () => {
  process.env.GOOGLE_PLACES_API_KEY = 'gk';
  stubFetch(async (url) => {
    const u = String(url);
    if (u.includes('places:autocomplete')) {
      return jsonResponse({
        suggestions: [{ placePrediction: { placeId: 'p-x' } }],
      });
    }
    if (u.includes('/places/p-x')) {
      // No location → latitude defaults to 0, falsy, so no return.
      return jsonResponse({});
    }
    if (u.includes('nominatim')) {
      return jsonResponse([
        {
          lat: '40.7',
          lon: '-74.0',
          address: { state: 'NY', country: 'US' },
        },
      ]);
    }
    throw new Error(`unexpected fetch: ${u}`);
  });

  const result = await geocodeVenue('NoLoc', 'NYC');
  assert.deepEqual(result, {
    lat: 40.7,
    lng: -74.0,
    stateRegion: 'NY',
    country: 'US',
  });
});

test('geocodeVenue: catches Google Places throw and falls through to Nominatim', async () => {
  process.env.GOOGLE_PLACES_API_KEY = 'gk';
  stubFetch(async (url) => {
    const u = String(url);
    if (u.includes('places:autocomplete')) {
      throw new Error('places down');
    }
    if (u.includes('nominatim')) {
      return jsonResponse([{ lat: '1.0', lon: '2.0' }]);
    }
    throw new Error(`unexpected fetch: ${u}`);
  });

  const result = await geocodeVenue('Foo', 'Bar');
  assert.deepEqual(result, {
    lat: 1.0,
    lng: 2.0,
    stateRegion: undefined,
    country: undefined,
  });
});

// ── Nominatim path ──────────────────────────────────────────────────────

test('geocodeVenue: returns Nominatim result on first query', async () => {
  let urlSeen = '';
  stubFetch(async (url, init) => {
    urlSeen = String(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    assert.equal(headers['User-Agent'], 'Showbook/1.0');
    return jsonResponse([
      {
        lat: '37.5',
        lon: '-122.0',
        address: { state: 'California', country: 'United States' },
      },
    ]);
  });

  const result = await geocodeVenue('The Foo', 'Palo Alto, CA');
  assert.deepEqual(result, {
    lat: 37.5,
    lng: -122.0,
    stateRegion: 'California',
    country: 'United States',
  });
  assert.ok(urlSeen.includes('nominatim'));
});

test('geocodeVenue: tries multiple variants when first returns empty', async () => {
  const queriesSeen: string[] = [];
  stubFetch(async (url) => {
    const u = String(url);
    queriesSeen.push(decodeURIComponent(new URL(u).searchParams.get('q') ?? ''));
    if (queriesSeen.length === 1) return jsonResponse([]);
    if (queriesSeen.length === 2) return jsonResponse([]);
    return jsonResponse([{ lat: '1', lon: '2' }]);
  });

  const result = await geocodeVenue('The Fillmore', 'San Francisco, CA');
  assert.equal(queriesSeen.length, 3);
  // First: full name. Second: stripped "The". Third: short city.
  assert.equal(queriesSeen[0], 'The Fillmore, San Francisco, CA');
  assert.equal(queriesSeen[1], 'Fillmore, San Francisco, CA');
  assert.equal(queriesSeen[2], 'The Fillmore San Francisco');
  assert.deepEqual(result, { lat: 1, lng: 2, stateRegion: undefined, country: undefined });
});

test('geocodeVenue: continues to next query on non-OK Nominatim response', async () => {
  let n = 0;
  stubFetch(async () => {
    n++;
    if (n === 1) return new Response('boom', { status: 500 });
    return jsonResponse([{ lat: '5', lon: '6' }]);
  });

  const result = await geocodeVenue('Foo', 'Bar');
  assert.deepEqual(result, { lat: 5, lng: 6, stateRegion: undefined, country: undefined });
});

test('geocodeVenue: continues on fetch throw', async () => {
  let n = 0;
  stubFetch(async () => {
    n++;
    if (n === 1) throw new Error('network');
    return jsonResponse([{ lat: '7', lon: '8' }]);
  });

  const result = await geocodeVenue('Foo', 'Bar');
  assert.deepEqual(result, { lat: 7, lng: 8, stateRegion: undefined, country: undefined });
});

test('geocodeVenue: returns null when all queries return empty', async () => {
  stubFetch(async () => jsonResponse([]));
  const result = await geocodeVenue('Mystery Venue', 'Nowhere');
  assert.equal(result, null);
});

test('geocodeVenue: returns null when all queries throw', async () => {
  stubFetch(async () => {
    throw new Error('net');
  });
  const result = await geocodeVenue('X', 'Y');
  assert.equal(result, null);
});
