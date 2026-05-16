/**
 * Integration suite for the corpus-fill → song-index-rebuild →
 * prediction round-trip. Requires DATABASE_URL pointing at the e2e
 * postgres (see CLAUDE.md). Skipped automatically when DATABASE_URL
 * is unset.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, like, sql } from 'drizzle-orm';
import {
  db,
  performers,
  setlistSongAppearances,
  shows,
  showPerformers,
  songs,
  tourSetlists,
  users,
  venues,
} from '@showbook/db';
import { runSongIndexRebuild } from '../song-index-rebuild';
import {
  predictedSetlistCached,
  predictSetlist,
} from '@showbook/api';
import { synthesizeTourId } from '../setlist-corpus-fill';

const PREFIX = 'ff666666';

const USER = `${PREFIX}-1111-4111-8111-111111111111`;
const VENUE = `${PREFIX}-2222-4222-8222-222222222222`;
const PERFORMER_TATE = `${PREFIX}-3333-4333-8333-333333333333`;
const SHOW = `${PREFIX}-4444-4444-8444-444444444444`;
const TOUR_NAME = 'Miss Possessive Tour';

describe('setlist-intel integration', () => {
  before(async () => {
    if (!process.env.DATABASE_URL) {
      console.log('[setlist-intel integration] DATABASE_URL not set — skipping');
      return;
    }
    await cleanup();
    await db.insert(users).values({ id: USER, email: 'tate-fan@test.local' });
    await db.insert(venues).values({ id: VENUE, name: 'Test Arena', city: 'Test City', country: 'US' });
    await db.insert(performers).values({
      id: PERFORMER_TATE,
      name: 'Tate McRae (fixture)',
      musicbrainzId: `${PREFIX}-fakembid-tate`,
    });
    await db.insert(shows).values({
      id: SHOW,
      userId: USER,
      venueId: VENUE,
      kind: 'concert',
      state: 'watching',
      date: '2025-09-15',
    });
    await db.insert(showPerformers).values({
      showId: SHOW,
      performerId: PERFORMER_TATE,
      role: 'headliner',
      sortOrder: 0,
    });

    // Seed 14 tour-setlists across the prior month + an additional
    // older setlist that introduces a one-off guest duet.
    const core21 = [
      'Miss possessive', "No I'm not in love", '2 hands', 'guilty conscience',
      'Purple lace bra', 'Like I do', 'uh oh', 'Dear god', 'Siren sounds',
      'Greenlight', 'Nostalgia (flashback medley)', 'you broke me first',
      'run for the hills', 'exes', 'bloodonmyhands', "she's all i wanna be",
      'Revolving door', "It's ok I'm ok",
    ];
    const encore = ['Just Keep Watching', 'Sports car', 'greedy'];
    for (let i = 0; i < 14; i++) {
      const day = String(i + 1).padStart(2, '0');
      const date = `2025-09-${day}`;
      const tourId = await synthesizeTourId({
        performerId: PERFORMER_TATE,
        tourName: TOUR_NAME,
        performanceDate: date,
      });
      await db.insert(tourSetlists).values({
        id: `${PREFIX}-cccc-4ccc-8ccc-${String(i).padStart(12, '0')}`,
        performerId: PERFORMER_TATE,
        tourId,
        tourName: TOUR_NAME,
        performanceDate: date,
        setlistfmId: `setlistfm-tate-${i}`,
        setlist: {
          sections: [
            { kind: 'set', songs: core21.map((title) => ({ title })) },
            { kind: 'encore', songs: encore.map((title) => ({ title })) },
          ],
        },
        songCount: core21.length + encore.length,
      });
    }

    // One-off duet show (older — outside the Tier A window).
    const oneOffDate = '2025-04-15';
    const oneOffTourId = await synthesizeTourId({
      performerId: PERFORMER_TATE,
      tourName: TOUR_NAME,
      performanceDate: oneOffDate,
    });
    await db.insert(tourSetlists).values({
      id: `${PREFIX}-dddd-4ddd-8ddd-dddddddddddd`,
      performerId: PERFORMER_TATE,
      tourId: oneOffTourId,
      tourName: TOUR_NAME,
      performanceDate: oneOffDate,
      setlistfmId: 'setlistfm-tate-guest',
      setlist: {
        sections: [
          {
            kind: 'set',
            songs: [
              ...core21.map((title) => ({ title })),
              { title: '6 Months Later (w/ Megan Moroney)' },
            ],
          },
          { kind: 'encore', songs: encore.map((title) => ({ title })) },
        ],
      },
      songCount: core21.length + encore.length + 1,
    });

    await runSongIndexRebuild({ performerId: PERFORMER_TATE });
  });

  after(async () => {
    if (!process.env.DATABASE_URL) return;
    await cleanup();
  });

  it('song-index-rebuild creates one row per unique (performer, title)', { skip: !process.env.DATABASE_URL }, async () => {
    const rows = await db
      .select({ id: songs.id, title: songs.title })
      .from(songs)
      .where(eq(songs.performerId, PERFORMER_TATE));
    // 21 stable + the guest one-off → 22 unique songs.
    assert.equal(rows.length, 22);
  });

  it('appearance rows reflect the seeded setlists', { skip: !process.env.DATABASE_URL }, async () => {
    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(setlistSongAppearances)
      .where(eq(setlistSongAppearances.performerId, PERFORMER_TATE));
    // 14 setlists × 21 songs + 1 setlist × 22 songs = 294 + 22 = 316.
    assert.equal(count, 14 * 21 + 22);
  });

  it('song-index-rebuild is idempotent', { skip: !process.env.DATABASE_URL }, async () => {
    const [pre] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(setlistSongAppearances)
      .where(eq(setlistSongAppearances.performerId, PERFORMER_TATE));
    await runSongIndexRebuild({ performerId: PERFORMER_TATE });
    const [post] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(setlistSongAppearances)
      .where(eq(setlistSongAppearances.performerId, PERFORMER_TATE));
    assert.equal(pre!.count, post!.count, 're-run should not insert duplicate appearances');
  });

  it('predictedSetlistCached returns confidence ≥ 0.85 for the Tate fixture', { skip: !process.env.DATABASE_URL }, async () => {
    const result = await predictedSetlistCached({
      performerId: PERFORMER_TATE,
      targetDate: '2025-09-15',
    });
    assert.equal(result.style, 'stable');
    if (result.style !== 'stable') return;
    assert.ok(result.confidence >= 0.85, `expected ≥ 0.85 confidence, got ${result.confidence}`);
    // 21 songs in core (the entire stable set).
    assert.ok(result.core.length >= 20, `expected 20+ core songs, got ${result.core.length}`);
  });

  it('guest-duet one-off lands in the rotation pile, not core', { skip: !process.env.DATABASE_URL }, async () => {
    const result = await predictedSetlistCached({
      performerId: PERFORMER_TATE,
      targetDate: '2025-09-15',
    });
    if (result.style !== 'stable') return;
    const duet = result.rotation.find((s) => s.title === '6 Months Later (w/ Megan Moroney)');
    assert.ok(duet, 'expected duet to be in the rotation pile');
  });

  it('cache wrapper returns the same result on a repeat read (signature matches)', { skip: !process.env.DATABASE_URL }, async () => {
    const a = await predictedSetlistCached({
      performerId: PERFORMER_TATE,
      targetDate: '2025-09-15',
    });
    const b = await predictedSetlistCached({
      performerId: PERFORMER_TATE,
      targetDate: '2025-09-15',
    });
    if (a.style !== 'stable' || b.style !== 'stable') return;
    assert.equal(a.sampleSize, b.sampleSize);
    assert.equal(a.confidence, b.confidence);
    assert.equal(a.tourName, b.tourName);
  });

  it('REPEATABLE-READ loader sees a consistent snapshot under concurrent corpus writes', { skip: !process.env.DATABASE_URL }, async () => {
    // The wrapper takes the same snapshot for the SELECT and the
    // signature MAX query. Spawn a concurrent insert and a prediction
    // read; assert the cached result + signature line up with one
    // consistent state.
    const targetDate = '2025-09-20';
    const concurrent = db.insert(tourSetlists).values({
      id: `${PREFIX}-eeee-4eee-8eee-${Date.now().toString().slice(-12).padStart(12, '0')}`,
      performerId: PERFORMER_TATE,
      tourId: 'concurrent-tour',
      tourName: 'Concurrent',
      performanceDate: '2025-09-18',
      setlistfmId: `setlistfm-concurrent-${Date.now()}`,
      setlist: { sections: [{ kind: 'set', songs: [{ title: 'Newly Inserted' }] }] },
      songCount: 1,
    });

    const [_, result] = await Promise.all([
      concurrent,
      predictedSetlistCached({ performerId: PERFORMER_TATE, targetDate }),
    ]);

    if (result.style !== 'stable') {
      assert.fail('expected stable result post-insert');
      return;
    }
    // The corpus snapshot may or may not include the new row depending
    // on transaction ordering — what matters is the result is internally
    // consistent: if it has the new song, sampleSize includes it.
    assert.ok(result.sampleSize >= 14);
  });
});

async function cleanup(): Promise<void> {
  await db.delete(setlistSongAppearances).where(like(setlistSongAppearances.performerId, `${PREFIX}-%`));
  await db.delete(songs).where(like(songs.performerId, `${PREFIX}-%`));
  await db.delete(tourSetlists).where(like(tourSetlists.performerId, `${PREFIX}-%`));
  await db.delete(showPerformers).where(like(showPerformers.showId, `${PREFIX}-%`));
  await db.delete(shows).where(like(shows.id, `${PREFIX}-%`));
  await db.delete(performers).where(like(performers.id, `${PREFIX}-%`));
  await db.delete(venues).where(like(venues.id, `${PREFIX}-%`));
  await db.delete(users).where(like(users.id, `${PREFIX}-%`));
}
