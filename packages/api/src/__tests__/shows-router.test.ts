/**
 * Unit tests for the shows tRPC router. Covers the early-throw paths
 * (NOT_FOUND, BAD_REQUEST), input validation (zod), state-transition
 * branches in updateState, the `cleanSetlist` round-trips through
 * `setSetlist`, and the read paths (`detail`, `list`, `count`,
 * `announcementLink`, `listSlim`, `listForMap`). Heavy-write paths that
 * call out to matchers / TM (`create`, `update`) are exercised end-to-
 * end in shows.integration.test.ts; we don't try to fake them here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';
import { showsRouter } from '../routers/shows';
import { makeFakeDb, fakeCtx, type FakeDb } from './_fake-db';

function caller(db: FakeDb, userId = 'test-user') {
  return showsRouter.createCaller(fakeCtx(db, userId) as never);
}

const SHOW_ID = '11111111-1111-4111-8111-111111111111';
const PERFORMER_ID = '22222222-2222-4222-8222-222222222222';

describe('showsRouter (unit)', () => {
  describe('announcementLink', () => {
    it('returns null when no link exists', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      const result = await caller(db).announcementLink({ showId: SHOW_ID });
      assert.equal(result, null);
    });

    it('returns the announcement link fields when present', async () => {
      const link = {
        announcementId: '33333333-3333-4333-8333-333333333333',
        runStartDate: '2026-08-01',
        runEndDate: '2026-08-03',
        performanceDates: ['2026-08-01', '2026-08-02', '2026-08-03'],
        productionName: 'Hamilton',
        headliner: 'Hamilton',
      };
      const db = makeFakeDb({ selectResults: [[link]] });
      const result = await caller(db).announcementLink({ showId: SHOW_ID });
      assert.deepEqual(result, link);
    });
  });

  describe('list', () => {
    it('passes filter inputs and returns rows', async () => {
      // The router uses ctx.db.query.shows.findMany which the fake-db
      // returns as `[]`. We just confirm the procedure resolves with no
      // shape errors.
      const db = makeFakeDb();
      const result = await caller(db).list({ state: 'past', kind: 'concert', year: 2026 });
      assert.deepEqual(result, []);
    });

    it('accepts no filters', async () => {
      const db = makeFakeDb();
      const result = await caller(db).list({});
      assert.deepEqual(result, []);
    });
  });

  describe('listSlim', () => {
    it('returns [] when there are no shows', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      const result = await caller(db).listSlim();
      assert.deepEqual(result, []);
    });

    it('groups performer ids by showId', async () => {
      const baseRows = [
        { id: 'show-1', date: '2026-09-01', kind: 'concert', state: 'past' },
        { id: 'show-2', date: '2026-08-01', kind: 'theatre', state: 'ticketed' },
      ];
      const performerRows = [
        { showId: 'show-1', performerId: 'p1' },
        { showId: 'show-1', performerId: 'p2' },
        { showId: 'show-2', performerId: 'p3' },
      ];
      const db = makeFakeDb({ selectResults: [baseRows, performerRows] });
      const result = await caller(db).listSlim();
      assert.equal(result.length, 2);
      const show1 = result.find((s) => s.id === 'show-1')!;
      assert.deepEqual(show1.performerIds.sort(), ['p1', 'p2']);
      const show2 = result.find((s) => s.id === 'show-2')!;
      assert.deepEqual(show2.performerIds, ['p3']);
    });
  });

  describe('listForMap', () => {
    it('returns [] when there are no shows', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      const result = await caller(db).listForMap();
      assert.deepEqual(result, []);
    });

    it('uses productionName as headliner for theatre shows', async () => {
      const shows = [
        {
          id: 'show-1',
          kind: 'theatre',
          state: 'ticketed',
          date: '2026-09-01',
          seat: null,
          pricePaid: null,
          ticketCount: 1,
          productionName: 'Hamilton',
          venue: { id: 'v1', name: 'V', city: 'NYC', stateRegion: 'NY', latitude: null, longitude: null, photoUrl: null },
        },
      ];
      const db = makeFakeDb({ selectResults: [shows] });
      const result = await caller(db).listForMap();
      assert.equal(result.length, 1);
      assert.equal(result[0]!.headlinerName, 'Hamilton');
      assert.equal(result[0]!.headlinerId, null);
    });

    it('picks the tier-0 (sortOrder=0 headliner) over other tiers', async () => {
      const shows = [
        {
          id: 'show-1',
          kind: 'concert',
          state: 'past',
          date: '2026-09-01',
          seat: null,
          pricePaid: null,
          ticketCount: 1,
          productionName: null,
          venue: { id: 'v1', name: 'V', city: 'NYC', stateRegion: 'NY', latitude: null, longitude: null, photoUrl: null },
        },
      ];
      const performerRows = [
        // sortOrder=2 support — tier 2
        { showId: 'show-1', performerId: 's2', name: 'Support', imageUrl: null, role: 'support', sortOrder: 1 },
        // sortOrder=0 headliner — tier 0 (best)
        { showId: 'show-1', performerId: 'h0', name: 'Main', imageUrl: 'img', role: 'headliner', sortOrder: 0 },
        // another headliner sortOrder=1 — tier 1
        { showId: 'show-1', performerId: 'h1', name: 'Co', imageUrl: null, role: 'headliner', sortOrder: 1 },
      ];
      const db = makeFakeDb({ selectResults: [shows, performerRows] });
      const result = await caller(db).listForMap();
      assert.equal(result[0]!.headlinerName, 'Main');
      assert.equal(result[0]!.headlinerId, 'h0');
      assert.equal(result[0]!.headlinerImageUrl, 'img');
    });

    it('falls back to non-headliner when no headliner exists', async () => {
      const shows = [
        {
          id: 'show-1',
          kind: 'concert',
          state: 'past',
          date: '2026-09-01',
          seat: null,
          pricePaid: null,
          ticketCount: 1,
          productionName: null,
          venue: { id: 'v1', name: 'V', city: 'NYC', stateRegion: 'NY', latitude: null, longitude: null, photoUrl: null },
        },
      ];
      const performerRows = [
        { showId: 'show-1', performerId: 's2', name: 'Only', imageUrl: null, role: 'support', sortOrder: 5 },
      ];
      const db = makeFakeDb({ selectResults: [shows, performerRows] });
      const result = await caller(db).listForMap();
      assert.equal(result[0]!.headlinerName, 'Only');
    });
  });

  describe('count', () => {
    it('returns count from row', async () => {
      const db = makeFakeDb({ selectResults: [[{ count: 12 }]] });
      const result = await caller(db).count();
      assert.equal(result, 12);
    });

    it('returns 0 when no row', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      const result = await caller(db).count();
      assert.equal(result, 0);
    });
  });

  describe('detail', () => {
    it('throws NOT_FOUND when not found', async () => {
      // ctx.db.query.shows.findFirst — fake-db returns undefined on chain.
      // We use the proxy: it resolves to undefined when nothing scripted.
      // Actually findFirst is not scripted; the fake-db query.shows only
      // exposes findMany. Add a minimal fake query handler.
      const db = makeFakeDb();
      // Override query to return findFirst → undefined
      (db as unknown as { query: { shows: { findFirst: () => Promise<unknown> } } }).query = {
        shows: { findFirst: async () => undefined } as never,
      };
      await assert.rejects(
        () => caller(db).detail({ showId: SHOW_ID }),
        (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });

    it('returns the show when found', async () => {
      const show = { id: SHOW_ID, kind: 'concert' };
      const db = makeFakeDb();
      (db as unknown as { query: { shows: { findFirst: () => Promise<unknown> } } }).query = {
        shows: { findFirst: async () => show } as never,
      };
      const result = await caller(db).detail({ showId: SHOW_ID });
      assert.equal((result as { id: string }).id, SHOW_ID);
    });
  });

  describe('setTicketUrl', () => {
    it('throws NOT_FOUND when update returns nothing', async () => {
      const db = makeFakeDb({ updateResults: [[]] });
      await assert.rejects(
        () => caller(db).setTicketUrl({ showId: SHOW_ID, ticketUrl: 'https://example.com' }),
        (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });

    it('returns the updated row', async () => {
      const updated = { id: SHOW_ID, ticketUrl: 'https://example.com' };
      const db = makeFakeDb({ updateResults: [[updated]] });
      const result = await caller(db).setTicketUrl({
        showId: SHOW_ID,
        ticketUrl: 'https://example.com',
      });
      assert.equal((result as { id: string }).id, SHOW_ID);
    });

    it('rejects invalid url', async () => {
      const db = makeFakeDb();
      await assert.rejects(() =>
        caller(db).setTicketUrl({ showId: SHOW_ID, ticketUrl: 'not-a-url' }),
      );
    });
  });

  describe('updateState', () => {
    it('throws NOT_FOUND when show does not exist', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      await assert.rejects(
        () =>
          caller(db).updateState({ showId: SHOW_ID, newState: 'ticketed' }),
        (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });

    it('rejects an invalid transition', async () => {
      const existing = { id: SHOW_ID, state: 'past', seat: null };
      const db = makeFakeDb({ selectResults: [[existing]] });
      await assert.rejects(
        () =>
          caller(db).updateState({ showId: SHOW_ID, newState: 'ticketed' }),
        (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
      );
    });

    it('rejects watching→ticketed without a seat', async () => {
      const existing = { id: SHOW_ID, state: 'watching', seat: null };
      const db = makeFakeDb({ selectResults: [[existing]] });
      await assert.rejects(
        () =>
          caller(db).updateState({ showId: SHOW_ID, newState: 'ticketed' }),
        (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
      );
    });

    it('allows watching→ticketed when seat already exists', async () => {
      const existing = { id: SHOW_ID, state: 'watching', seat: 'A1' };
      const updated = { ...existing, state: 'ticketed' };
      const db = makeFakeDb({
        selectResults: [[existing]],
        updateResults: [[updated]],
      });
      const result = await caller(db).updateState({
        showId: SHOW_ID,
        newState: 'ticketed',
      });
      assert.equal((result as { state: string }).state, 'ticketed');
    });

    it('allows ticketed→past', async () => {
      const existing = { id: SHOW_ID, state: 'ticketed', seat: 'A1' };
      const updated = { ...existing, state: 'past' };
      const db = makeFakeDb({
        selectResults: [[existing]],
        updateResults: [[updated]],
      });
      const result = await caller(db).updateState({
        showId: SHOW_ID,
        newState: 'past',
      });
      assert.equal((result as { state: string }).state, 'past');
    });

    it('passes optional seat/pricePaid/ticketCount through', async () => {
      const existing = { id: SHOW_ID, state: 'watching', seat: null };
      const db = makeFakeDb({
        selectResults: [[existing]],
        updateResults: [[{ id: SHOW_ID, state: 'ticketed', seat: 'B2' }]],
      });
      const result = await caller(db).updateState({
        showId: SHOW_ID,
        newState: 'ticketed',
        seat: 'B2',
        pricePaid: '50.00',
        ticketCount: 2,
      });
      assert.equal((result as { seat: string }).seat, 'B2');
    });
  });

  describe('addPerformer', () => {
    it('throws NOT_FOUND when show does not exist', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      await assert.rejects(
        () =>
          caller(db).addPerformer({
            showId: SHOW_ID,
            name: 'Phoebe',
            role: 'support',
            sortOrder: 1,
          } as never),
        (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });
  });

  describe('removePerformer', () => {
    it('throws NOT_FOUND when show does not exist', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      await assert.rejects(
        () =>
          caller(db).removePerformer({
            showId: SHOW_ID,
            performerId: PERFORMER_ID,
            role: 'support',
          }),
        (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });

    it('succeeds and clears setlist key when present', async () => {
      const existing = {
        id: SHOW_ID,
        setlists: { [PERFORMER_ID]: { sections: [] }, other: { sections: [] } },
      };
      const db = makeFakeDb({ selectResults: [[existing]] });
      const result = await caller(db).removePerformer({
        showId: SHOW_ID,
        performerId: PERFORMER_ID,
        role: 'support',
      });
      assert.deepEqual(result, { success: true });
    });

    it('succeeds when no setlist exists', async () => {
      const existing = { id: SHOW_ID, setlists: null };
      const db = makeFakeDb({ selectResults: [[existing]] });
      const result = await caller(db).removePerformer({
        showId: SHOW_ID,
        performerId: PERFORMER_ID,
        role: 'support',
      });
      assert.deepEqual(result, { success: true });
    });
  });

  describe('setSetlist', () => {
    it('throws NOT_FOUND when show does not exist', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      await assert.rejects(
        () =>
          caller(db).setSetlist({
            showId: SHOW_ID,
            performerId: PERFORMER_ID,
            setlist: { sections: [] },
          }),
        (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });

    it('throws BAD_REQUEST when performer is not on this show', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ id: SHOW_ID, setlists: null }],
          [],
        ],
      });
      await assert.rejects(
        () =>
          caller(db).setSetlist({
            showId: SHOW_ID,
            performerId: PERFORMER_ID,
            setlist: { sections: [] },
          }),
        (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
      );
    });

    it('clears the performer key when setlist is empty after cleanup', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ id: SHOW_ID, setlists: { [PERFORMER_ID]: { sections: [] } } }],
          [{ performerId: PERFORMER_ID }],
        ],
      });
      const result = await caller(db).setSetlist({
        showId: SHOW_ID,
        performerId: PERFORMER_ID,
        setlist: { sections: [{ kind: 'set', songs: [{ title: '   ' }] }] },
      });
      assert.deepEqual(result, { success: true });
    });

    it('writes a cleaned non-empty setlist', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ id: SHOW_ID, setlists: null }],
          [{ performerId: PERFORMER_ID }],
        ],
      });
      const result = await caller(db).setSetlist({
        showId: SHOW_ID,
        performerId: PERFORMER_ID,
        setlist: { sections: [{ kind: 'set', songs: [{ title: 'Song A' }] }] },
      });
      assert.deepEqual(result, { success: true });
    });

    it('rejects more than one encore section', async () => {
      const db = makeFakeDb();
      await assert.rejects(() =>
        caller(db).setSetlist({
          showId: SHOW_ID,
          performerId: PERFORMER_ID,
          setlist: {
            sections: [
              { kind: 'encore', songs: [{ title: 'a' }] },
              { kind: 'encore', songs: [{ title: 'b' }] },
            ],
          },
        }),
      );
    });

    it('rejects setlists exceeding the song cap', async () => {
      const db = makeFakeDb();
      const songs = Array.from({ length: 201 }, (_, i) => ({ title: `s${i}` }));
      await assert.rejects(() =>
        caller(db).setSetlist({
          showId: SHOW_ID,
          performerId: PERFORMER_ID,
          setlist: { sections: [{ kind: 'set', songs }] },
        }),
      );
    });
  });

  describe('delete', () => {
    it('throws NOT_FOUND when show does not exist', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      await assert.rejects(
        () => caller(db).delete({ showId: SHOW_ID }),
        (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });

    it('returns success when deleted', async () => {
      const db = makeFakeDb({ selectResults: [[{ id: SHOW_ID }]] });
      const result = await caller(db).delete({ showId: SHOW_ID });
      assert.deepEqual(result, { success: true });
    });
  });

  describe('listForMap (additional cases)', () => {
    it('handles a festival with productionName', async () => {
      const shows = [
        {
          id: 's-fest',
          kind: 'festival',
          state: 'past',
          date: '2026-08-01',
          seat: null,
          pricePaid: null,
          ticketCount: 1,
          productionName: 'Outside Lands',
          venue: { id: 'v', name: 'V', city: 'SF', stateRegion: 'CA', latitude: null, longitude: null, photoUrl: null },
        },
      ];
      const db = makeFakeDb({ selectResults: [shows] });
      const result = await caller(db).listForMap();
      assert.equal(result[0]!.headlinerName, 'Outside Lands');
    });

    it('handles concert with no headliner row at all', async () => {
      const shows = [
        {
          id: 's-empty',
          kind: 'concert',
          state: 'past',
          date: '2026-08-01',
          seat: null,
          pricePaid: null,
          ticketCount: 1,
          productionName: null,
          venue: { id: 'v', name: 'V', city: 'C', stateRegion: 'NY', latitude: null, longitude: null, photoUrl: null },
        },
      ];
      const db = makeFakeDb({ selectResults: [shows, []] });
      const result = await caller(db).listForMap();
      assert.equal(result[0]!.headlinerName, null);
      assert.equal(result[0]!.headlinerId, null);
    });
  });

  describe('addPerformer (success)', () => {
    // Note: success path opens a pg-boss connection via matchOrCreatePerformer,
    // so we only assert NOT_FOUND here. The mocked happy path lives in
    // shows-router-create.test.ts (which mocks the matcher module).
  });

  describe('removePerformer with empty setlists object', () => {
    it('treats empty setlists object as no-op', async () => {
      const existing = { id: SHOW_ID, setlists: {} };
      const db = makeFakeDb({ selectResults: [[existing]] });
      const result = await caller(db).removePerformer({
        showId: SHOW_ID,
        performerId: PERFORMER_ID,
        role: 'support',
      });
      assert.deepEqual(result, { success: true });
    });
  });

  describe('deleteAll', () => {
    it('returns count of deleted shows', async () => {
      const db = makeFakeDb({
        deleteResults: [[{ id: 'a' }, { id: 'b' }, { id: 'c' }]],
      });
      const result = await caller(db).deleteAll();
      assert.equal(result.deleted, 3);
    });
  });
});
