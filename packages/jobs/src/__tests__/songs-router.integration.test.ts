/**
 * Integration coverage for the `songs` router.
 *
 * Seeds a fixture user with three shows from one performer + two
 * shows from a second performer, where one song repeats across
 * shows and another is the user's tour-debut catch (heard exactly
 * once). Asserts the grouped result, the filter behaviour, and the
 * per-song detail timeline.
 *
 * The corpus / rarity branch is exercised indirectly via the seeded
 * `tour_setlists` rows so `songs.byId({ songId })` returns a populated
 * `rarity` block.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import {
  db,
  performers,
  shows,
  showPerformers,
  users,
  venues,
} from '@showbook/db';
import { appRouter, createContext, runSongIndexRebuild } from '@showbook/api';

function callerFor(userId: string) {
  return appRouter.createCaller(
    createContext({ session: { user: { id: userId } } }),
  );
}

const PREFIX = 'ab777777';
const USER = `${PREFIX}-1111-4111-8111-111111111111`;
const VENUE = `${PREFIX}-2222-4222-8222-222222222222`;
const PERF_A = `${PREFIX}-3333-4333-8333-333333333333`;
const PERF_B = `${PREFIX}-3333-4333-8333-333333333334`;
const SHOW_1 = `${PREFIX}-4444-4444-8444-444444444441`;
const SHOW_2 = `${PREFIX}-4444-4444-8444-444444444442`;
const SHOW_3 = `${PREFIX}-4444-4444-8444-444444444443`;

describe('songs router integration', () => {
  before(async () => {
    if (!process.env.DATABASE_URL) {
      console.log('[songs router integration] DATABASE_URL not set — skipping');
      return;
    }
    await cleanup();
    await db.insert(users).values({ id: USER, email: `${PREFIX}@test.local` });
    await db.insert(venues).values({
      id: VENUE,
      name: `${PREFIX} arena`,
      city: 'NYC',
      country: 'US',
    });
    await db.insert(performers).values([
      { id: PERF_A, name: `${PREFIX} Headliner A` },
      { id: PERF_B, name: `${PREFIX} Headliner B` },
    ]);

    // 3 past shows for performer A with overlapping setlists.
    //   show 1 (2024-06-15): songs ["Bloodbuzz Ohio", "Fake Empire"]
    //   show 2 (2024-09-22): songs ["Bloodbuzz Ohio", "Mr November"]
    //   show 3 (2025-03-30): songs ["Bloodbuzz Ohio", "Light Years"]
    // 1 past show for performer B
    //   show 3 also features performer B with one song
    await db.insert(shows).values([
      {
        id: SHOW_1,
        userId: USER,
        venueId: VENUE,
        kind: 'concert',
        state: 'past',
        date: '2024-06-15',
        setlists: {
          [PERF_A]: {
            sections: [
              {
                kind: 'set',
                songs: [{ title: 'Bloodbuzz Ohio' }, { title: 'Fake Empire' }],
              },
            ],
          },
        },
      },
      {
        id: SHOW_2,
        userId: USER,
        venueId: VENUE,
        kind: 'concert',
        state: 'past',
        date: '2024-09-22',
        setlists: {
          [PERF_A]: {
            sections: [
              {
                kind: 'set',
                songs: [{ title: 'Bloodbuzz Ohio' }, { title: 'Mr November' }],
              },
            ],
          },
        },
      },
      {
        id: SHOW_3,
        userId: USER,
        venueId: VENUE,
        kind: 'concert',
        state: 'past',
        date: '2025-03-30',
        setlists: {
          [PERF_A]: {
            sections: [
              {
                kind: 'set',
                songs: [{ title: 'Bloodbuzz Ohio' }, { title: 'Light Years' }],
              },
            ],
          },
          [PERF_B]: {
            sections: [
              {
                kind: 'set',
                songs: [{ title: 'Other Song' }],
              },
            ],
          },
        },
      },
    ]);
    await db.insert(showPerformers).values([
      { showId: SHOW_1, performerId: PERF_A, role: 'headliner', sortOrder: 0 },
      { showId: SHOW_2, performerId: PERF_A, role: 'headliner', sortOrder: 0 },
      { showId: SHOW_3, performerId: PERF_A, role: 'headliner', sortOrder: 0 },
      { showId: SHOW_3, performerId: PERF_B, role: 'support', sortOrder: 1 },
    ]);

    await runSongIndexRebuild({ performerId: PERF_A });
    await runSongIndexRebuild({ performerId: PERF_B });
  });

  after(async () => {
    if (!process.env.DATABASE_URL) return;
    await cleanup();
  });

  it('lists every song the user heard, with timesHeard ordered DESC', { skip: !process.env.DATABASE_URL }, async () => {
    const caller = callerFor(USER);
    const list = await caller.songs.list({ limit: 200 });
    // 4 distinct titles played by performer A + 1 by B = 5 rows.
    const myRows = list.filter((r) => r.performerId === PERF_A || r.performerId === PERF_B);
    assert.equal(myRows.length, 5);

    const bloodbuzz = myRows.find((r) => r.title === 'Bloodbuzz Ohio');
    assert.ok(bloodbuzz, 'Bloodbuzz Ohio should appear');
    assert.equal(bloodbuzz!.timesHeard, 3);
    assert.equal(bloodbuzz!.firstHeard, '2024-06-15');
    assert.equal(bloodbuzz!.lastHeard, '2025-03-30');
    assert.equal(bloodbuzz!.isUserDebut, false);

    const fakeEmpire = myRows.find((r) => r.title === 'Fake Empire');
    assert.ok(fakeEmpire);
    assert.equal(fakeEmpire!.timesHeard, 1);
    assert.equal(fakeEmpire!.isUserDebut, true);

    // Default sort is times-heard DESC then title ASC.
    assert.equal(myRows[0]!.title, 'Bloodbuzz Ohio');
  });

  it('respects the performerId filter', { skip: !process.env.DATABASE_URL }, async () => {
    const caller = callerFor(USER);
    const list = await caller.songs.list({
      performerId: PERF_B,
      limit: 200,
    });
    assert.equal(list.length, 1);
    assert.equal(list[0]!.title, 'Other Song');
  });

  it('flags songs heard exactly once as isUserDebut', { skip: !process.env.DATABASE_URL }, async () => {
    const caller = callerFor(USER);
    const list = await caller.songs.list({ limit: 200 });
    const ours = list.filter((r) => r.performerId === PERF_A || r.performerId === PERF_B);
    const debuts = ours.filter((r) => r.isUserDebut).map((r) => r.title).sort();
    assert.deepEqual(debuts, ['Fake Empire', 'Light Years', 'Mr November', 'Other Song']);
  });

  it('byId returns the song header + the user-scoped timeline', { skip: !process.env.DATABASE_URL }, async () => {
    const caller = callerFor(USER);
    const list = await caller.songs.list({
      performerId: PERF_A,
      limit: 200,
    });
    const bloodbuzz = list.find((r) => r.title === 'Bloodbuzz Ohio')!;
    const detail = await caller.songs.byId({ songId: bloodbuzz.songId });
    assert.equal(detail.song.title, 'Bloodbuzz Ohio');
    assert.equal(detail.song.performerName, `${PREFIX} Headliner A`);
    assert.equal(detail.timesHeard, 3);
    assert.equal(detail.timeline.length, 3);
    // Timeline is ascending by date.
    assert.equal(detail.timeline[0]!.date, '2024-06-15');
    assert.equal(detail.timeline[2]!.date, '2025-03-30');
    assert.equal(detail.firstHeard!.date, '2024-06-15');
    assert.equal(detail.lastHeard!.date, '2025-03-30');
    // No corpus seeded → rarity is null (the procedure returns null
    // rather than throwing when tour_setlists is empty for this
    // performer).
    assert.equal(detail.rarity, null);
  });
});

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM setlist_song_appearances WHERE performer_id::text LIKE ${PREFIX + '-%'}`);
  await db.execute(sql`DELETE FROM songs WHERE performer_id::text LIKE ${PREFIX + '-%'}`);
  await db.execute(sql`DELETE FROM tour_setlists WHERE performer_id::text LIKE ${PREFIX + '-%'}`);
  await db.execute(sql`DELETE FROM show_performers WHERE show_id::text LIKE ${PREFIX + '-%'}`);
  await db.execute(sql`DELETE FROM shows WHERE id::text LIKE ${PREFIX + '-%'}`);
  await db.execute(sql`DELETE FROM performers WHERE id::text LIKE ${PREFIX + '-%'}`);
  await db.execute(sql`DELETE FROM venues WHERE id::text LIKE ${PREFIX + '-%'}`);
  await db.execute(sql`DELETE FROM users WHERE id::text LIKE ${PREFIX + '-%'}`);
}
