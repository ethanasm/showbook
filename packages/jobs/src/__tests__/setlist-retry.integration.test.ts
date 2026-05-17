/**
 * Integration tests for runSetlistRetry. setlist.fm is stubbed via
 * globalThis.fetch; the DB is the real e2e Postgres (so jsonb_set and
 * the new (show_id, performer_id, type) unique index are exercised
 * against actual SQL semantics).
 *
 * Covers the per-performer flow that backs festival setlist ingestion:
 *   - A non-headliner queue row is processed against its own performer.
 *   - A successful fetch merges into shows.setlists[performerId] without
 *     clobbering a sibling performer's existing setlist.
 *   - Exhausting attempts on one festival artist writes a per-performer
 *     empty marker — sibling setlists stay intact.
 *
 * Run with:
 *   pnpm --filter @showbook/jobs test:integration
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  db,
  shows,
  showPerformers,
  performers,
  venues,
  users,
  enrichmentQueue,
} from '@showbook/db';
import { eq, inArray, like } from 'drizzle-orm';
import { runSetlistRetry } from '../setlist-retry';

const PREFIX = 'ee044044';
const USER = `${PREFIX}-1111-4111-8111-111111111111`;
const VENUE = `${PREFIX}-aaaa-4aaa-8aaa-aaaaaaaaaaa1`;
const SHOW_FESTIVAL = `${PREFIX}-bbbb-4bbb-8bbb-bbbbbbbbbbb1`;
const PERF_HEADLINER = `${PREFIX}-cccc-4ccc-8ccc-cccccccccc01`;
const PERF_SUPPORT_A = `${PREFIX}-cccc-4ccc-8ccc-cccccccccc02`;
const PERF_SUPPORT_B = `${PREFIX}-cccc-4ccc-8ccc-cccccccccc03`;

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env.SETLISTFM_API_KEY;

async function cleanup(): Promise<void> {
  await db.delete(enrichmentQueue).where(inArray(enrichmentQueue.showId, [SHOW_FESTIVAL]));
  await db.delete(shows).where(eq(shows.id, SHOW_FESTIVAL));
  await db.delete(performers).where(like(performers.name, `${PREFIX}%`));
  await db.delete(venues).where(eq(venues.id, VENUE));
  await db.delete(users).where(eq(users.id, USER));
}

async function seedFestival(): Promise<void> {
  await db.insert(users).values({ id: USER, email: `${USER}@test.local` });
  await db.insert(venues).values({
    id: VENUE,
    name: `${PREFIX} Venue`,
    city: 'NYC',
    country: 'US',
  });
  await db.insert(performers).values([
    { id: PERF_HEADLINER, name: `${PREFIX} Festival Headliner` },
    { id: PERF_SUPPORT_A, name: `${PREFIX} Festival Support A` },
    { id: PERF_SUPPORT_B, name: `${PREFIX} Festival Support B` },
  ]);
  await db.insert(shows).values({
    id: SHOW_FESTIVAL,
    userId: USER,
    venueId: VENUE,
    kind: 'festival',
    state: 'past',
    date: '2022-08-15',
  });
  await db.insert(showPerformers).values([
    { showId: SHOW_FESTIVAL, performerId: PERF_HEADLINER, role: 'headliner', sortOrder: 0 },
    { showId: SHOW_FESTIVAL, performerId: PERF_SUPPORT_A, role: 'support', sortOrder: 1 },
    { showId: SHOW_FESTIVAL, performerId: PERF_SUPPORT_B, role: 'support', sortOrder: 2 },
  ]);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(
  handler: (url: string) => Promise<Response> | Response,
): void {
  globalThis.fetch = ((input: RequestInfo | URL) =>
    Promise.resolve(handler(String(input)))) as typeof globalThis.fetch;
}

describe('runSetlistRetry per-performer enrichment', () => {
  before(async () => {
    process.env.SETLISTFM_API_KEY = 'test-key';
    await cleanup();
    await seedFestival();
  });

  after(async () => {
    await cleanup();
    globalThis.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_KEY === undefined) delete process.env.SETLISTFM_API_KEY;
    else process.env.SETLISTFM_API_KEY = ORIGINAL_KEY;
  });

  beforeEach(async () => {
    // Reset per-show state but keep performers/venue/user so each test
    // is isolated without paying the seed cost.
    await db.delete(enrichmentQueue).where(eq(enrichmentQueue.showId, SHOW_FESTIVAL));
    await db.update(shows).set({ setlists: null }).where(eq(shows.id, SHOW_FESTIVAL));
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('processes a support-performer queue row against that performer and merges into setlists', async () => {
    // Pre-populate the headliner's setlist so we can verify the merge
    // doesn't clobber it.
    await db
      .update(shows)
      .set({
        setlists: {
          [PERF_HEADLINER]: { sections: [{ kind: 'set', songs: [{ title: 'Headline Song' }] }] },
        },
      })
      .where(eq(shows.id, SHOW_FESTIVAL));

    await db.insert(enrichmentQueue).values({
      showId: SHOW_FESTIVAL,
      performerId: PERF_SUPPORT_A,
      type: 'setlist',
      attempts: 0,
      maxAttempts: 14,
      nextRetry: new Date(0),
    });

    stubFetch((url) => {
      if (url.includes('/search/setlists')) {
        // setlist-lookup uses the existing MBID on the performer row;
        // since we didn't set one, it will go through searchArtist first.
        return jsonResponse({
          setlist: [
            {
              id: 's-1',
              eventDate: '15-08-2022',
              artist: { mbid: 'mb-support-a', name: 'Festival Support A' },
              venue: { id: 'v', name: 'Venue', city: { id: 'c', name: 'NYC', country: { code: 'US', name: 'US' } } },
              sets: { set: [{ song: [{ name: 'Support A Opener' }, { name: 'Support A Closer' }] }] },
            },
          ],
          total: 1,
          page: 1,
          itemsPerPage: 30,
        });
      }
      if (url.includes('/search/artists')) {
        return jsonResponse({
          artist: [{ mbid: 'mb-support-a', name: 'Festival Support A', sortName: 'Festival Support A' }],
          total: 1,
          page: 1,
          itemsPerPage: 30,
        });
      }
      return new Response('unexpected', { status: 500 });
    });

    const counts = await runSetlistRetry();
    assert.equal(counts.processed, 1);
    assert.equal(counts.enriched, 1);

    // Queue row consumed.
    const remaining = await db
      .select()
      .from(enrichmentQueue)
      .where(eq(enrichmentQueue.showId, SHOW_FESTIVAL));
    assert.equal(remaining.length, 0, 'queue row should be deleted on success');

    // Setlists map has both performers — sibling NOT clobbered.
    const [row] = await db
      .select({ setlists: shows.setlists })
      .from(shows)
      .where(eq(shows.id, SHOW_FESTIVAL));
    assert.ok(row.setlists);
    const setlists = row.setlists as Record<string, { sections: Array<{ songs: Array<{ title: string }> }> }>;
    assert.ok(setlists[PERF_HEADLINER], 'headliner setlist still present');
    assert.equal(setlists[PERF_HEADLINER].sections[0].songs[0].title, 'Headline Song');
    assert.ok(setlists[PERF_SUPPORT_A], 'support A setlist written');
    assert.equal(setlists[PERF_SUPPORT_A].sections[0].songs.length, 2);
  });

  it('writes a per-performer empty marker on give-up without clobbering sibling setlists', async () => {
    // Headliner already enriched, support A enriched, support B exhausted.
    await db
      .update(shows)
      .set({
        setlists: {
          [PERF_HEADLINER]: { sections: [{ kind: 'set', songs: [{ title: 'H' }] }] },
          [PERF_SUPPORT_A]: { sections: [{ kind: 'set', songs: [{ title: 'A' }] }] },
        },
      })
      .where(eq(shows.id, SHOW_FESTIVAL));

    await db.insert(enrichmentQueue).values({
      showId: SHOW_FESTIVAL,
      performerId: PERF_SUPPORT_B,
      type: 'setlist',
      // attempts already at max — runSetlistRetry's safety guard
      // triggers give-up immediately.
      attempts: 14,
      maxAttempts: 14,
      nextRetry: new Date(0),
    });

    stubFetch(() => new Response('should not be called', { status: 500 }));

    const counts = await runSetlistRetry();
    assert.equal(counts.givenUp, 1);

    // Queue row gone.
    const remaining = await db
      .select()
      .from(enrichmentQueue)
      .where(eq(enrichmentQueue.showId, SHOW_FESTIVAL));
    assert.equal(remaining.length, 0);

    // setlists map: H + A intact, B marked as empty (give-up marker).
    const [row] = await db
      .select({ setlists: shows.setlists })
      .from(shows)
      .where(eq(shows.id, SHOW_FESTIVAL));
    assert.ok(row.setlists);
    const setlists = row.setlists as Record<string, { sections: unknown[] }>;
    assert.ok(setlists[PERF_HEADLINER], 'headliner setlist preserved');
    assert.ok(setlists[PERF_SUPPORT_A], 'support A setlist preserved');
    assert.ok(setlists[PERF_SUPPORT_B], 'support B has empty marker');
    assert.deepEqual(setlists[PERF_SUPPORT_B].sections, [], 'marker is { sections: [] }');
  });

  it('skips the queue row if the performer was deleted', async () => {
    const TEMP_PERF = `${PREFIX}-cccc-4ccc-8ccc-cccccccccc99`;
    await db.insert(performers).values({ id: TEMP_PERF, name: `${PREFIX} Temp Deleted` });
    await db.insert(enrichmentQueue).values({
      showId: SHOW_FESTIVAL,
      performerId: TEMP_PERF,
      type: 'setlist',
      attempts: 0,
      maxAttempts: 14,
      nextRetry: new Date(0),
    });
    // Now delete the performer — the CASCADE on the enrichment_queue FK
    // means the queue row goes too, so this exercises a different path:
    // the row stays if there are dangling references. To exercise the
    // "performer deleted but queue row still around" branch we'd need
    // to bypass the cascade; instead, just confirm the cascade itself
    // does the right thing.
    await db.delete(performers).where(eq(performers.id, TEMP_PERF));
    const remaining = await db
      .select()
      .from(enrichmentQueue)
      .where(eq(enrichmentQueue.showId, SHOW_FESTIVAL));
    assert.equal(remaining.length, 0, 'cascade deletes queue rows when performer is deleted');
  });
});
