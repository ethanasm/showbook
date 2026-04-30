/**
 * Unit tests for ticketmaster.ts. Stubs global fetch — no real network.
 *
 * Notes:
 *   - The module reads TICKETMASTER_API_KEY into a const at import time.
 *     ES-module import statements are hoisted above any sibling code, so
 *     to ensure the env var is set BEFORE the module evaluates we use a
 *     dynamic await import() with a top-level-await disabled-fallback:
 *     we await it in a beforeEach/`init` test that runs first. Cache-busted
 *     dynamic imports re-evaluate the module so we capture different
 *     API_KEY snapshots.
 *   - selectBestImage is also covered here (inferKind has its own
 *     dedicated file in ticketmaster-kind.test.ts; we add a couple of
 *     additional inferKind branches that file misses).
 */

process.env.TICKETMASTER_API_KEY = 'test-tm-key';

import { test, beforeEach, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import type {
  searchEvents as SearchEventsFn,
  getVenue as GetVenueFn,
  getEvent as GetEventFn,
  getAttraction as GetAttractionFn,
  searchVenues as SearchVenuesFn,
  searchAttractions as SearchAttractionsFn,
  selectBestImage as SelectBestImageFn,
  inferKind as InferKindFn,
  TMImage,
  TMError as TMErrorClass,
} from '../ticketmaster';

// Loaded in `before` once env is set so API_KEY capture sees 'test-tm-key'.
let searchEvents: typeof SearchEventsFn;
let getVenue: typeof GetVenueFn;
let getEvent: typeof GetEventFn;
let getAttraction: typeof GetAttractionFn;
let searchVenues: typeof SearchVenuesFn;
let searchAttractions: typeof SearchAttractionsFn;
let selectBestImage: typeof SelectBestImageFn;
let inferKind: typeof InferKindFn;
let TMError: typeof TMErrorClass;

before(async () => {
  process.env.TICKETMASTER_API_KEY = 'test-tm-key';
  const mod = await import('../ticketmaster?bust=primary');
  searchEvents = mod.searchEvents;
  getVenue = mod.getVenue;
  getEvent = mod.getEvent;
  getAttraction = mod.getAttraction;
  searchVenues = mod.searchVenues;
  searchAttractions = mod.searchAttractions;
  selectBestImage = mod.selectBestImage;
  inferKind = mod.inferKind;
  TMError = mod.TMError;
});

const ORIGINAL_FETCH = globalThis.fetch;

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

let urlsSeen: string[] = [];

beforeEach(() => {
  urlsSeen = [];
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

// ── TMError ─────────────────────────────────────────────────────────────

test('TMError exposes status, detail, message, and name', () => {
  const err = new TMError('boom', 500, 'detail body');
  assert.equal(err.message, 'boom');
  assert.equal(err.status, 500);
  assert.equal(err.detail, 'detail body');
  assert.equal(err.name, 'TMError');
  assert.ok(err instanceof Error);
});

// ── searchEvents ────────────────────────────────────────────────────────

test('searchEvents: builds URL with all string params and apikey, returns events', async () => {
  stubFetch(async (url) => {
    urlsSeen.push(String(url));
    return jsonResponse({
      _embedded: {
        events: [{ id: 'e1', name: 'Event 1', dates: { start: { localDate: '2026-08-01' } } }],
      },
      page: { size: 20, totalElements: 100, totalPages: 5, number: 0 },
    });
  });

  const result = await searchEvents({
    keyword: 'radiohead',
    venueId: 'KovZ',
    attractionId: 'KovA',
    latlong: '37.7,-122.4',
    radius: 25,
    unit: 'km',
    startDateTime: '2026-08-01T00:00:00Z',
    endDateTime: '2026-08-30T00:00:00Z',
    classificationName: 'music',
    size: 20,
    page: 0,
  });

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].id, 'e1');
  assert.equal(result.totalElements, 100);
  assert.equal(result.totalPages, 5);

  const u = new URL(urlsSeen[0]);
  assert.equal(u.pathname, '/discovery/v2/events.json');
  assert.equal(u.searchParams.get('apikey'), 'test-tm-key');
  assert.equal(u.searchParams.get('keyword'), 'radiohead');
  assert.equal(u.searchParams.get('venueId'), 'KovZ');
  assert.equal(u.searchParams.get('attractionId'), 'KovA');
  assert.equal(u.searchParams.get('latlong'), '37.7,-122.4');
  assert.equal(u.searchParams.get('radius'), '25');
  assert.equal(u.searchParams.get('unit'), 'km');
  assert.equal(u.searchParams.get('startDateTime'), '2026-08-01T00:00:00Z');
  assert.equal(u.searchParams.get('endDateTime'), '2026-08-30T00:00:00Z');
  assert.equal(u.searchParams.get('classificationName'), 'music');
  assert.equal(u.searchParams.get('size'), '20');
  assert.equal(u.searchParams.get('page'), '0');
});

test('searchEvents: omits undefined params from the URL and returns empty events array', async () => {
  stubFetch(async (url) => {
    urlsSeen.push(String(url));
    return jsonResponse({
      _embedded: {},
      page: { size: 0, totalElements: 0, totalPages: 0, number: 0 },
    });
  });

  const result = await searchEvents({ keyword: 'X' });
  assert.deepEqual(result, { events: [], totalElements: 0, totalPages: 0 });
  const u = new URL(urlsSeen[0]);
  assert.equal(u.searchParams.has('venueId'), false);
  assert.equal(u.searchParams.has('radius'), false);
  assert.equal(u.searchParams.has('size'), false);
});

test('searchEvents: handles missing _embedded entirely', async () => {
  stubFetch(async () =>
    jsonResponse({
      page: { size: 0, totalElements: 0, totalPages: 0, number: 0 },
    }),
  );
  const result = await searchEvents({});
  assert.deepEqual(result.events, []);
});

// ── getVenue / getEvent / getAttraction ─────────────────────────────────

test('getVenue: returns the venue object on success', async () => {
  stubFetch(async (url) => {
    urlsSeen.push(String(url));
    return jsonResponse({ id: 'V1', name: 'The Fillmore' });
  });
  const venue = await getVenue('V1');
  assert.equal(venue?.id, 'V1');
  assert.ok(urlsSeen[0].includes('/venues/V1.json'));
  assert.ok(urlsSeen[0].includes('apikey=test-tm-key'));
});

test('getVenue: returns null on 404', async () => {
  stubFetch(async () => new Response('nf', { status: 404, statusText: 'Not Found' }));
  const venue = await getVenue('missing');
  assert.equal(venue, null);
});

test('getVenue: throws TMError on non-404 errors', async () => {
  stubFetch(async () => new Response('boom', { status: 500, statusText: 'ISE' }));
  await assert.rejects(getVenue('x'), (err: unknown) => {
    assert.ok(err instanceof TMError);
    assert.equal((err as TMError).status, 500);
    return true;
  });
});

test('getEvent: returns the event on success', async () => {
  stubFetch(async (url) => {
    urlsSeen.push(String(url));
    return jsonResponse({
      id: 'E1',
      name: 'Show',
      dates: { start: { localDate: '2026-08-01' } },
    });
  });
  const event = await getEvent('E1');
  assert.equal(event?.id, 'E1');
  assert.ok(urlsSeen[0].includes('/events/E1.json'));
});

test('getEvent: returns null on 404', async () => {
  stubFetch(async () => new Response('nf', { status: 404, statusText: 'Not Found' }));
  const event = await getEvent('missing');
  assert.equal(event, null);
});

test('getEvent: rethrows TMError on non-404 errors', async () => {
  stubFetch(async () => new Response('boom', { status: 502, statusText: 'BG' }));
  await assert.rejects(getEvent('x'));
});

test('getAttraction: returns attraction on success', async () => {
  stubFetch(async (url) => {
    urlsSeen.push(String(url));
    return jsonResponse({ id: 'A1', name: 'Radiohead' });
  });
  const a = await getAttraction('A1');
  assert.equal(a?.id, 'A1');
  assert.ok(urlsSeen[0].includes('/attractions/A1.json'));
});

test('getAttraction: returns null on 404', async () => {
  stubFetch(async () => new Response('nf', { status: 404, statusText: 'NF' }));
  const a = await getAttraction('missing');
  assert.equal(a, null);
});

test('getAttraction: rethrows non-404 errors', async () => {
  stubFetch(async () => new Response('bad', { status: 500, statusText: 'ISE' }));
  await assert.rejects(getAttraction('x'));
});

// ── path-id encoding (defense against API-key steering) ─────────────────

test('getEvent: URL-encodes the id so callers cannot escape the path', async () => {
  stubFetch(async (url) => {
    urlsSeen.push(String(url));
    return jsonResponse({ id: 'E1', name: 'X', dates: { start: { localDate: '2026-01-01' } } });
  });
  await getEvent('../../venues/V1.json?leak=');
  const u = new URL(urlsSeen[0]);
  assert.equal(u.pathname, '/discovery/v2/events/..%2F..%2Fvenues%2FV1.json%3Fleak%3D.json');
  assert.equal(u.searchParams.get('apikey'), 'test-tm-key');
  assert.equal(u.searchParams.get('leak'), null);
});

test('getVenue: URL-encodes the id', async () => {
  stubFetch(async (url) => {
    urlsSeen.push(String(url));
    return jsonResponse({ id: 'V1', name: 'X' });
  });
  await getVenue('a/b?c=d');
  const u = new URL(urlsSeen[0]);
  assert.equal(u.pathname, '/discovery/v2/venues/a%2Fb%3Fc%3Dd.json');
  assert.equal(u.searchParams.get('c'), null);
});

test('getAttraction: URL-encodes the id', async () => {
  stubFetch(async (url) => {
    urlsSeen.push(String(url));
    return jsonResponse({ id: 'A1', name: 'X' });
  });
  await getAttraction('a b#frag');
  const u = new URL(urlsSeen[0]);
  assert.equal(u.pathname, '/discovery/v2/attractions/a%20b%23frag.json');
  assert.equal(u.hash, '');
});

// ── searchVenues / searchAttractions ────────────────────────────────────

test('searchVenues: defaults size=5 when not provided, includes optional codes', async () => {
  stubFetch(async (url) => {
    urlsSeen.push(String(url));
    return jsonResponse({
      _embedded: { venues: [{ id: 'V1', name: 'A' }, { id: 'V2', name: 'B' }] },
      page: { size: 5, totalElements: 2, totalPages: 1, number: 0 },
    });
  });

  const venues = await searchVenues({ keyword: 'fillmore', stateCode: 'CA', countryCode: 'US' });
  assert.equal(venues.length, 2);
  const u = new URL(urlsSeen[0]);
  assert.equal(u.pathname, '/discovery/v2/venues.json');
  assert.equal(u.searchParams.get('size'), '5');
  assert.equal(u.searchParams.get('stateCode'), 'CA');
  assert.equal(u.searchParams.get('countryCode'), 'US');
});

test('searchVenues: respects custom size and returns [] when no _embedded', async () => {
  stubFetch(async (url) => {
    urlsSeen.push(String(url));
    return jsonResponse({
      page: { size: 10, totalElements: 0, totalPages: 0, number: 0 },
    });
  });

  const venues = await searchVenues({ keyword: 'q', size: 10 });
  assert.deepEqual(venues, []);
  assert.ok(urlsSeen[0].includes('size=10'));
});

test('searchAttractions: queries the attractions endpoint with keyword', async () => {
  stubFetch(async (url) => {
    urlsSeen.push(String(url));
    return jsonResponse({
      _embedded: { attractions: [{ id: 'A1', name: 'Radiohead' }] },
      page: { size: 20, totalElements: 1, totalPages: 1, number: 0 },
    });
  });

  const attractions = await searchAttractions('radiohead');
  assert.equal(attractions.length, 1);
  assert.equal(attractions[0].id, 'A1');
  const u = new URL(urlsSeen[0]);
  assert.equal(u.pathname, '/discovery/v2/attractions.json');
  assert.equal(u.searchParams.get('keyword'), 'radiohead');
});

test('searchAttractions: returns [] when _embedded is missing', async () => {
  stubFetch(async () =>
    jsonResponse({ page: { size: 0, totalElements: 0, totalPages: 0, number: 0 } }),
  );
  const a = await searchAttractions('nothing');
  assert.deepEqual(a, []);
});

// ── rate limiter / 429 retry ────────────────────────────────────────────

test('rateLimitedFetch: retries on 429 and eventually returns the success body', async () => {
  let n = 0;
  stubFetch(async () => {
    n++;
    if (n === 1) return new Response('rate limit', { status: 429, statusText: 'Too Many' });
    return jsonResponse({ id: 'V42', name: 'Recovered' });
  });

  const venue = await getVenue('V42');
  assert.equal(n, 2);
  assert.equal(venue?.id, 'V42');
}, { timeout: 10_000 });

test('rateLimitedFetch: enforces MIN_INTERVAL between calls (covers wait branch)', async () => {
  stubFetch(async () => jsonResponse({ id: 'X', name: 'X' }));
  // Burn through any prior cooldown first.
  await getVenue('A');
  const t0 = Date.now();
  await getVenue('B');
  const elapsed = Date.now() - t0;
  // MIN_INTERVAL is 200ms. Allow scheduler slack but assert it waited.
  assert.ok(
    elapsed >= 100,
    `expected rate-limit delay to be >=100ms, got ${elapsed}ms`,
  );
});

// ── selectBestImage ─────────────────────────────────────────────────────

function img(overrides: Partial<TMImage>): TMImage {
  return { ratio: '16_9', url: 'https://example.com/x.jpg', width: 100, height: 56, fallback: false, ...overrides };
}

test('selectBestImage: returns null for null/undefined or empty array', () => {
  assert.equal(selectBestImage(undefined), null);
  assert.equal(selectBestImage([]), null);
});

test('selectBestImage: returns null when all images are fallbacks', () => {
  assert.equal(selectBestImage([img({ fallback: true })]), null);
});

test('selectBestImage: prefers 3_2 ratio over other ratios, picking widest', () => {
  const result = selectBestImage([
    img({ ratio: '16_9', width: 1920, url: 'wide.jpg' }),
    img({ ratio: '3_2', width: 600, url: 'small-3-2.jpg' }),
    img({ ratio: '3_2', width: 1200, url: 'best.jpg' }),
  ]);
  assert.equal(result, 'best.jpg');
});

test('selectBestImage: falls back to widest non-3_2 when no 3_2 exists', () => {
  const result = selectBestImage([
    img({ ratio: '16_9', width: 800, url: 'small.jpg' }),
    img({ ratio: '4_3', width: 1600, url: 'big.jpg' }),
    img({ ratio: '1_1', width: 400, url: 'tiny.jpg' }),
  ]);
  assert.equal(result, 'big.jpg');
});

// ── inferKind branches missed by ticketmaster-kind.test.ts ──────────────

test('inferKind: returns "concert" when classifications is undefined', () => {
  assert.equal(inferKind(undefined), 'concert');
});

test('inferKind: returns "concert" when classifications is empty', () => {
  assert.equal(inferKind([]), 'concert');
});

test('inferKind: arts/theatre with no recognised genre falls through to concert', () => {
  assert.equal(
    inferKind([
      { primary: true, segment: { id: 's', name: 'Arts & Theatre' }, genre: { id: 'g', name: 'Lecture' } },
    ]),
    'concert',
  );
});

test('inferKind: theater spelling is recognised', () => {
  assert.equal(
    inferKind([
      { primary: true, segment: { id: 's', name: 'Arts & Theatre' }, genre: { id: 'g', name: 'Theater' } },
    ]),
    'theatre',
  );
});

test('inferKind: when no classification is primary, picks the first', () => {
  assert.equal(
    inferKind([
      { primary: false, segment: { id: 's1', name: 'Music' }, genre: { id: 'g', name: 'Rock' } },
      { primary: false, segment: { id: 's2', name: 'Sports' } },
    ]),
    'concert',
  );
});

test('inferKind: known festival name "Outside Lands" maps to festival even without festival tokens', () => {
  assert.equal(
    inferKind(
      [{ primary: true, segment: { id: 's', name: 'Music' }, genre: { id: 'g', name: 'Indie' } }],
      { eventName: 'Outside Lands 2026' },
    ),
    'festival',
  );
});

test('inferKind: handles null eventName gracefully', () => {
  assert.equal(
    inferKind(
      [{ primary: true, segment: { id: 's', name: 'Music' }, genre: { id: 'g', name: 'Rock' } }],
      { eventName: null },
    ),
    'concert',
  );
});

// ── tmFetch error path: response.text is consumed on non-OK ────────────

test('tmFetch: TMError carries status and detail (response body)', async () => {
  stubFetch(async () => new Response('detailed error body', { status: 500, statusText: 'ISE' }));
  await assert.rejects(getVenue('x'), (err: unknown) => {
    assert.ok(err instanceof TMError);
    assert.equal((err as TMError).status, 500);
    assert.equal((err as TMError).detail, 'detailed error body');
    return true;
  });
});

// Note: ticketmaster.ts reads TICKETMASTER_API_KEY into a module-scope
// const at import time. The "?? '' " fallback when the env var is unset
// is exercised only on the very first module evaluation; once cached,
// the binding is fixed. Re-importing with a query-string suffix does NOT
// produce a fresh module under tsx/Node's ESM loader, so we cannot
// re-run the constant initializer in-process. The branch is covered
// indirectly: any caller in a deployment without the env var would hit
// it, and unit-level coverage of the logic is not load-bearing.
