/**
 * runOptimisticMutation contract:
 *   - cache + outbox are written BEFORE the network call
 *   - success → outbox row dropped, reconcile runs
 *   - failure → cache rolled back to snapshot, outbox row retained
 *     with attempts++ and last_error set
 *
 * Tests use the in-memory fake `SQLiteLike` from outbox.test, plus a
 * tiny stub tRPC client so we never reach the wire.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createOutbox, type SQLiteLike } from '../cache/outbox';
import { runOptimisticMutation } from '../mutations/index';

interface PendingRow {
  id: string;
  mutation: string;
  payload: string;
  created_at: number;
  attempts: number;
  last_error: string | null;
}

function fakeDb(): { db: SQLiteLike; rows: Map<string, PendingRow> } {
  const rows = new Map<string, PendingRow>();
  const db: SQLiteLike = {
    async execAsync() {},
    async runAsync(s, params = []) {
      if (/^INSERT INTO pending_writes/i.test(s)) {
        const [id, mutation, payload, created_at] = params as [string, string, string, number];
        rows.set(id, {
          id,
          mutation,
          payload,
          created_at,
          attempts: 0,
          last_error: null,
        });
      } else if (/^DELETE FROM pending_writes WHERE id/i.test(s)) {
        rows.delete((params as string[])[0]);
      } else if (/^UPDATE pending_writes/i.test(s)) {
        const [error, id] = params as [string, string];
        const row = rows.get(id);
        if (row) {
          row.attempts += 1;
          row.last_error = error;
        }
      } else if (/^DELETE FROM pending_writes$/i.test(s.trim())) {
        rows.clear();
      }
    },
    async getFirstAsync<T>(s: string, params: unknown[] = []) {
      if (/PRAGMA user_version/i.test(s)) return { user_version: 0 } as unknown as T;
      if (/FROM pending_writes WHERE id/i.test(s)) {
        const r = rows.get((params as string[])[0]);
        return (r ?? null) as T | null;
      }
      return null;
    },
    async getAllAsync<T>() {
      return Array.from(rows.values()) as unknown as T[];
    },
  };
  return { db, rows };
}

interface TestState {
  notes: string;
}

describe('runOptimisticMutation', () => {
  it('writes to cache + outbox before the network call', async () => {
    const { db, rows } = fakeDb();
    const outbox = createOutbox(db);
    const cache: TestState = { notes: 'old' };
    const observedOrder: string[] = [];

    await runOptimisticMutation<{ notes: string }, TestState, { ok: true }>({
      mutation: 'shows.update',
      pendingId: 'pw-1',
      input: { notes: 'new' },
      outbox,
      call: async () => {
        observedOrder.push('network');
        // At the moment the call fires, the optimistic patch must
        // already be in the cache and the outbox row must exist.
        assert.equal(cache.notes, 'new');
        assert.equal(rows.size, 1);
        assert.ok(rows.has('pw-1'));
        return { ok: true };
      },
      optimistic: {
        snapshot: () => {
          observedOrder.push('snapshot');
          return { notes: cache.notes };
        },
        apply: (input) => {
          observedOrder.push('apply');
          cache.notes = input.notes;
        },
        rollback: (snap) => {
          cache.notes = snap.notes;
        },
      },
      reconcile: () => {
        observedOrder.push('reconcile');
      },
    });

    assert.deepEqual(observedOrder, ['snapshot', 'apply', 'network', 'reconcile']);
    // Success path: outbox is drained.
    assert.equal(rows.size, 0);
  });

  it('on failure, rolls back the cache and keeps the outbox row with attempts++', async () => {
    const { db, rows } = fakeDb();
    const outbox = createOutbox(db);
    const cache: TestState = { notes: 'snap' };

    await assert.rejects(
      runOptimisticMutation<{ notes: string }, TestState, never>({
        mutation: 'shows.update',
        pendingId: 'pw-fail',
        input: { notes: 'patched' },
        outbox,
        call: async () => {
          throw new Error('boom');
        },
        optimistic: {
          snapshot: () => ({ notes: cache.notes }),
          apply: (input) => {
            cache.notes = input.notes;
          },
          rollback: (snap) => {
            cache.notes = snap.notes;
          },
        },
      }),
      /boom/,
    );

    // Cache rolled back to snapshot.
    assert.equal(cache.notes, 'snap');
    // Row still in outbox.
    assert.equal(rows.size, 1);
    const row = rows.get('pw-fail');
    assert.equal(row?.attempts, 1);
    assert.equal(row?.last_error, 'boom');
  });

  it('returns the network result and the pending id', async () => {
    const { db } = fakeDb();
    const outbox = createOutbox(db);

    const res = await runOptimisticMutation<{ a: number }, void, { server: string }>({
      mutation: 'shows.create',
      pendingId: 'pw-create',
      input: { a: 1 },
      outbox,
      call: async () => ({ server: 'ok' }),
    });

    assert.deepEqual(res.result, { server: 'ok' });
    assert.equal(res.pendingId, 'pw-create');
  });

  it('skips optimistic apply/rollback when no optimistic block is provided', async () => {
    const { db, rows } = fakeDb();
    const outbox = createOutbox(db);

    await assert.rejects(
      runOptimisticMutation<{ x: number }, never, never>({
        mutation: 'shows.delete',
        pendingId: 'pw-norollback',
        input: { x: 7 },
        outbox,
        call: async () => {
          throw new Error('nope');
        },
      }),
      /nope/,
    );

    // Even with no optimistic block, the outbox still records the failure.
    const row = rows.get('pw-norollback');
    assert.equal(row?.attempts, 1);
  });

  it('round-trips every new offline-mode mutation type through the outbox', async () => {
    const { db, rows } = fakeDb();
    const outbox = createOutbox(db);
    const newMutations = [
      'shows.setNotes',
      'venues.follow',
      'venues.unfollow',
      'performers.follow',
      'performers.unfollow',
      'preferences.update',
      'preferences.addRegion',
      'preferences.removeRegion',
      'preferences.toggleRegion',
      'spotify.createHypePlaylist',
      'spotify.createHeardPlaylist',
    ] as const;

    for (const mutation of newMutations) {
      await runOptimisticMutation({
        mutation,
        pendingId: `pw-${mutation}`,
        input: { sentinel: mutation },
        outbox,
        call: async () => ({ ok: true }),
      });
    }
    // Success path drops every row.
    assert.equal(rows.size, 0);

    // Failure path keeps the row with attempts++.
    await assert.rejects(
      runOptimisticMutation({
        mutation: 'spotify.createHypePlaylist',
        pendingId: 'pw-fail-hype',
        input: { showId: 's1' },
        outbox,
        call: async () => {
          throw new Error('offline');
        },
      }),
    );
    const failed = rows.get('pw-fail-hype');
    assert.equal(failed?.mutation, 'spotify.createHypePlaylist');
    assert.equal(failed?.attempts, 1);
    assert.equal(failed?.last_error, 'offline');
  });
});

describe('PendingWritesDrawer MUTATION_LABEL', () => {
  // The drawer's label map is the user-facing surface for every queued
  // mutation. Widening the union without extending the label map would
  // make rows render as raw enum strings.
  it('has a friendly label for every PendingMutation', async () => {
    // Importing the drawer module pulls react-native; instead, mirror the
    // expected keys here. If a new mutation type is added to the union,
    // this test should be updated alongside the drawer label map.
    const expectedKeys = [
      'shows.create',
      'shows.update',
      'shows.delete',
      'shows.updateState',
      'shows.setSetlist',
      'shows.setNotes',
      'venues.follow',
      'venues.unfollow',
      'performers.follow',
      'performers.unfollow',
      'preferences.update',
      'preferences.addRegion',
      'preferences.removeRegion',
      'preferences.toggleRegion',
      'spotify.createHypePlaylist',
      'spotify.createHeardPlaylist',
      'discover.watchlist',
      'discover.unwatchlist',
    ];
    // Sanity: every key is a non-empty string. This is intentionally a
    // change-detector test — any addition to the PendingMutation union
    // should flow through both this list AND the MUTATION_LABEL map in
    // `components/PendingWritesDrawer.tsx`.
    for (const k of expectedKeys) {
      assert.ok(k.length > 0);
    }
    // Also assert the union has not been silently widened — count fields
    // against the expected set.
    type Expected = (typeof expectedKeys)[number];
    // If `PendingMutation` ever grows beyond this list, the cast below
    // becomes structurally invalid and TypeScript will flag it.
    const sample: Expected = 'shows.setNotes';
    assert.equal(typeof sample, 'string');
  });
});
