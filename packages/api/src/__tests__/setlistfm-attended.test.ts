/**
 * Unit tests for setlist.fm `getUserAttended`. We swap globalThis.fetch with
 * stubs that return canned responses; no real setlist.fm calls happen.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getUserAttended, SetlistFmError } from '../setlistfm';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env.SETLISTFM_API_KEY;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
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

describe('getUserAttended', () => {
  it('returns mapped setlists with ISO dates and flattened songs', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return jsonResponse({
        setlist: [
          {
            id: 'sl-1',
            eventDate: '23-08-2024',
            artist: { mbid: 'mbid-1', name: 'Radiohead' },
            venue: {
              id: 'v-1',
              name: 'Madison Square Garden',
              city: {
                id: 'c-1',
                name: 'New York',
                state: 'New York',
                country: { code: 'US', name: 'United States' },
              },
            },
            tour: { name: 'In Rainbows World Tour' },
            sets: {
              set: [
                { song: [{ name: '15 Step' }, { name: 'There, There' }] },
                { encore: 1, song: [{ name: 'Videotape' }] },
              ],
            },
          },
        ],
        total: 1,
        page: 1,
        itemsPerPage: 20,
      });
    }) as typeof globalThis.fetch;

    const page = await getUserAttended('alice', 1);
    assert.equal(page.attended.length, 1);
    const a = page.attended[0]!;
    assert.equal(a.setlistId, 'sl-1');
    assert.equal(a.date, '2024-08-23'); // dd-mm-yyyy → yyyy-mm-dd
    assert.equal(a.artist.mbid, 'mbid-1');
    assert.equal(a.artist.name, 'Radiohead');
    assert.equal(a.venue.name, 'Madison Square Garden');
    assert.equal(a.venue.city, 'New York');
    assert.equal(a.tourName, 'In Rainbows World Tour');
    assert.equal(a.setlist.sections.length, 2);
    assert.equal(a.setlist.sections[0]!.kind, 'set');
    assert.equal(a.setlist.sections[0]!.songs.length, 2);
    assert.equal(a.setlist.sections[1]!.kind, 'encore');
    assert.equal(a.setlist.sections[1]!.songs[0]!.title, 'Videotape');
    // URL-encodes username + adds page param
    assert.match(capturedUrl, /\/user\/alice\/attended\?p=1/);
  });

  it('returns empty page on 404 (user not found)', async () => {
    globalThis.fetch = (async () =>
      new Response('Not Found', { status: 404 })) as typeof globalThis.fetch;
    const page = await getUserAttended('does-not-exist');
    assert.deepEqual(page.attended, []);
    assert.equal(page.total, 0);
  });

  it('throws on non-404 errors', async () => {
    globalThis.fetch = (async () =>
      new Response('Server Error', { status: 500 })) as typeof globalThis.fetch;
    await assert.rejects(
      getUserAttended('alice'),
      (err: unknown) => err instanceof SetlistFmError && err.status === 500,
    );
  });

  it('skips entries without an mbid (un-linked setlist.fm artists)', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        setlist: [
          {
            id: 'sl-2',
            eventDate: '01-01-2024',
            artist: { mbid: '', name: 'Unknown' },
            venue: { id: 'v', name: 'Somewhere', city: { id: 'c', name: 'City', country: { code: 'US', name: 'US' } } },
            sets: { set: [] },
          },
          {
            id: 'sl-3',
            eventDate: '02-01-2024',
            artist: { mbid: 'good', name: 'Real' },
            venue: { id: 'v2', name: 'There', city: { id: 'c', name: 'City', country: { code: 'US', name: 'US' } } },
            sets: { set: [{ song: [{ name: 'Hello' }] }] },
          },
        ],
        total: 2,
        page: 1,
        itemsPerPage: 20,
      })) as typeof globalThis.fetch;
    const page = await getUserAttended('alice');
    assert.equal(page.attended.length, 1);
    assert.equal(page.attended[0]!.artist.mbid, 'good');
  });

  it('returns empty result for blank username without hitting the network', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('should not be called', { status: 500 });
    }) as typeof globalThis.fetch;
    const page = await getUserAttended('   ');
    assert.equal(called, false);
    assert.deepEqual(page.attended, []);
  });
});
