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

  it('updateState requires seat for watching → ticketed', async () => {
    const tempShow = fakeUuid(PREFIX, 'watching-noseat');
    await createTestShow({
      id: tempShow,
      userId: USER,
      venueId: VENUE,
      state: 'watching',
      date: '2099-09-09',
    });
    await assert.rejects(
      () => callerFor(USER).shows.updateState({
        showId: tempShow,
        newState: 'ticketed',
      }),
      (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
    );
    // Now provide seat — should succeed and update fields.
    const updated = await callerFor(USER).shows.updateState({
      showId: tempShow,
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
      showId: tempShow,
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
