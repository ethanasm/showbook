/**
 * Unit tests for setlistfm.ts. Stubs global fetch — no real network calls.
 *
 * Covers: searchArtist, searchSetlist, the SetlistFmError class, the
 * 429 retry path, the rate-limiter delay branch, the missing-API-key
 * branch, and 404→empty mapping.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { searchArtist, searchSetlist, SetlistFmError } from '../setlistfm';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env.SETLISTFM_API_KEY;

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
  process.env.SETLISTFM_API_KEY = 'test-key';
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_KEY === undefined) delete process.env.SETLISTFM_API_KEY;
  else process.env.SETLISTFM_API_KEY = ORIGINAL_KEY;
});

// ── SetlistFmError ──────────────────────────────────────────────────────

test('SetlistFmError carries status, endpoint, message, and name', () => {
  const err = new SetlistFmError('bad', 503, '/x');
  assert.equal(err.message, 'bad');
  assert.equal(err.status, 503);
  assert.equal(err.endpoint, '/x');
  assert.equal(err.name, 'SetlistFmError');
  assert.ok(err instanceof Error);
});

// ── apiFetch: missing key ───────────────────────────────────────────────

test('searchArtist: throws SetlistFmError when SETLISTFM_API_KEY is unset', async () => {
  delete process.env.SETLISTFM_API_KEY;
  await assert.rejects(searchArtist('Radiohead'), (err: unknown) => {
    assert.ok(err instanceof SetlistFmError);
    assert.equal((err as SetlistFmError).status, 0);
    assert.match((err as Error).message, /SETLISTFM_API_KEY/);
    return true;
  });
});

// ── searchArtist ────────────────────────────────────────────────────────

test('searchArtist: returns mapped results and includes API key + Accept header', async () => {
  let urlSeen = '';
  let headersSeen: Record<string, string> = {};
  stubFetch(async (url, init) => {
    urlSeen = String(url);
    headersSeen = (init?.headers ?? {}) as Record<string, string>;
    return jsonResponse({
      artist: [
        {
          mbid: 'mb-1',
          name: 'Radiohead',
          sortName: 'Radiohead',
          disambiguation: 'UK rock',
        },
        { mbid: 'mb-2', name: 'Radiohead?', sortName: 'Radiohead?' },
      ],
      total: 2,
      page: 1,
      itemsPerPage: 30,
    });
  });

  const result = await searchArtist('Radiohead');
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    mbid: 'mb-1',
    name: 'Radiohead',
    sortName: 'Radiohead',
    disambiguation: 'UK rock',
  });
  assert.equal(result[1].disambiguation, undefined);
  assert.ok(urlSeen.includes('/search/artists?artistName=Radiohead'));
  assert.ok(urlSeen.includes('sort=relevance'));
  assert.equal(headersSeen['x-api-key'], 'test-key');
  assert.equal(headersSeen['Accept'], 'application/json');
});

test('searchArtist: encodes special characters in the query', async () => {
  let urlSeen = '';
  stubFetch(async (url) => {
    urlSeen = String(url);
    return jsonResponse({ artist: [], total: 0, page: 1, itemsPerPage: 30 });
  });
  await searchArtist('Sigur Rós');
  assert.ok(urlSeen.includes('Sigur%20R%C3%B3s'));
});

test('searchArtist: returns [] when API responds with empty artist array', async () => {
  stubFetch(async () => jsonResponse({ artist: [], total: 0, page: 1, itemsPerPage: 30 }));
  const result = await searchArtist('Nothing');
  assert.deepEqual(result, []);
});

test('searchArtist: returns [] when the artist field is missing', async () => {
  stubFetch(async () => jsonResponse({ total: 0, page: 1, itemsPerPage: 30 }));
  const result = await searchArtist('Nothing');
  assert.deepEqual(result, []);
});

test('searchArtist: returns [] on 404', async () => {
  stubFetch(async () => new Response('not found', { status: 404, statusText: 'Not Found' }));
  const result = await searchArtist('Mystery');
  assert.deepEqual(result, []);
});

test('searchArtist: rethrows non-404 errors', async () => {
  stubFetch(async () => new Response('boom', { status: 500, statusText: 'Internal Error' }));
  await assert.rejects(searchArtist('Boom'), (err: unknown) => {
    assert.ok(err instanceof SetlistFmError);
    assert.equal((err as SetlistFmError).status, 500);
    return true;
  });
});

// Regression: setlist.fm returns artists with empty `mbid` for entries it
// hasn't linked to MusicBrainz. Callers that picked the first result and
// passed its mbid to /search/setlists would build `?artistMbid=&date=...`
// and get a 400 from setlist.fm. Filter at this boundary so callers only
// ever see artists they can actually fetch a setlist for.
test('searchArtist: filters out artists with missing or empty MBID', async () => {
  stubFetch(async () =>
    jsonResponse({
      artist: [
        { mbid: '', name: 'Unlinked Artist', sortName: 'Unlinked Artist' },
        { name: 'Mbid-less Artist', sortName: 'Mbid-less Artist' },
        { mbid: 'mb-real', name: 'Real Artist', sortName: 'Real Artist' },
      ],
      total: 3,
      page: 1,
      itemsPerPage: 30,
    }),
  );
  const result = await searchArtist('Test');
  assert.equal(result.length, 1);
  assert.equal(result[0]!.mbid, 'mb-real');
});

// Regression: callers must never construct /search/setlists?artistMbid= —
// setlist.fm rejects empty mbids with 400. searchSetlist short-circuits
// before any network call when given a falsy mbid.
test('searchSetlist: returns null without hitting the API when mbid is empty', async () => {
  let calls = 0;
  stubFetch(async () => {
    calls++;
    return new Response('Bad Request', { status: 400, statusText: 'Bad Request' });
  });
  const result = await searchSetlist('', '2024-01-15');
  assert.equal(result, null);
  assert.equal(calls, 0);
});

// ── searchSetlist ───────────────────────────────────────────────────────

test('searchSetlist: returns sections preserving the encore boundary and per-song notes', async () => {
  let urlSeen = '';
  stubFetch(async (url) => {
    urlSeen = String(url);
    return jsonResponse({
      setlist: [
        {
          id: 'set-123',
          eventDate: '02-08-2024',
          artist: { mbid: 'mb-1', name: 'Radiohead' },
          venue: {
            id: 'v',
            name: 'Madison Square Garden',
            city: { id: 'c', name: 'NYC', country: { code: 'US', name: 'US' } },
          },
          tour: { name: 'Hail to the Thief' },
          sets: {
            set: [
              {
                song: [
                  { name: 'Song A' },
                  { name: 'Song B', info: 'extended intro' },
                ],
              },
              { encore: 1, song: [{ name: 'Song C' }] },
            ],
          },
        },
      ],
      total: 1,
      page: 1,
      itemsPerPage: 30,
    });
  });

  const result = await searchSetlist('mb-1', '2024-08-02');
  assert.deepEqual(result, {
    setlist: {
      sections: [
        {
          kind: 'set',
          songs: [
            { title: 'Song A' },
            { title: 'Song B', note: 'extended intro' },
          ],
        },
        {
          kind: 'encore',
          songs: [{ title: 'Song C' }],
        },
      ],
    },
    tourName: 'Hail to the Thief',
    setlistId: 'set-123',
  });
  // toSetlistFmDate produces dd-MM-yyyy; check the date in URL
  assert.ok(urlSeen.includes('date=02-08-2024'));
  assert.ok(urlSeen.includes('artistMbid=mb-1'));
});

test('searchSetlist: collapses multiple encore sets into a single encore section', async () => {
  stubFetch(async () =>
    jsonResponse({
      setlist: [
        {
          id: 's-multi',
          eventDate: '02-08-2024',
          artist: { mbid: 'mb-1', name: 'X' },
          venue: { id: 'v', name: 'V', city: { id: 'c', name: 'C', country: { code: 'US', name: 'US' } } },
          sets: {
            set: [
              { song: [{ name: 'Main 1' }] },
              { encore: 1, song: [{ name: 'E1' }] },
              { encore: 2, song: [{ name: 'E2' }] },
            ],
          },
        },
      ],
      total: 1,
      page: 1,
      itemsPerPage: 30,
    }),
  );
  const result = await searchSetlist('mb-1', '2024-08-02');
  assert.equal(result?.setlist.sections.length, 2);
  assert.equal(result?.setlist.sections[0]!.kind, 'set');
  assert.equal(result?.setlist.sections[1]!.kind, 'encore');
  assert.deepEqual(
    result?.setlist.sections[1]!.songs.map((s) => s.title),
    ['E1', 'E2'],
  );
});

test('searchSetlist: accepts a Date object', async () => {
  let urlSeen = '';
  stubFetch(async (url) => {
    urlSeen = String(url);
    return jsonResponse({
      setlist: [
        {
          id: 's',
          eventDate: '01-01-2024',
          artist: { mbid: 'mb-1', name: 'X' },
          venue: { id: 'v', name: 'V', city: { id: 'c', name: 'C', country: { code: 'US', name: 'US' } } },
          sets: { set: [{ song: [{ name: 'OnlySong' }] }] },
        },
      ],
      total: 1,
      page: 1,
      itemsPerPage: 30,
    });
  });
  // Use UTC noon to avoid TZ-day-rollover affecting padded dd-MM-yyyy.
  const d = new Date('2024-01-05T12:00:00Z');
  const result = await searchSetlist('mb-1', d);
  assert.equal(result?.setlist.sections[0]!.songs[0]!.title, 'OnlySong');
  // dd should be padded
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  assert.ok(urlSeen.includes(`date=${dd}-${mm}-2024`));
});

test('searchSetlist: returns null on no results', async () => {
  stubFetch(async () => jsonResponse({ setlist: [], total: 0, page: 1, itemsPerPage: 30 }));
  const result = await searchSetlist('mb-1', '2024-08-02');
  assert.equal(result, null);
});

test('searchSetlist: returns null when setlist field is missing', async () => {
  stubFetch(async () => jsonResponse({ total: 0, page: 1, itemsPerPage: 30 }));
  const result = await searchSetlist('mb-1', '2024-08-02');
  assert.equal(result, null);
});

test('searchSetlist: returns null on 404', async () => {
  stubFetch(async () => new Response('nope', { status: 404, statusText: 'Not Found' }));
  const result = await searchSetlist('mb-1', '2024-08-02');
  assert.equal(result, null);
});

test('searchSetlist: rethrows non-404 errors', async () => {
  stubFetch(async () => new Response('oops', { status: 500, statusText: 'ISE' }));
  await assert.rejects(searchSetlist('mb-1', '2024-08-02'));
});

test('searchSetlist: tourName undefined when missing; songs filter empties', async () => {
  stubFetch(async () =>
    jsonResponse({
      setlist: [
        {
          id: 's-x',
          eventDate: '02-08-2024',
          artist: { mbid: 'mb', name: 'X' },
          venue: { id: 'v', name: 'V', city: { id: 'c', name: 'C', country: { code: 'US', name: 'US' } } },
          sets: {
            set: [
              { song: [{ name: '' }, { name: 'Real' }] },
              { song: [] },
              {}, // no song key — exercises (s.song ?? [])
            ],
          },
        },
      ],
      total: 1,
      page: 1,
      itemsPerPage: 30,
    }),
  );
  const result = await searchSetlist('mb', '2024-08-02');
  assert.deepEqual(
    result?.setlist.sections[0]!.songs.map((s) => s.title),
    ['Real'],
  );
  assert.equal(result?.tourName, undefined);
});

test('searchSetlist: returns null when sets are missing entirely (no songs to map)', async () => {
  stubFetch(async () =>
    jsonResponse({
      setlist: [
        {
          id: 's',
          eventDate: '02-08-2024',
          artist: { mbid: 'mb', name: 'X' },
          venue: { id: 'v', name: 'V', city: { id: 'c', name: 'C', country: { code: 'US', name: 'US' } } },
        },
      ],
      total: 1,
      page: 1,
      itemsPerPage: 30,
    }),
  );
  const result = await searchSetlist('mb', '2024-08-02');
  assert.equal(result, null);
});

// ── 429 retry ───────────────────────────────────────────────────────────

test('apiFetch: retries once after 429 and returns the retry body', { timeout: 10_000 }, async () => {
  let n = 0;
  stubFetch(async () => {
    n++;
    if (n === 1) return new Response('rate', { status: 429, statusText: 'Too Many' });
    return jsonResponse({
      artist: [{ mbid: 'm', name: 'X', sortName: 'X' }],
      total: 1,
      page: 1,
      itemsPerPage: 30,
    });
  });

  const result = await searchArtist('X');
  assert.equal(n, 2);
  assert.equal(result.length, 1);
});

test('apiFetch: rethrows when 429 retry also fails', { timeout: 10_000 }, async () => {
  let n = 0;
  stubFetch(async () => {
    n++;
    if (n === 1) return new Response('rate', { status: 429, statusText: 'TM' });
    return new Response('still bad', { status: 503, statusText: 'Unavailable' });
  });

  await assert.rejects(searchArtist('X'), (err: unknown) => {
    assert.ok(err instanceof SetlistFmError);
    assert.equal((err as SetlistFmError).status, 503);
    return true;
  });
  assert.equal(n, 2);
});

// ── rate limit branch ──────────────────────────────────────────────────

test('apiFetch: rate-limit waits between back-to-back calls (covers MIN_INTERVAL branch)', { timeout: 10_000 }, async () => {
  // Two calls fired sequentially; the second should be delayed by ~500ms.
  stubFetch(async () =>
    jsonResponse({
      artist: [{ mbid: 'm', name: 'A', sortName: 'A' }],
      total: 1,
      page: 1,
      itemsPerPage: 30,
    }),
  );
  await searchArtist('A');
  const t0 = Date.now();
  await searchArtist('B');
  const elapsed = Date.now() - t0;
  // Allow some scheduler slack; assert at least 300ms (the limiter is 500).
  assert.ok(
    elapsed >= 300,
    `expected rate-limit delay of >=300ms, got ${elapsed}ms`,
  );
});
