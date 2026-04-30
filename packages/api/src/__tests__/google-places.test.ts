/**
 * Tests for google-places.ts — pure unit tests with stubbed global fetch.
 * No real network calls.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { autocomplete, getPlaceDetails, getPlacePhotoMediaUrl } from '../google-places';

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
    assert.deepEqual(body.includedPrimaryTypes, ['establishment']);

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
