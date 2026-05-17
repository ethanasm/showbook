/**
 * Unit tests for fetchSetlistForPerformer — the helper shared by
 * shows.create's inline enrichment and setlist-retry's queued enrichment.
 *
 * setlist.fm is mocked via globalThis.fetch; `db.update` is monkey-patched
 * per test so we can assert on the MBID-persist hop without standing up
 * Postgres.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= 'postgresql://x:x@127.0.0.1:1/x';

import { fetchSetlistForPerformer } from '../setlist-lookup';
import { db } from '@showbook/db';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env.SETLISTFM_API_KEY;
const ORIGINAL_UPDATE = db.update;

type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function stubFetch(handler: FetchStub) {
  globalThis.fetch = handler as typeof globalThis.fetch;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface UpdateCall {
  setArg: Record<string, unknown>;
  whereArg: unknown;
}

function stubUpdateOnce(): { calls: UpdateCall[] } {
  const calls: UpdateCall[] = [];
  (db as unknown as { update: unknown }).update = () => ({
    set(setArg: Record<string, unknown>) {
      return {
        where(whereArg: unknown) {
          calls.push({ setArg, whereArg });
          return Promise.resolve(undefined);
        },
      };
    },
  });
  return { calls };
}

beforeEach(() => {
  process.env.SETLISTFM_API_KEY = 'test-key';
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  (db as unknown as { update: unknown }).update = ORIGINAL_UPDATE;
  if (ORIGINAL_KEY === undefined) delete process.env.SETLISTFM_API_KEY;
  else process.env.SETLISTFM_API_KEY = ORIGINAL_KEY;
});

test('uses provided MBID directly, skips searchArtist hop, returns the setlist', async () => {
  const requested: string[] = [];
  stubFetch(async (url) => {
    const u = String(url);
    requested.push(u);
    if (u.includes('/search/setlists')) {
      return jsonResponse({
        setlist: [
          {
            id: 's-1',
            eventDate: '09-05-2026',
            artist: { mbid: 'mb-given', name: 'No Doubt' },
            venue: {
              id: 'v',
              name: 'Sphere',
              city: { id: 'c', name: 'Las Vegas', country: { code: 'US', name: 'US' } },
            },
            tour: { name: 'Sphere Residency' },
            sets: { set: [{ song: [{ name: "Just a Girl" }, { name: "Don't Speak" }] }] },
          },
        ],
        total: 1,
        page: 1,
        itemsPerPage: 30,
      });
    }
    return new Response('unexpected', { status: 500 });
  });
  const { calls } = stubUpdateOnce();

  const result = await fetchSetlistForPerformer({
    performerId: 'perf-1',
    performerName: 'No Doubt',
    performerMbid: 'mb-given',
    date: '2026-05-09',
  });

  assert.ok(result);
  assert.equal(result!.tourName, 'Sphere Residency');
  assert.equal(result!.setlist.sections.length, 1);
  assert.equal(result!.setlist.sections[0].songs.length, 2);
  assert.ok(
    requested.every((u) => !u.includes('/search/artists')),
    'should not call /search/artists when MBID was provided',
  );
  assert.equal(calls.length, 0, 'should not persist a new MBID when one was already provided');
});

test('resolves MBID via searchArtist when missing, persists it, then fetches the setlist', async () => {
  stubFetch(async (url) => {
    const u = String(url);
    if (u.includes('/search/artists')) {
      return jsonResponse({
        artist: [{ mbid: 'mb-resolved', name: 'Chet Faker', sortName: 'Chet Faker' }],
        total: 1,
        page: 1,
        itemsPerPage: 30,
      });
    }
    if (u.includes('/search/setlists')) {
      assert.ok(u.includes('artistMbid=mb-resolved'), `expected resolved MBID in URL, got: ${u}`);
      return jsonResponse({
        setlist: [
          {
            id: 's-2',
            eventDate: '05-05-2026',
            artist: { mbid: 'mb-resolved', name: 'Chet Faker' },
            venue: {
              id: 'v',
              name: 'The Warfield',
              city: { id: 'c', name: 'San Francisco', country: { code: 'US', name: 'US' } },
            },
            sets: { set: [{ song: [{ name: 'Talk Is Cheap' }] }] },
          },
        ],
        total: 1,
        page: 1,
        itemsPerPage: 30,
      });
    }
    return new Response('unexpected', { status: 500 });
  });
  const { calls } = stubUpdateOnce();

  const result = await fetchSetlistForPerformer({
    performerId: 'perf-2',
    performerName: 'Chet Faker',
    performerMbid: null,
    date: '2026-05-05',
  });

  assert.ok(result);
  assert.equal(calls.length, 1, 'should persist the freshly-resolved MBID');
  assert.deepEqual(calls[0].setArg, { musicbrainzId: 'mb-resolved' });
});

test('returns null without persisting when searchArtist finds nothing', async () => {
  stubFetch(async (url) => {
    const u = String(url);
    if (u.includes('/search/artists')) {
      return jsonResponse({ artist: [], total: 0, page: 1, itemsPerPage: 30 });
    }
    return new Response('unexpected /search/setlists call', { status: 500 });
  });
  const { calls } = stubUpdateOnce();

  const result = await fetchSetlistForPerformer({
    performerId: 'perf-3',
    performerName: 'Ghost Performer',
    performerMbid: null,
    date: '2026-05-01',
  });

  assert.equal(result, null);
  assert.equal(calls.length, 0);
});

test('returns null when the date has no setlist on file', async () => {
  stubFetch(async (url) => {
    const u = String(url);
    if (u.includes('/search/setlists')) {
      // setlist.fm returns 404 for "no results" — searchSetlist maps that
      // to null, which fetchSetlistForPerformer passes through.
      return new Response('Not Found', { status: 404, statusText: 'Not Found' });
    }
    return new Response('unexpected', { status: 500 });
  });
  stubUpdateOnce();

  const result = await fetchSetlistForPerformer({
    performerId: 'perf-4',
    performerName: 'Some Band',
    performerMbid: 'mb-known',
    date: '2026-05-01',
  });

  assert.equal(result, null);
});
