/**
 * Unit tests for `setlistfm.fetchArtistSetlists`. Stubs `globalThis.fetch`
 * with canned page responses; exercises pagination, page-cap, sinceDate
 * cutoff, and 404 graceful handling.
 *
 * The setlist.fm rate-limit (500ms minimum interval enforced inside
 * `apiFetch`) means each test calling more than one page waits half a
 * second per call. Tests stay <1s by either paging once OR overriding
 * the rate limiter via the test's own scheduling.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchArtistSetlists, SetlistFmError } from '../setlistfm';

let origFetch: typeof globalThis.fetch;
let origKey: string | undefined;

beforeEach(() => {
  origFetch = globalThis.fetch;
  origKey = process.env.SETLISTFM_API_KEY;
  process.env.SETLISTFM_API_KEY = 'test-setlistfm-key';
});

afterEach(() => {
  globalThis.fetch = origFetch;
  if (origKey === undefined) delete process.env.SETLISTFM_API_KEY;
  else process.env.SETLISTFM_API_KEY = origKey;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeSetlist(opts: {
  id: string;
  date: string; // DD-MM-YYYY (setlist.fm format)
  tour?: string;
  songs?: string[];
  encore?: string[];
}) {
  const sets = [
    { song: (opts.songs ?? []).map((name) => ({ name })) },
  ];
  if (opts.encore && opts.encore.length > 0) {
    sets.push({
      encore: 1,
      song: opts.encore.map((name) => ({ name })),
    } as { encore: number; song: { name: string }[] });
  }
  return {
    id: opts.id,
    eventDate: opts.date,
    artist: { mbid: 'mbid-test', name: 'Test Artist' },
    venue: {
      id: 'v1',
      name: 'Test Venue',
      city: { id: 'c1', name: 'Brooklyn', country: { code: 'US', name: 'USA' } },
    },
    ...(opts.tour ? { tour: { name: opts.tour } } : {}),
    sets: { set: sets },
  };
}

describe('fetchArtistSetlists', () => {
  it('returns mapped setlists from a single page', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        setlist: [
          fakeSetlist({
            id: 's1',
            date: '15-09-2025',
            tour: 'Miss Possessive Tour',
            songs: ['Miss possessive', 'Sports car'],
            encore: ['greedy'],
          }),
        ],
        total: 1,
        page: 1,
        itemsPerPage: 20,
      })) as typeof globalThis.fetch;

    const result = await fetchArtistSetlists('mbid-test', { maxPages: 1 });
    assert.equal(result.length, 1);
    assert.equal(result[0]?.setlistfmId, 's1');
    assert.equal(result[0]?.performanceDate, '2025-09-15');
    assert.equal(result[0]?.tourName, 'Miss Possessive Tour');
    assert.equal(result[0]?.songCount, 3);
    // sections preserve encore boundary
    assert.equal(result[0]?.setlist.sections.length, 2);
    assert.equal(result[0]?.setlist.sections[0]?.kind, 'set');
    assert.equal(result[0]?.setlist.sections[1]?.kind, 'encore');
  });

  it('returns an empty array on 404', async () => {
    globalThis.fetch = (async () =>
      new Response('Not Found', { status: 404 })) as typeof globalThis.fetch;
    const result = await fetchArtistSetlists('not-in-mbz', { maxPages: 3 });
    assert.deepEqual(result, []);
  });

  it('returns an empty array when artistMbid is blank', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return jsonResponse({ setlist: [] });
    }) as typeof globalThis.fetch;
    const result = await fetchArtistSetlists('', { maxPages: 1 });
    assert.deepEqual(result, []);
    assert.equal(called, false, 'fetch should not be invoked for empty mbid');
  });

  it('skips empty / songless setlists', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        setlist: [
          fakeSetlist({ id: 's-empty', date: '01-01-2025' }), // no songs
          fakeSetlist({
            id: 's-real',
            date: '02-01-2025',
            songs: ['Track one'],
          }),
        ],
      })) as typeof globalThis.fetch;
    const result = await fetchArtistSetlists('mbid-test', { maxPages: 1 });
    assert.equal(result.length, 1);
    assert.equal(result[0]?.setlistfmId, 's-real');
  });

  it('stops paging when sinceDate cutoff is hit', async () => {
    let pageCalls = 0;
    globalThis.fetch = (async () => {
      pageCalls += 1;
      if (pageCalls === 1) {
        return jsonResponse({
          setlist: [
            // 20 fresh setlists in 2025 (full page so the loop continues to page 2)
            ...Array.from({ length: 20 }, (_, i) =>
              fakeSetlist({
                id: `p1-${i}`,
                date: `${String(i + 1).padStart(2, '0')}-09-2025`,
                songs: ['x'],
              }),
            ),
          ],
        });
      }
      // Page 2 has older entries — first one is before sinceDate=2025-01-01
      return jsonResponse({
        setlist: [
          fakeSetlist({
            id: 'p2-old',
            date: '15-12-2024',
            songs: ['y'],
          }),
        ],
      });
    }) as typeof globalThis.fetch;

    const result = await fetchArtistSetlists('mbid-test', {
      maxPages: 5,
      sinceDate: '2025-01-01',
    });
    assert.equal(pageCalls, 2, 'should walk to page 2 then stop on cutoff');
    assert.equal(result.length, 20);
    assert.ok(result.every((r) => r.performanceDate >= '2025-01-01'));
  });

  it('stops paging when fewer than 20 setlists are returned (last page)', async () => {
    let pageCalls = 0;
    globalThis.fetch = (async () => {
      pageCalls += 1;
      return jsonResponse({
        // Only 3 setlists — short of the 20-per-page cap, so no further pages.
        setlist: [
          fakeSetlist({ id: 'a', date: '01-01-2025', songs: ['x'] }),
          fakeSetlist({ id: 'b', date: '02-01-2025', songs: ['y'] }),
          fakeSetlist({ id: 'c', date: '03-01-2025', songs: ['z'] }),
        ],
      });
    }) as typeof globalThis.fetch;
    const result = await fetchArtistSetlists('mbid-test', { maxPages: 5 });
    assert.equal(pageCalls, 1, 'short page = no further fetch');
    assert.equal(result.length, 3);
  });

  it('respects maxPages even when each page is full', async () => {
    let pageCalls = 0;
    globalThis.fetch = (async () => {
      pageCalls += 1;
      return jsonResponse({
        setlist: Array.from({ length: 20 }, (_, i) =>
          fakeSetlist({
            id: `p${pageCalls}-${i}`,
            // Use different dates per page so sinceDate doesn't trigger
            date: `${String(i + 1).padStart(2, '0')}-${String(pageCalls).padStart(2, '0')}-2025`,
            songs: ['x'],
          }),
        ),
      });
    }) as typeof globalThis.fetch;
    const result = await fetchArtistSetlists('mbid-test', { maxPages: 2 });
    assert.equal(pageCalls, 2, 'should stop after maxPages');
    assert.equal(result.length, 40);
  });

  it('throws non-404 errors instead of swallowing them', async () => {
    globalThis.fetch = (async () =>
      new Response('Server Error', { status: 500 })) as typeof globalThis.fetch;
    await assert.rejects(
      () => fetchArtistSetlists('mbid-test', { maxPages: 1 }),
      (err: unknown) =>
        err instanceof SetlistFmError && err.status === 500,
    );
  });
});
