/**
 * Integration coverage for routers/shows.ts. Hits create / update / delete /
 * list (+filters) / listSlim / listForMap / count / detail /
 * setTicketUrl / updateState / deleteAll plus the announcement-link path.
 *
 * Run with:
 *   DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e \
 *     pnpm --filter @showbook/api exec node --import tsx --test \
 *     src/__tests__/shows.integration.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';
import {
  db,
  shows,
  showAnnouncementLinks,
  announcements,
  enrichmentQueue,
  performers,
  venues,
} from '@showbook/db';
import { eq, inArray, like } from 'drizzle-orm';
import {
  callerFor,
  cleanupByPrefix,
  createTestShow,
  createTestUser,
  createTestVenue,
  fakeUuid,
} from './_test-helpers';

const PREFIX = 'dd111111';

const USER = `${PREFIX}-user`;
const OTHER_USER = `${PREFIX}-other`;
const VENUE = fakeUuid(PREFIX, 'venue');
const VENUE_NO_GEO = fakeUuid(PREFIX, 'vng');

// Pre-seeded shows used by list/filter tests.
const SHOW_PAST = fakeUuid(PREFIX, 'past');
const SHOW_TICKETED = fakeUuid(PREFIX, 'tkt');
const SHOW_THEATRE = fakeUuid(PREFIX, 'thr');
const SHOW_FESTIVAL = fakeUuid(PREFIX, 'fst');
const SHOW_TO_DELETE = fakeUuid(PREFIX, 'del');

// Linked-announcement seeds for announcementLink coverage.
const ANN_ID = fakeUuid(PREFIX, 'ann');
const SHOW_LINKED = fakeUuid(PREFIX, 'linked');
const PERF_FOR_LIST_FOR_MAP = fakeUuid(PREFIX, 'perfmap');

describe('shows router', () => {
  before(async () => {
    await cleanupByPrefix(PREFIX);
    await createTestUser(USER);
    await createTestUser(OTHER_USER);
    await createTestVenue({
      id: VENUE,
      name: `${PREFIX} Venue`,
      city: 'NYC',
      latitude: 40.7,
      longitude: -74,
      stateRegion: 'NY',
    });
    await createTestVenue({
      id: VENUE_NO_GEO,
      name: `${PREFIX} No Geo Venue`,
      city: 'Nowhere',
    });
    // Seeded shows of varying state/kind to exercise list filters.
    await createTestShow({
      id: SHOW_PAST,
      userId: USER,
      venueId: VENUE,
      state: 'past',
      kind: 'concert',
      date: '2023-05-10',
    });
    await createTestShow({
      id: SHOW_TICKETED,
      userId: USER,
      venueId: VENUE,
      state: 'ticketed',
      kind: 'comedy',
      date: '2099-06-15',
    });
    // Theatre row with productionName to exercise listForMap's
    // production-headliner branch.
    await db.insert(shows).values({
      id: SHOW_THEATRE,
      userId: USER,
      venueId: VENUE,
      kind: 'theatre',
      state: 'past',
      date: '2024-04-01',
      productionName: 'Wicked',
    }).onConflictDoNothing();
    // Festival row WITHOUT productionName to exercise the non-production
    // (showPerformer fallback) branch with a performer.
    await db.insert(shows).values({
      id: SHOW_FESTIVAL,
      userId: USER,
      venueId: VENUE_NO_GEO,
      kind: 'festival',
      state: 'past',
      date: '2024-07-20',
    }).onConflictDoNothing();

    // Add a headliner performer to the festival row, so
    // listForMap's "best" picker fires.
    await db.insert(performers).values({
      id: PERF_FOR_LIST_FOR_MAP,
      name: `${PREFIX} Festival Headliner`,
      imageUrl: 'https://example.com/img.jpg',
    }).onConflictDoNothing();
    await db.execute(
      // raw insert into showPerformers — couldn't import here without
      // pulling more fixtures; use db schema directly via the helper.
      // Drizzle's insert is preferred when types resolved; here we use SQL.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await import('drizzle-orm')).sql`INSERT INTO show_performers (show_id, performer_id, role, sort_order) VALUES (${SHOW_FESTIVAL}::uuid, ${PERF_FOR_LIST_FOR_MAP}::uuid, 'headliner'::performer_role, 0) ON CONFLICT DO NOTHING`,
    );
    // Also a non-headliner performer on PAST show to exercise tier=2.
    await db.execute(
      (await import('drizzle-orm')).sql`INSERT INTO show_performers (show_id, performer_id, role, sort_order) VALUES (${SHOW_PAST}::uuid, ${PERF_FOR_LIST_FOR_MAP}::uuid, 'support'::performer_role, 1) ON CONFLICT DO NOTHING`,
    );

    // Linked announcement (multi-night run) for announcementLink coverage.
    await db.insert(announcements).values({
      id: ANN_ID,
      venueId: VENUE,
      kind: 'theatre',
      headliner: 'Run Headliner',
      productionName: 'Hamilton',
      showDate: '2099-08-01',
      runStartDate: '2099-08-01',
      runEndDate: '2099-08-10',
      performanceDates: ['2099-08-01', '2099-08-02', '2099-08-03'],
      onSaleStatus: 'on_sale',
      source: 'ticketmaster',
    }).onConflictDoNothing();
    await createTestShow({
      id: SHOW_LINKED,
      userId: USER,
      venueId: VENUE,
      kind: 'theatre',
      state: 'watching',
      date: '2099-08-01',
    });
    await db.insert(showAnnouncementLinks).values({
      showId: SHOW_LINKED,
      announcementId: ANN_ID,
    }).onConflictDoNothing();

    await createTestShow({
      id: SHOW_TO_DELETE,
      userId: USER,
      venueId: VENUE,
      state: 'past',
      kind: 'concert',
      date: '2022-01-01',
    });
  });

  after(async () => {
    // matchOrCreateVenue / matchOrCreatePerformer create rows with random
    // UUIDs that don't match our prefix. Clean those up by userId / name
    // pattern. Order: shows -> announcements (FK to venue) -> performers
    // -> venues. cleanupByPrefix runs after to mop up the prefixed rows.
    await db.delete(shows).where(inArray(shows.userId, [USER, OTHER_USER, `${PREFIX}-iso`]));
    await db.delete(announcements).where(eq(announcements.id, ANN_ID));
    await db.delete(performers).where(like(performers.name, `${PREFIX}%`));
    await db.delete(venues).where(like(venues.name, `${PREFIX}%`));
    await cleanupByPrefix(PREFIX);
  });

  it('list returns user shows ordered by date desc', async () => {
    const result = await callerFor(USER).shows.list({});
    const ours = result.filter((r) => r.id.startsWith(PREFIX));
    assert.ok(ours.length >= 5);
    // Date desc ordering
    for (let i = 1; i < ours.length; i++) {
      const prev = ours[i - 1].date ?? '0000-00-00';
      const cur = ours[i].date ?? '0000-00-00';
      assert.ok(prev >= cur, `expected ${prev} >= ${cur}`);
    }
  });

  it('list filters by state, kind, year', async () => {
    const stateFiltered = await callerFor(USER).shows.list({ state: 'ticketed' });
    assert.ok(stateFiltered.every((s) => s.state === 'ticketed'));
    const kindFiltered = await callerFor(USER).shows.list({ kind: 'theatre' });
    assert.ok(kindFiltered.every((s) => s.kind === 'theatre'));
    const yearFiltered = await callerFor(USER).shows.list({ year: 2023 });
    assert.ok(yearFiltered.every((s) => (s.date ?? '').startsWith('2023')));
  });

  it('listSlim returns shape { id, date, kind, state, performerIds }', async () => {
    const slim = await callerFor(USER).shows.listSlim();
    const oursPast = slim.find((s) => s.id === SHOW_PAST);
    assert.ok(oursPast);
    assert.ok(Array.isArray(oursPast!.performerIds));
    assert.ok(oursPast!.performerIds.includes(PERF_FOR_LIST_FOR_MAP));
  });

  it('listSlim returns [] for a user with no shows', async () => {
    const slim = await callerFor(OTHER_USER).shows.listSlim();
    assert.deepEqual(slim, []);
  });

  it('listForMap denormalizes headliner correctly', async () => {
    const map = await callerFor(USER).shows.listForMap();
    const theatre = map.find((s) => s.id === SHOW_THEATRE);
    assert.equal(theatre!.headlinerName, 'Wicked');
    assert.equal(theatre!.headlinerId, null);
    assert.equal(theatre!.headlinerImageUrl, null);

    const festival = map.find((s) => s.id === SHOW_FESTIVAL);
    // No productionName on the festival row -> falls into best-performer branch.
    assert.equal(festival!.headlinerName, `${PREFIX} Festival Headliner`);
    assert.equal(festival!.headlinerId, PERF_FOR_LIST_FOR_MAP);
    assert.equal(festival!.headlinerImageUrl, 'https://example.com/img.jpg');
  });

  it('listForMap returns [] when user has no shows', async () => {
    const map = await callerFor(OTHER_USER).shows.listForMap();
    assert.deepEqual(map, []);
  });

  it('count returns the number of user shows', async () => {
    const c = await callerFor(USER).shows.count();
    assert.ok(c >= 5);
  });

  it('count returns 0 for a user with no shows', async () => {
    const c = await callerFor(OTHER_USER).shows.count();
    assert.equal(c, 0);
  });

  it('detail returns a show with relations', async () => {
    const d = await callerFor(USER).shows.detail({ showId: SHOW_PAST });
    assert.equal(d.id, SHOW_PAST);
    assert.ok(d.venue);
  });

  it('detail rejects unknown showId', async () => {
    await assert.rejects(
      () => callerFor(USER).shows.detail({ showId: '00000000-0000-0000-0000-000000000000' }),
      (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
    );
  });

  it('announcementLink returns null for show with no link', async () => {
    const result = await callerFor(USER).shows.announcementLink({ showId: SHOW_PAST });
    assert.equal(result, null);
  });

  it('announcementLink returns link details for a show with one', async () => {
    const result = await callerFor(USER).shows.announcementLink({ showId: SHOW_LINKED });
    assert.ok(result);
    assert.equal(result!.announcementId, ANN_ID);
    assert.equal(result!.productionName, 'Hamilton');
    assert.deepEqual(result!.performanceDates, ['2099-08-01', '2099-08-02', '2099-08-03']);
  });

  it('announcementLink returns null when caller is not the owner', async () => {
    const result = await callerFor(OTHER_USER).shows.announcementLink({ showId: SHOW_LINKED });
    assert.equal(result, null);
  });

  it('create makes a new show via the venue/performer matchers', async () => {
    const created = await callerFor(USER).shows.create({
      kind: 'concert',
      headliner: { name: `${PREFIX} New Headliner` },
      venue: {
        name: `${PREFIX} Venue`,
        city: 'NYC',
        country: 'US',
      },
      // Past date so we don't trigger TM ticket-url enrichment.
      date: '2022-09-09',
      ticketCount: 1,
    });
    assert.ok(created);
    assert.equal(created!.kind, 'concert');
    assert.equal(created!.state, 'past');
    assert.ok(created!.showPerformers.length >= 1);
  });

  it('create can include support performers and a setlist', async () => {
    const created = await callerFor(USER).shows.create({
      kind: 'concert',
      headliner: {
        name: `${PREFIX} Setlist Headliner`,
        setlist: {
          sections: [
            {
              kind: 'set',
              songs: [{ title: 'Song 1' }, { title: 'Song 2' }],
            },
          ],
        },
      },
      venue: {
        name: `${PREFIX} Venue`,
        city: 'NYC',
      },
      date: '2022-10-10',
      ticketCount: 2,
      seat: 'GA',
      pricePaid: '50.00',
      tourName: 'Tour 2022',
      notes: 'A great show',
      sourceRefs: { foo: 'bar' },
      performers: [
        {
          name: `${PREFIX} Support Act`,
          role: 'support',
          sortOrder: 1,
          setlist: {
            sections: [
              {
                kind: 'set',
                songs: [{ title: 'Opener' }],
              },
            ],
          },
        },
      ],
    });
    assert.ok(created);
    assert.equal(created!.kind, 'concert');
    assert.equal(created!.state, 'past');
    assert.ok(created!.showPerformers.length >= 2);
    assert.ok(created!.setlists);
    // Past concert created WITH an inline setlist should NOT be queued for
    // enrichment — the create-time queue is for setlistless past concerts.
    const inlineQueueRows = await db
      .select()
      .from(enrichmentQueue)
      .where(eq(enrichmentQueue.showId, created!.id));
    assert.equal(inlineQueueRows.length, 0, 'inline-setlist past concerts should not be queued');
  });

  it('inline setlist on shows.create gets indexed into setlist_song_appearances so songBadges reads MIN(date) immediately, and adding an EARLIER show flips firstTime off on the later show', async () => {
    // Regression: the prod bug was "added Bon Iver 2018 → songs marked 🆕
    // 'Your first'; added Bon Iver 2016 (same songs) → 2018 still showed
    // 🆕." Root cause: shows.create wrote shows.setlists but never
    // populated setlist_song_appearances, so the read-time MIN query
    // never saw the earlier date. This test pins the fix in place: both
    // shows.create calls run the inline song-index rebuild, and the
    // song-badges resolver naturally picks up the earlier date.
    //
    // Pre-set a googlePlaceId + photoUrl on the venue so shows.create's
    // lazy geocode backfill (Google Places → Nominatim) doesn't fire on
    // each call — those hop external services that hang in CI without
    // network/keys and would blow the 60s per-test budget.
    await db
      .update(venues)
      .set({ googlePlaceId: `${PREFIX}-fake-place`, photoUrl: 'https://example.com/p.jpg' })
      .where(eq(venues.id, VENUE));
    const performerName = `${PREFIX} Bon Iver Regression`;
    const caller = callerFor(USER);

    // Step 1 — add the LATER show first. Songs A + B + C all played.
    const laterShow = await caller.shows.create({
      kind: 'concert',
      headliner: {
        name: performerName,
        setlist: {
          sections: [
            {
              kind: 'set',
              songs: [
                { title: 'Skinny Love' },
                { title: 'Holocene' },
                { title: '666 ʇ' }, // 2018-only song
              ],
            },
          ],
        },
      },
      venue: { name: `${PREFIX} Venue`, city: 'NYC' },
      date: '2018-09-10',
      ticketCount: 1,
    });
    assert.ok(laterShow);

    // The 2018 show, in isolation, should show 🆕 "Your first" for every
    // song — they're all first-time-heard at this point in the user's
    // history. This is the baseline that the prod bug also showed.
    const laterBadgesBefore = await caller.shows.songBadges({
      showId: laterShow!.id,
    });
    const skinnyId = laterBadgesBefore.titleToSongId['skinny love'];
    const holoceneId = laterBadgesBefore.titleToSongId['holocene'];
    const sixId = laterBadgesBefore.titleToSongId['666 ʇ'];
    assert.ok(skinnyId, 'song-index rebuild should have created the song row');
    assert.ok(holoceneId);
    assert.ok(sixId);
    assert.equal(
      laterBadgesBefore.badges[skinnyId]?.firstTime,
      true,
      'skinny love is first-time before the 2016 show is added',
    );
    assert.equal(laterBadgesBefore.badges[holoceneId]?.firstTime, true);
    assert.equal(laterBadgesBefore.badges[sixId]?.firstTime, true);

    // Step 2 — add the EARLIER show. Shared songs A + B, plus a 2016-
    // only song D. The performer is resolved by name match so this
    // attaches to the same performer row.
    const earlierShow = await caller.shows.create({
      kind: 'concert',
      headliner: {
        name: performerName,
        setlist: {
          sections: [
            {
              kind: 'set',
              songs: [
                { title: 'Skinny Love' },
                { title: 'Holocene' },
                { title: 'Flume' }, // 2016-only song
              ],
            },
          ],
        },
      },
      venue: { name: `${PREFIX} Venue`, city: 'NYC' },
      date: '2016-06-04',
      ticketCount: 1,
    });
    assert.ok(earlierShow);

    // Step 3 — re-read badges for the LATER show. The songs shared with
    // 2016 should NO LONGER be marked firstTime; the 2018-only song
    // still is.
    const laterBadgesAfter = await caller.shows.songBadges({
      showId: laterShow!.id,
    });
    assert.equal(
      laterBadgesAfter.badges[skinnyId]?.firstTime ?? false,
      false,
      'BUG REGRESSION: adding the 2016 show must flip 2018 firstTime OFF for shared songs',
    );
    assert.equal(
      laterBadgesAfter.badges[holoceneId]?.firstTime ?? false,
      false,
      'BUG REGRESSION: shared song should not stay flagged on the later show',
    );
    // The 2018-only song retains its first-time flag because nothing
    // earlier in the user's history has it.
    assert.equal(
      laterBadgesAfter.badges[sixId]?.firstTime,
      true,
      'the song that only appears in 2018 should still be firstTime',
    );

    // Step 4 — the EARLIER show should itself report firstTime for all
    // three songs (it's the earliest occurrence the user has of each).
    const earlierBadges = await caller.shows.songBadges({
      showId: earlierShow!.id,
    });
    const flumeId = earlierBadges.titleToSongId['flume'];
    assert.ok(flumeId);
    assert.equal(earlierBadges.badges[skinnyId]?.firstTime, true);
    assert.equal(earlierBadges.badges[holoceneId]?.firstTime, true);
    assert.equal(earlierBadges.badges[flumeId]?.firstTime, true);
  });

  it('shows.update writing a new setlist re-indexes immediately so songBadges reflects the change without waiting for the nightly corpus refresh', async () => {
    // The update path used to leak the same bug as create: it overwrote
    // shows.setlists but didn't touch setlist_song_appearances, so the
    // newly-edited setlist's songs would render plain until the next
    // corpus-fill cron. This test exercises the bare update path.
    await db
      .update(venues)
      .set({ googlePlaceId: `${PREFIX}-fake-place`, photoUrl: 'https://example.com/p.jpg' })
      .where(eq(venues.id, VENUE));
    const performerName = `${PREFIX} Update Index Performer`;
    const caller = callerFor(USER);
    const initial = await caller.shows.create({
      kind: 'concert',
      headliner: { name: performerName, setlist: { sections: [
        { kind: 'set', songs: [{ title: 'Old Song A' }] },
      ] } },
      venue: { name: `${PREFIX} Venue`, city: 'NYC' },
      date: '2024-02-02',
      ticketCount: 1,
    });
    assert.ok(initial);

    // Look up the headliner id so we can write a setlist via update.
    const headlinerSp = initial!.showPerformers.find(
      (sp) => sp.role === 'headliner',
    );
    assert.ok(headlinerSp, 'expected a headliner row');
    const performerId = headlinerSp!.performerId;

    // Replace the setlist via setSetlist (the dedicated mutation that
    // the Setlist tab's edit flow uses).
    await caller.shows.setSetlist({
      showId: initial!.id,
      performerId,
      setlist: {
        sections: [
          {
            kind: 'set',
            songs: [{ title: 'Brand New Song X' }],
          },
        ],
      },
    });

    // The fresh setlist should be indexed; songBadges resolves the song
    // and flags it as firstTime (this user has never heard Song X
    // anywhere else). Without the inline indexer, the badge query
    // would return empty.
    const badges = await caller.shows.songBadges({ showId: initial!.id });
    const songXId = badges.titleToSongId['brand new song x'];
    assert.ok(
      songXId,
      'setSetlist must trigger the indexer so the new song is discoverable',
    );
    assert.equal(badges.badges[songXId]?.firstTime, true);
    // The old song should NOT appear (it was replaced; its appearance
    // row was deleted by the rebuild's idempotent DELETE-then-INSERT).
    const oldId = badges.titleToSongId['old song a'];
    if (oldId !== undefined) {
      // The songs row stays around (it's an upsert), but the appearance
      // row for this show should be gone — so the title→songId map for
      // the show must not contain it.
      assert.fail(
        'replaced song still indexed for this show; rebuild did not clean up',
      );
    }
  });

  it('clearing a setlist via setSetlist({ sections: [] }) wipes the appearance index so old songs disappear from songBadges (edge case: shows.setlists becomes null)', async () => {
    // Edge case: when the only performer's setlist is cleared, the
    // show's `setlists` JSONB becomes null. The indexer's
    // `loadAttendedSources` filters by `isNotNull(shows.setlists)`, so
    // the wipe wouldn't reach the DELETE step without the
    // showIds-scoped union (see song-index-rebuild.ts:347). This test
    // pins that union in place.
    await db
      .update(venues)
      .set({ googlePlaceId: `${PREFIX}-fake-place`, photoUrl: 'https://example.com/p.jpg' })
      .where(eq(venues.id, VENUE));
    const performerName = `${PREFIX} Wipe Index Performer`;
    const caller = callerFor(USER);
    const created = await caller.shows.create({
      kind: 'concert',
      headliner: {
        name: performerName,
        setlist: { sections: [
          { kind: 'set', songs: [{ title: 'Will Be Cleared' }] },
        ] },
      },
      venue: { name: `${PREFIX} Venue`, city: 'NYC' },
      date: '2024-03-03',
      ticketCount: 1,
    });
    assert.ok(created);

    // Sanity: the song is indexed and discoverable.
    const before = await caller.shows.songBadges({ showId: created!.id });
    const willBeClearedId = before.titleToSongId['will be cleared'];
    assert.ok(willBeClearedId, 'precondition: song should be indexed first');

    // Wipe the setlist (no sections). cleanSetlist returns null →
    // setSetlist removes the performer key → setlists becomes null
    // (single-headliner show).
    const headlinerSp = created!.showPerformers.find(
      (sp) => sp.role === 'headliner',
    );
    assert.ok(headlinerSp);
    await caller.shows.setSetlist({
      showId: created!.id,
      performerId: headlinerSp!.performerId,
      setlist: { sections: [] },
    });

    // The badges resolver should return an empty map — there are no
    // appearance rows for this show after the wipe.
    const after = await caller.shows.songBadges({ showId: created!.id });
    assert.deepEqual(after.badges, {});
    assert.deepEqual(after.titleToSongId, {});
  });

  it('create falls back to setlist enrichment queue when inline setlist.fm lookup misses', async () => {
    // The inline lookup runs against setlist.fm with a fake performer name —
    // setlist.fm returns no matching artist (or the call throws when
    // SETLISTFM_API_KEY is unset in CI) and the create handler falls back to
    // enqueuing the show for retry. Either way the queue row is the assertion
    // that the Gmail-import gap is closed.
    const created = await callerFor(USER).shows.create({
      kind: 'concert',
      headliner: { name: `${PREFIX} Setlistless Headliner` },
      venue: { name: `${PREFIX} Venue`, city: 'NYC' },
      date: '2022-12-01',
      ticketCount: 1,
    });
    assert.ok(created);
    assert.equal(created!.state, 'past');
    const queueRows = await db
      .select()
      .from(enrichmentQueue)
      .where(eq(enrichmentQueue.showId, created!.id));
    assert.equal(queueRows.length, 1, 'past concert should be queued for setlist enrichment');
    assert.equal(queueRows[0].type, 'setlist');
    assert.equal(queueRows[0].attempts, 0);
  });

  it('create theatre uses production name as title', async () => {
    const created = await callerFor(USER).shows.create({
      kind: 'theatre',
      headliner: { name: 'Some Show' },
      venue: { name: `${PREFIX} Venue`, city: 'NYC' },
      date: '2022-11-11',
      ticketCount: 1,
    });
    assert.ok(created);
    assert.equal(created!.kind, 'theatre');
    assert.equal(created!.productionName, 'Some Show');
    // Theatre shows should NOT enqueue setlist enrichment — theatre
    // productions don't have setlists.
    const theatreQueueRows = await db
      .select()
      .from(enrichmentQueue)
      .where(eq(enrichmentQueue.showId, created!.id));
    assert.equal(theatreQueueRows.length, 0, 'theatre shows should not be queued');
  });


  it('update mutates an existing show', async () => {
    const updated = await callerFor(USER).shows.update({
      showId: SHOW_TICKETED,
      kind: 'comedy',
      headliner: { name: `${PREFIX} Renamed Headliner` },
      venue: { name: `${PREFIX} Venue`, city: 'NYC' },
      date: '2099-06-15',
      ticketCount: 1,
      seat: 'A1',
      pricePaid: '20.00',
      notes: 'updated notes',
    });
    assert.ok(updated);
    assert.equal(updated!.notes, 'updated notes');
    assert.equal(updated!.seat, 'A1');
  });

  it('update reorders festival lineup and promotes a support artist to headliner', async () => {
    // Regression: editing a festival to reorder the lineup AND change a
    // performer's tier simultaneously used to fail with an FK violation
    // on show_performers.performer_id. shows.update DELETE-then-INSERTs
    // the lineup inside a single transaction; the orphan-cleanup AFTER
    // DELETE trigger fired between the two statements and removed any
    // performers that had no other references (typical for festival
    // support acts that nobody follows), so the subsequent INSERT
    // referenced rows that had just been deleted. The 0049 migration
    // defers that trigger to COMMIT to fix the race.
    const festivalId = fakeUuid(PREFIX, 'fest-edit');
    await createTestShow({
      id: festivalId,
      userId: USER,
      venueId: VENUE,
      kind: 'festival',
      state: 'past',
      date: '2024-09-20',
    });
    // Seed an initial lineup with several support performers that
    // nothing else references (no follows, no announcements, no media
    // tags). This is the exact shape that previously triggered the
    // orphan cleanup mid-transaction.
    const initial = await callerFor(USER).shows.update({
      showId: festivalId,
      kind: 'festival',
      headliner: { name: `${PREFIX} Edit Festival` },
      venue: { name: `${PREFIX} Venue`, city: 'NYC' },
      date: '2024-09-20',
      ticketCount: 1,
      productionName: `${PREFIX} Edit Festival`,
      performers: [
        { name: `${PREFIX} Edit Artist A`, role: 'support', sortOrder: 1 },
        { name: `${PREFIX} Edit Artist B`, role: 'support', sortOrder: 2 },
        { name: `${PREFIX} Edit Artist C`, role: 'support', sortOrder: 3 },
        { name: `${PREFIX} Edit Artist D`, role: 'support', sortOrder: 4 },
      ],
    });
    assert.ok(initial);

    // Now do what the mobile edit screen does on save: promote one
    // support artist to headliner AND reorder the rest. Every row's
    // role/sortOrder shifts, so every show_performers row is rewritten.
    const reordered = await callerFor(USER).shows.update({
      showId: festivalId,
      kind: 'festival',
      headliner: { name: `${PREFIX} Edit Festival` },
      venue: { name: `${PREFIX} Venue`, city: 'NYC' },
      date: '2024-09-20',
      ticketCount: 1,
      productionName: `${PREFIX} Edit Festival`,
      performers: [
        { name: `${PREFIX} Edit Artist A`, role: 'headliner', sortOrder: 1 },
        { name: `${PREFIX} Edit Artist C`, role: 'support', sortOrder: 2 },
        { name: `${PREFIX} Edit Artist B`, role: 'support', sortOrder: 3 },
        { name: `${PREFIX} Edit Artist D`, role: 'support', sortOrder: 4 },
      ],
    });
    assert.ok(reordered);
    // Festivals carry their name on shows.production_name only; the
    // four lineup rows are the only show_performers we expect.
    assert.equal(reordered!.showPerformers.length, 4);
    assert.ok(
      !reordered!.showPerformers.some(
        (sp) => sp.performer.name === `${PREFIX} Edit Festival`,
      ),
      'editing a festival should not spawn a performer named after the festival',
    );
    const promoted = reordered!.showPerformers.find(
      (sp) => sp.performer.name === `${PREFIX} Edit Artist A`,
    );
    assert.ok(promoted);
    assert.equal(promoted!.role, 'headliner');
  });

  it('update does not create a synthetic festival-name headliner when editing only the venue', async () => {
    // Regression for the Bottlerock bug: a user edits just the venue
    // of a festival and the round-trip used to insert a phantom
    // headliner performer whose name was the festival name, which
    // then showed up at the top of the lineup card on the show
    // detail screen. The fix skips the headliner-performer insert
    // for festivals entirely (the festival name lives on
    // shows.production_name).
    const festivalId = fakeUuid(PREFIX, 'fest-venue-only');
    await createTestShow({
      id: festivalId,
      userId: USER,
      venueId: VENUE,
      kind: 'festival',
      state: 'watching',
      date: '2099-05-22',
    });
    // Seed a clean lineup (no synthetic headliner) via shows.update.
    await callerFor(USER).shows.update({
      showId: festivalId,
      kind: 'festival',
      headliner: { name: `${PREFIX} Bottlerock` },
      venue: { name: `${PREFIX} Venue`, city: 'NYC' },
      date: '2099-05-22',
      ticketCount: 1,
      productionName: `${PREFIX} Bottlerock`,
      performers: [
        { name: `${PREFIX} Lorde`, role: 'headliner', sortOrder: 1 },
        { name: `${PREFIX} Teddy Swims`, role: 'support', sortOrder: 2 },
      ],
    });
    // Now edit the venue (everything else stays the same — mirrors
    // what the mobile edit screen sends when the user only changed
    // the venue field).
    const updated = await callerFor(USER).shows.update({
      showId: festivalId,
      kind: 'festival',
      headliner: { name: `${PREFIX} Bottlerock` },
      venue: { name: `${PREFIX} Different Venue`, city: 'Napa' },
      date: '2099-05-22',
      ticketCount: 1,
      productionName: `${PREFIX} Bottlerock`,
      performers: [
        { name: `${PREFIX} Lorde`, role: 'headliner', sortOrder: 1 },
        { name: `${PREFIX} Teddy Swims`, role: 'support', sortOrder: 2 },
      ],
    });
    assert.ok(updated);
    assert.equal(updated!.productionName, `${PREFIX} Bottlerock`);
    assert.equal(updated!.showPerformers.length, 2);
    assert.ok(
      !updated!.showPerformers.some(
        (sp) => sp.performer.name === `${PREFIX} Bottlerock`,
      ),
      'venue edit must not spawn a festival-name headliner performer',
    );
    const lorde = updated!.showPerformers.find(
      (sp) => sp.performer.name === `${PREFIX} Lorde`,
    );
    assert.ok(lorde);
    assert.equal(lorde!.role, 'headliner');
  });

  it('create does not create a synthetic festival-name headliner', async () => {
    // Bookend to the update regression above: the bug also fired on
    // the initial create path. shows.create must skip the headliner
    // performer insert for kind='festival' so production_name is the
    // sole carrier of the festival name.
    const created = await callerFor(USER).shows.create({
      kind: 'festival',
      headliner: { name: `${PREFIX} Bottlerock Create` },
      venue: { name: `${PREFIX} Venue`, city: 'NYC' },
      date: '2099-05-23',
      ticketCount: 1,
      productionName: `${PREFIX} Bottlerock Create`,
      performers: [
        { name: `${PREFIX} Lorde Create`, role: 'headliner', sortOrder: 1 },
        { name: `${PREFIX} Teddy Create`, role: 'support', sortOrder: 2 },
      ],
    });
    assert.ok(created);
    assert.equal(created!.productionName, `${PREFIX} Bottlerock Create`);
    assert.equal(created!.showPerformers.length, 2);
    assert.ok(
      !created!.showPerformers.some(
        (sp) => sp.performer.name === `${PREFIX} Bottlerock Create`,
      ),
      'shows.create must not spawn a festival-name headliner performer',
    );
  });

  it('update preserves existing per-performer setlists when the lineup is edited without echoing them back', async () => {
    // Regression for the Bottlerock bug: background `setlist-retry`
    // enriches `shows.setlists` keyed by performerId asynchronously.
    // When the user later edits the lineup (e.g. swaps a support
    // artist) the mobile client doesn't echo the existing setlists in
    // its update payload — and the route used to write `setlists =
    // null` on every edit, blowing away the enriched data. Lineup
    // members who survive the edit must keep their setlists; performers
    // removed from the lineup lose theirs; freshly-added performers
    // start without one and let setlist-retry enrich them.
    const festivalId = fakeUuid(PREFIX, 'fest-preserve-setlists');
    await createTestShow({
      id: festivalId,
      userId: USER,
      venueId: VENUE,
      kind: 'festival',
      state: 'past',
      date: '2099-05-22',
    });
    // Seed the initial lineup: Lorde (headliner) + Natasha (support).
    const HEADLINER = `${PREFIX} Preserve Lorde`;
    const REMOVED = `${PREFIX} Preserve Natasha`;
    const ADDED = `${PREFIX} Preserve Chaka`;
    await callerFor(USER).shows.update({
      showId: festivalId,
      kind: 'festival',
      headliner: { name: `${PREFIX} Preserve Fest` },
      venue: { name: `${PREFIX} Venue`, city: 'NYC' },
      date: '2099-05-22',
      ticketCount: 1,
      productionName: `${PREFIX} Preserve Fest`,
      performers: [
        { name: HEADLINER, role: 'headliner', sortOrder: 1 },
        { name: REMOVED, role: 'support', sortOrder: 2 },
      ],
    });

    // Look up the performer IDs so we can simulate setlist-retry
    // landing per-performer entries.
    const lordeRow = await db
      .select({ id: performers.id })
      .from(performers)
      .where(eq(performers.name, HEADLINER))
      .limit(1);
    const natashaRow = await db
      .select({ id: performers.id })
      .from(performers)
      .where(eq(performers.name, REMOVED))
      .limit(1);
    assert.ok(lordeRow[0] && natashaRow[0]);
    const lordeId = lordeRow[0].id;
    const natashaId = natashaRow[0].id;

    const lordeSetlist = {
      sections: [
        { kind: 'set' as const, songs: [{ title: 'Royals' }, { title: 'Green Light' }] },
      ],
    };
    const natashaSetlist = {
      sections: [
        { kind: 'set' as const, songs: [{ title: 'Unwritten' }] },
      ],
    };
    await db
      .update(shows)
      .set({
        setlists: { [lordeId]: lordeSetlist, [natashaId]: natashaSetlist },
      })
      .where(eq(shows.id, festivalId));

    // Now do the lineup swap: keep Lorde, drop Natasha, add Chaka Khan.
    // The mobile client does not echo setlist data in this payload —
    // it just sends the new lineup.
    await callerFor(USER).shows.update({
      showId: festivalId,
      kind: 'festival',
      headliner: { name: `${PREFIX} Preserve Fest` },
      venue: { name: `${PREFIX} Venue`, city: 'NYC' },
      date: '2099-05-22',
      ticketCount: 1,
      productionName: `${PREFIX} Preserve Fest`,
      performers: [
        { name: HEADLINER, role: 'headliner', sortOrder: 1 },
        { name: ADDED, role: 'support', sortOrder: 2 },
      ],
    });

    const [after] = await db
      .select({ setlists: shows.setlists })
      .from(shows)
      .where(eq(shows.id, festivalId))
      .limit(1);
    assert.ok(after.setlists, 'setlists JSONB must survive the lineup swap');
    assert.deepEqual(
      after.setlists[lordeId],
      lordeSetlist,
      "Lorde's setlist must be preserved across the edit",
    );
    assert.ok(
      !(natashaId in after.setlists),
      "Natasha was removed from the lineup — her setlist key should be dropped",
    );
    const chakaRow = await db
      .select({ id: performers.id })
      .from(performers)
      .where(eq(performers.name, ADDED))
      .limit(1);
    assert.ok(chakaRow[0]);
    assert.ok(
      !(chakaRow[0].id in after.setlists),
      'newly-added performer must not have a setlist key — that gets filled by setlist-retry',
    );
  });

  it('update rejects unknown showId', async () => {
    await assert.rejects(
      () => callerFor(USER).shows.update({
        showId: '00000000-0000-0000-0000-000000000000',
        kind: 'concert',
        headliner: { name: 'Whatever' },
        venue: { name: `${PREFIX} Venue`, city: 'NYC' },
        date: '2022-01-01',
        ticketCount: 1,
      }),
      (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
    );
  });

  it('setTicketUrl updates a show', async () => {
    const updated = await callerFor(USER).shows.setTicketUrl({
      showId: SHOW_TICKETED,
      ticketUrl: 'https://example.com/tickets',
    });
    assert.equal(updated.ticketUrl, 'https://example.com/tickets');
  });

  it('setTicketUrl rejects unknown showId', async () => {
    await assert.rejects(
      () => callerFor(USER).shows.setTicketUrl({
        showId: '00000000-0000-0000-0000-000000000000',
        ticketUrl: 'https://example.com/x',
      }),
      (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
    );
  });

  it('updateState requires a valid transition', async () => {
    // Already 'past' — no allowed transitions out.
    await assert.rejects(
      () => callerFor(USER).shows.updateState({
        showId: SHOW_PAST,
        newState: 'ticketed',
      }),
      (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
    );
  });

  it('updateState rejects unknown showId', async () => {
    await assert.rejects(
      () => callerFor(USER).shows.updateState({
        showId: '00000000-0000-0000-0000-000000000000',
        newState: 'past',
      }),
      (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
    );
  });

  it('updateState allows watching → ticketed without a seat', async () => {
    const noSeatShow = fakeUuid(PREFIX, 'watching-noseat');
    await createTestShow({
      id: noSeatShow,
      userId: USER,
      venueId: VENUE,
      state: 'watching',
      date: '2099-09-09',
    });
    // No seat — should still succeed (state-only flip).
    const flipped = await callerFor(USER).shows.updateState({
      showId: noSeatShow,
      newState: 'ticketed',
    });
    assert.equal(flipped.state, 'ticketed');
    assert.equal(flipped.seat, null);

    // Optional seat / price / count are still applied when present.
    const withSeat = fakeUuid(PREFIX, 'watching-withseat');
    await createTestShow({
      id: withSeat,
      userId: USER,
      venueId: VENUE,
      state: 'watching',
      date: '2099-09-09',
    });
    const updated = await callerFor(USER).shows.updateState({
      showId: withSeat,
      newState: 'ticketed',
      seat: 'A1',
      pricePaid: '12.00',
      ticketCount: 2,
    });
    assert.equal(updated.state, 'ticketed');
    assert.equal(updated.seat, 'A1');
    assert.equal(updated.ticketCount, 2);

    // ticketed -> past (legitimate transition).
    const past = await callerFor(USER).shows.updateState({
      showId: withSeat,
      newState: 'past',
    });
    assert.equal(past.state, 'past');
  });

  it('addPerformer + removePerformer + setSetlist round-trip', async () => {
    const created = await callerFor(USER).shows.create({
      kind: 'concert',
      headliner: { name: `${PREFIX} Lineup Headliner` },
      venue: { name: `${PREFIX} Venue`, city: 'NYC' },
      date: '2022-12-01',
      ticketCount: 1,
    });
    assert.ok(created);
    const showId = created!.id;
    const headlinerId = created!.showPerformers[0].performerId;

    // Adding a support performer.
    const added = await callerFor(USER).shows.addPerformer({
      showId,
      name: `${PREFIX} Inline Support`,
      role: 'support',
    });
    assert.ok(added.performerId);

    let detail = await callerFor(USER).shows.detail({ showId });
    const supportRow = detail.showPerformers.find(
      (sp) => sp.performerId === added.performerId,
    );
    assert.ok(supportRow);
    assert.equal(supportRow!.role, 'support');

    // Setting a setlist for the headliner — main set + an encore section.
    await callerFor(USER).shows.setSetlist({
      showId,
      performerId: headlinerId,
      setlist: {
        sections: [
          {
            kind: 'set',
            songs: [
              { title: 'Song 1' },
              { title: '  Song 2  ' },
              { title: '   ' },
            ],
          },
          {
            kind: 'encore',
            songs: [{ title: 'Encore A', note: '  crowd singalong  ' }],
          },
        ],
      },
    });
    detail = await callerFor(USER).shows.detail({ showId });
    assert.deepEqual(detail.setlists, {
      [headlinerId]: {
        sections: [
          {
            kind: 'set',
            songs: [{ title: 'Song 1' }, { title: 'Song 2' }],
          },
          {
            kind: 'encore',
            songs: [{ title: 'Encore A', note: 'crowd singalong' }],
          },
        ],
      },
    });

    // setSetlist with empty sections removes only that performer's entry.
    await callerFor(USER).shows.setSetlist({
      showId,
      performerId: added.performerId,
      setlist: {
        sections: [{ kind: 'set', songs: [{ title: 'Opener' }] }],
      },
    });
    await callerFor(USER).shows.setSetlist({
      showId,
      performerId: headlinerId,
      setlist: { sections: [] },
    });
    detail = await callerFor(USER).shows.detail({ showId });
    assert.deepEqual(detail.setlists, {
      [added.performerId]: {
        sections: [{ kind: 'set', songs: [{ title: 'Opener' }] }],
      },
    });

    // Removing a performer also clears their setlist.
    await callerFor(USER).shows.removePerformer({
      showId,
      performerId: added.performerId,
      role: 'support',
    });
    detail = await callerFor(USER).shows.detail({ showId });
    assert.equal(
      detail.showPerformers.find((sp) => sp.performerId === added.performerId),
      undefined,
    );
    assert.equal(detail.setlists, null);
  });

  it('setSetlist rejects performers not on the show', async () => {
    const created = await callerFor(USER).shows.create({
      kind: 'concert',
      headliner: { name: `${PREFIX} Solo Headliner` },
      venue: { name: `${PREFIX} Venue`, city: 'NYC' },
      date: '2022-12-02',
      ticketCount: 1,
    });
    const showId = created!.id;
    const strangerId = fakeUuid(PREFIX, 'stranger');
    await db
      .insert(performers)
      .values({ id: strangerId, name: `${PREFIX} Stranger` })
      .onConflictDoNothing();

    await assert.rejects(
      () =>
        callerFor(USER).shows.setSetlist({
          showId,
          performerId: strangerId,
          setlist: {
            sections: [{ kind: 'set', songs: [{ title: 'oops' }] }],
          },
        }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'BAD_REQUEST',
    );
  });

  it('addPerformer / removePerformer / setSetlist reject unknown showId', async () => {
    const fakeShow = '00000000-0000-0000-0000-000000000000';
    await assert.rejects(
      () =>
        callerFor(USER).shows.addPerformer({
          showId: fakeShow,
          name: 'Nobody',
          role: 'support',
        }),
      (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
    );
    await assert.rejects(
      () =>
        callerFor(USER).shows.removePerformer({
          showId: fakeShow,
          performerId: fakeShow,
          role: 'support',
        }),
      (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
    );
    await assert.rejects(
      () =>
        callerFor(USER).shows.setSetlist({
          showId: fakeShow,
          performerId: fakeShow,
          setlist: { sections: [] },
        }),
      (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
    );
  });

  it('delete removes the show', async () => {
    const result = await callerFor(USER).shows.delete({ showId: SHOW_TO_DELETE });
    assert.deepEqual(result, { success: true });
    const [row] = await db.select().from(shows).where(eq(shows.id, SHOW_TO_DELETE));
    assert.equal(row, undefined);
  });

  it('delete rejects unknown showId', async () => {
    await assert.rejects(
      () => callerFor(USER).shows.delete({ showId: '00000000-0000-0000-0000-000000000000' }),
      (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
    );
  });

  it('deleteAll removes every show for the caller', async () => {
    // Make a separate user with two shows so we don't kill the other tests' fixtures.
    const isolatedUser = `${PREFIX}-iso`;
    const isolatedVenue = fakeUuid(PREFIX, 'isovenue');
    await createTestUser(isolatedUser);
    await createTestVenue({ id: isolatedVenue, name: 'Iso Venue', city: 'X' });
    const s1 = fakeUuid(PREFIX, 'iso1');
    const s2 = fakeUuid(PREFIX, 'iso2');
    await createTestShow({ id: s1, userId: isolatedUser, venueId: isolatedVenue });
    await createTestShow({ id: s2, userId: isolatedUser, venueId: isolatedVenue });
    const result = await callerFor(isolatedUser).shows.deleteAll();
    assert.ok(result.deleted >= 2);
    const remaining = await callerFor(isolatedUser).shows.list({});
    assert.equal(remaining.length, 0);
  });
});
