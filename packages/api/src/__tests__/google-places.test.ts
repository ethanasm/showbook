/**
 * Tests for google-places.ts — pure unit tests with stubbed global fetch.
 * No real network calls.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  autocomplete,
  getPlaceDetails,
  getPlacePhotoMediaUrl,
  pickBestPhotoName,
} from '../google-places';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env.GOOGLE_PLACES_API_KEY;

type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function stubFetch(handler: FetchStub) {
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
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_KEY === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
  else process.env.GOOGLE_PLACES_API_KEY = ORIGINAL_KEY;
});

// ── autocomplete ────────────────────────────────────────────────────────

test('autocomplete: returns [] when API key is missing', async () => {
  delete process.env.GOOGLE_PLACES_API_KEY;
  const result = await autocomplete('The Fillmore');
  assert.deepEqual(result, []);
});

test('autocomplete: returns [] when input is too short', async () => {
  const result = await autocomplete('a');
  assert.deepEqual(result, []);
});

test('autocomplete: returns [] when input is empty', async () => {
  const result = await autocomplete('');
  assert.deepEqual(result, []);
});

test('autocomplete: returns [] on non-OK response and reads body', async () => {
  let urlSeen = '';
  stubFetch(async (url) => {
    urlSeen = String(url);
    return new Response('forbidden', { status: 403 });
  });
  const result = await autocomplete('The Fillmore');
  assert.deepEqual(result, []);
  assert.ok(urlSeen.includes('places:autocomplete'));
});

test('autocomplete: maps placePrediction suggestions with structuredFormat', async () => {
  stubFetch(async (_url, init) => {
    // Verify request shape
    assert.equal(init?.method, 'POST');
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers['X-Goog-Api-Key'], 'test-key');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.input, 'Fillmore');
    // No type filter by default — see autocomplete() JSDoc.
    assert.equal(body.includedPrimaryTypes, undefined);

    return jsonResponse({
      suggestions: [
        {
          placePrediction: {
            placeId: 'place-1',
            structuredFormat: {
              mainText: { text: 'The Fillmore' },
              secondaryText: { text: '1805 Geary Blvd, San Francisco' },
            },
          },
        },
        {
          placePrediction: {
            placeId: 'place-2',
            text: { text: 'Other Place' },
          },
        },
        // Non-placePrediction entries are filtered out.
        { queryPrediction: { text: { text: 'just a query' } } },
      ],
    });
  });

  const result = await autocomplete('Fillmore');
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    placeId: 'place-1',
    displayName: 'The Fillmore',
    formattedAddress: '1805 Geary Blvd, San Francisco',
  });
  assert.deepEqual(result[1], {
    placeId: 'place-2',
    displayName: 'Other Place',
    formattedAddress: '',
  });
});

test('autocomplete: returns [] when suggestions field is missing', async () => {
  stubFetch(async () => jsonResponse({}));
  const result = await autocomplete('Foo');
  assert.deepEqual(result, []);
});

test('autocomplete: passes custom types through to body', async () => {
  let bodySeen: any;
  stubFetch(async (_url, init) => {
    bodySeen = JSON.parse(String(init?.body));
    return jsonResponse({ suggestions: [] });
  });
  await autocomplete('Foo', ['restaurant', 'bar']);
  assert.deepEqual(bodySeen.includedPrimaryTypes, ['restaurant', 'bar']);
});

test('autocomplete: omits includedPrimaryTypes when types is undefined or empty', async () => {
  const bodies: any[] = [];
  stubFetch(async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return jsonResponse({ suggestions: [] });
  });
  await autocomplete('Foo');
  await autocomplete('Foo', []);
  assert.equal(bodies[0].includedPrimaryTypes, undefined);
  assert.equal(bodies[1].includedPrimaryTypes, undefined);
});

test('autocomplete: handles missing structuredFormat — falls back to text.text', async () => {
  stubFetch(async () =>
    jsonResponse({
      suggestions: [
        { placePrediction: { placeId: 'p1', text: { text: 'Plain Name' } } },
      ],
    }),
  );
  const result = await autocomplete('Plain');
  assert.equal(result[0].displayName, 'Plain Name');
  assert.equal(result[0].formattedAddress, '');
});

test('autocomplete: handles entirely missing display fields — yields empty strings', async () => {
  stubFetch(async () =>
    jsonResponse({
      suggestions: [{ placePrediction: { placeId: 'p1' } }],
    }),
  );
  const result = await autocomplete('Foo');
  assert.equal(result[0].displayName, '');
  assert.equal(result[0].formattedAddress, '');
});

// ── getPlaceDetails ─────────────────────────────────────────────────────

test('getPlaceDetails: returns null when API key is missing', async () => {
  delete process.env.GOOGLE_PLACES_API_KEY;
  const result = await getPlaceDetails('place-1');
  assert.equal(result, null);
});

test('getPlaceDetails: returns null on non-OK response', async () => {
  stubFetch(async () => new Response('not found', { status: 404 }));
  const result = await getPlaceDetails('place-1');
  assert.equal(result, null);
});

test('getPlaceDetails: parses location, address components, photos', async () => {
  let urlSeen = '';
  stubFetch(async (url, init) => {
    urlSeen = String(url);
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers['X-Goog-Api-Key'], 'test-key');
    assert.ok(headers['X-Goog-FieldMask']);
    return jsonResponse({
      displayName: { text: 'The Fillmore' },
      location: { latitude: 37.784, longitude: -122.433 },
      addressComponents: [
        { types: ['locality'], longText: 'San Francisco' },
        { types: ['administrative_area_level_1'], longText: 'California', shortText: 'CA' },
        { types: ['country'], longText: 'United States' },
      ],
      photos: [{ name: 'places/abc/photos/xyz' }],
    });
  });

  const result = await getPlaceDetails('place-fillmore');
  assert.ok(urlSeen.includes('/places/place-fillmore'));
  assert.ok(urlSeen.includes('languageCode=en'));
  assert.deepEqual(result, {
    name: 'The Fillmore',
    city: 'San Francisco',
    stateRegion: 'California',
    country: 'United States',
    latitude: 37.784,
    longitude: -122.433,
    googlePlaceId: 'place-fillmore',
    photoUrl: 'places/abc/photos/xyz',
  });
});

test('getPlaceDetails: falls back to admin_area_level_2 for city, default country US, 0 lat/lng, null photo', async () => {
  stubFetch(async () =>
    jsonResponse({
      addressComponents: [
        { types: ['administrative_area_level_2'], longText: 'Some County' },
      ],
    }),
  );
  const result = await getPlaceDetails('place-2');
  assert.equal(result?.name, '');
  assert.equal(result?.city, 'Some County');
  assert.equal(result?.stateRegion, null);
  assert.equal(result?.country, 'US');
  assert.equal(result?.latitude, 0);
  assert.equal(result?.longitude, 0);
  assert.equal(result?.photoUrl, null);
});

test('getPlaceDetails: uses shortText when longText absent on a component', async () => {
  stubFetch(async () =>
    jsonResponse({
      addressComponents: [{ types: ['country'], shortText: 'GB' }],
    }),
  );
  const result = await getPlaceDetails('place-3');
  assert.equal(result?.country, 'GB');
});

test('getPlaceDetails: handles fully empty body', async () => {
  stubFetch(async () => jsonResponse({}));
  const result = await getPlaceDetails('place-4');
  assert.deepEqual(result, {
    name: '',
    city: '',
    stateRegion: null,
    country: 'US',
    latitude: 0,
    longitude: 0,
    googlePlaceId: 'place-4',
    photoUrl: null,
  });
});

// ── fetchWithRetry (transient network errors) ──────────────────────────

function transientError(code: string): Error {
  // Shape undici uses: `TypeError: fetch failed` with `err.cause.code`.
  const err = new TypeError('fetch failed');
  (err as { cause?: unknown }).cause = { code };
  return err;
}

test('getPlaceDetails: retries on a transient ECONNRESET then succeeds', async () => {
  let calls = 0;
  stubFetch(async () => {
    calls++;
    if (calls < 3) throw transientError('ECONNRESET');
    return jsonResponse({ displayName: { text: 'Recovered Venue' } });
  });
  const result = await getPlaceDetails('place-flaky');
  assert.equal(calls, 3);
  assert.equal(result?.name, 'Recovered Venue');
});

test('getPlaceDetails: propagates a transient error that survives every attempt', async () => {
  let calls = 0;
  stubFetch(async () => {
    calls++;
    throw transientError('ECONNRESET');
  });
  await assert.rejects(getPlaceDetails('place-down'), /fetch failed/);
  assert.equal(calls, 3); // exhausted all attempts
});

test('getPlaceDetails: does not retry a non-transient error', async () => {
  let calls = 0;
  stubFetch(async () => {
    calls++;
    throw new Error('boom'); // not a recognised transport failure
  });
  await assert.rejects(getPlaceDetails('place-x'), /boom/);
  assert.equal(calls, 1); // thrown on the first attempt, no retry
});

test('autocomplete: retries on a transient socket error then succeeds', async () => {
  let calls = 0;
  stubFetch(async () => {
    calls++;
    if (calls < 2) throw transientError('UND_ERR_SOCKET');
    return jsonResponse({
      suggestions: [{ placePrediction: { placeId: 'p1', text: { text: 'Venue One' } } }],
    });
  });
  const result = await autocomplete('venue');
  assert.equal(calls, 2);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.placeId, 'p1');
});

// ── getPlacePhotoMediaUrl ───────────────────────────────────────────────

test('getPlacePhotoMediaUrl: returns null when API key is missing', () => {
  delete process.env.GOOGLE_PLACES_API_KEY;
  assert.equal(getPlacePhotoMediaUrl('places/abc/photos/xyz'), null);
});

test('getPlacePhotoMediaUrl: returns null when photoName is empty', () => {
  assert.equal(getPlacePhotoMediaUrl(''), null);
});

test('getPlacePhotoMediaUrl: builds the media url with default maxWidthPx', () => {
  const url = getPlacePhotoMediaUrl('places/abc/photos/xyz');
  assert.ok(url);
  assert.ok(url!.startsWith('https://places.googleapis.com/v1/places/abc/photos/xyz/media'));
  assert.ok(url!.includes('maxWidthPx=1200'));
  assert.ok(url!.includes('key=test-key'));
});

test('getPlacePhotoMediaUrl: strips leading slashes from photoName', () => {
  const url = getPlacePhotoMediaUrl('///places/abc/photos/xyz', 800);
  assert.ok(url);
  assert.ok(url!.includes('/v1/places/abc/photos/xyz/media'));
  assert.ok(url!.includes('maxWidthPx=800'));
});

test('getPlacePhotoMediaUrl: url-encodes the API key', () => {
  process.env.GOOGLE_PLACES_API_KEY = 'a key & special';
  const url = getPlacePhotoMediaUrl('p/x');
  assert.ok(url);
  assert.ok(url!.includes('key=a%20key%20%26%20special'));
});

// ── pickBestPhotoName ──────────────────────────────────────────────────

test('pickBestPhotoName: returns null for empty / non-array input', () => {
  assert.equal(pickBestPhotoName(undefined), null);
  assert.equal(pickBestPhotoName(null), null);
  assert.equal(pickBestPhotoName([]), null);
});

test('pickBestPhotoName: picks first landscape >=1.3 ratio and >=1600 width', () => {
  const photos = [
    { name: 'p/portrait', widthPx: 3000, heightPx: 4000 },         // ratio 0.75 (portrait)
    { name: 'p/small-landscape', widthPx: 1200, heightPx: 800 },   // landscape but < 1600 wide
    { name: 'p/good-hero', widthPx: 3000, heightPx: 2000 },        // ratio 1.5, 3000 wide ← pick
    { name: 'p/another-good', widthPx: 4800, heightPx: 2700 },     // also good, but later
  ];
  assert.equal(pickBestPhotoName(photos), 'p/good-hero');
});

test('pickBestPhotoName: falls back to photos[0] when none of the top 5 qualify', () => {
  const photos = [
    { name: 'p/portrait-1', widthPx: 2000, heightPx: 3000 },
    { name: 'p/portrait-2', widthPx: 1800, heightPx: 2400 },
    { name: 'p/tiny-landscape', widthPx: 800, heightPx: 600 },
  ];
  assert.equal(pickBestPhotoName(photos), 'p/portrait-1');
});

test('pickBestPhotoName: only considers the top 5 candidates', () => {
  const photos = [
    { name: 'p/portrait', widthPx: 1000, heightPx: 2000 },
    { name: 'p/portrait', widthPx: 1000, heightPx: 2000 },
    { name: 'p/portrait', widthPx: 1000, heightPx: 2000 },
    { name: 'p/portrait', widthPx: 1000, heightPx: 2000 },
    { name: 'p/portrait', widthPx: 1000, heightPx: 2000 },
    { name: 'p/late-but-good', widthPx: 4000, heightPx: 2500 },
  ];
  // The good landscape is at index 5, so it's ignored; falls back to photos[0].
  assert.equal(pickBestPhotoName(photos), 'p/portrait');
});

test('pickBestPhotoName: skips entries missing dimensions but still returns photos[0] fallback', () => {
  const photos = [
    { name: 'p/no-dims' },
    { name: 'p/zero-height', widthPx: 2000, heightPx: 0 },
    { name: 'p/good', widthPx: 3000, heightPx: 1800 },
  ];
  assert.equal(pickBestPhotoName(photos), 'p/good');
});
