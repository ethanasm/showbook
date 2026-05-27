/**
 * Regression test for the `synthesizeAlbumDropRows` SQL query that
 * resolves album track ids to song titles. The original implementation
 * built the IN-clause with `sql\`${col} = ANY(${arr})\``, which spreads
 * a JS array into separate positional parameters and produces
 * `= ANY(($2, $3, ...))` — a RECORD on the right side, which Postgres
 * rejects with `op ANY/ALL (array) requires array on right side`.
 *
 * The bug fired in prod every time a festival lineup performer had an
 * album within the ±60-day window of the show date (May 2026 health
 * email: 4× `setlist.predict.failed` over Bob Moses + Death Cab). It
 * never tripped CI because no test exercised the SQL path against a
 * real Postgres.
 *
 * This test inserts a performer + an album with track ids + matching
 * `songs.spotify_track_id` rows, then calls `synthesizeAlbumDropRows`
 * inside a transaction and asserts the SQL completes and resolves
 * track ids → titles correctly.
 *
 * Run with:
 *   DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e \
 *     pnpm --filter @showbook/api exec node --import tsx --test \
 *     src/__tests__/album-drop-synthetic.integration.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { albums, db, performers, songs } from '@showbook/db';
import { sql } from 'drizzle-orm';
import { synthesizeAlbumDropRows } from '../album-drop-synthetic';
import { fakeUuid, withTimeout } from './_test-helpers';

const PREFIX = 'a1b2c3d4';
const PERFORMER_ID = fakeUuid(PREFIX, 'performer');
const ALBUM_ID = fakeUuid(PREFIX, 'album');
const SPOTIFY_ALBUM_ID = `${PREFIX}-spotify-album`;
const TRACK_IDS = [
  `${PREFIX}-t1`,
  `${PREFIX}-t2`,
  `${PREFIX}-t3`,
];

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM albums WHERE id::text LIKE ${PREFIX + '%'}`);
  await db.execute(sql`DELETE FROM songs WHERE performer_id::text LIKE ${PREFIX + '%'}`);
  await db.execute(sql`DELETE FROM performers WHERE id::text LIKE ${PREFIX + '%'}`);
}

describe('synthesizeAlbumDropRows', () => {
  before(async () => withTimeout(45_000, async () => {
    await cleanup();
    await db.insert(performers).values({
      id: PERFORMER_ID,
      name: `${PREFIX} Synthetic Artist`,
    });
    // Album in the ±60d window of 2026-06-01.
    await db.insert(albums).values({
      id: ALBUM_ID,
      performerId: PERFORMER_ID,
      spotifyAlbumId: SPOTIFY_ALBUM_ID,
      name: 'Window Album',
      releaseDate: '2026-06-15',
      albumType: 'album',
      trackIds: TRACK_IDS,
    });
    // Two of the three album track ids have matching song rows; the
    // third has no Spotify match yet (covers the partial-coverage case).
    await db.insert(songs).values([
      {
        performerId: PERFORMER_ID,
        title: 'Track One',
        spotifyTrackId: TRACK_IDS[0]!,
      },
      {
        performerId: PERFORMER_ID,
        title: 'Track Two',
        spotifyTrackId: TRACK_IDS[1]!,
      },
    ]);
  }));

  after(async () => withTimeout(45_000, cleanup));

  it('runs the spotify_track_id IN-clause without a Postgres array error', async () => {
    const result = await db.transaction(async (tx) => {
      return synthesizeAlbumDropRows({
        performerId: PERFORMER_ID,
        targetDate: '2026-06-01',
        existingCorpus: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tx: tx as any,
      });
    });

    assert.equal(result.length, 1, 'one synthetic row for the in-window album');
    const row = result[0]!;
    assert.equal(row.isSynthetic, true);
    assert.equal(row.syntheticAlbumName, 'Window Album');
    // The synthetic row's setlist should contain the two titles that
    // had matching `songs.spotify_track_id` entries — the third
    // album track id with no song row is silently skipped.
    const titles = row.setlist.sections[0]!.songs.map((s) => s.title).sort();
    assert.deepEqual(titles, ['Track One', 'Track Two']);
  });

  it('skips titles already represented in the existing corpus', async () => {
    const result = await db.transaction(async (tx) => {
      return synthesizeAlbumDropRows({
        performerId: PERFORMER_ID,
        targetDate: '2026-06-01',
        existingCorpus: [
          {
            id: 'existing-1',
            performerId: PERFORMER_ID,
            performanceDate: '2026-05-20',
            tourId: null,
            tourName: null,
            setlist: {
              sections: [{ kind: 'set', songs: [{ title: 'Track One' }] }],
            },
            songCount: 1,
            fetchedAt: new Date(),
          },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tx: tx as any,
      });
    });

    assert.equal(result.length, 1);
    const titles = result[0]!.setlist.sections[0]!.songs.map((s) => s.title);
    assert.deepEqual(titles, ['Track Two']);
  });

  it('returns [] when no album sits within ±60 days of the target', async () => {
    const result = await db.transaction(async (tx) => {
      return synthesizeAlbumDropRows({
        performerId: PERFORMER_ID,
        targetDate: '2027-01-01', // > 60d from 2026-06-15
        existingCorpus: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tx: tx as any,
      });
    });
    assert.deepEqual(result, []);
  });
});
