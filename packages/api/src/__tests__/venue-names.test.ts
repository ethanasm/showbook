/**
 * Unit tests for the per-user venue-name override resolver
 * (`packages/api/src/venue-names.ts`). The helpers rewrite the `name`
 * field on whatever row shape they're handed, so we exercise the
 * empty-input short-circuits, the dedupe, and the flat / nested rewrites
 * against a minimal fake db that records the `inArray` venue-id set.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadVenueNameOverrides,
  applyVenueNameOverrides,
  applyNestedVenueNameOverrides,
} from '../venue-names';

type OverrideRow = { venueId: string; customName: string };

/**
 * Minimal fake db whose `select().from().where()` resolves to the scripted
 * rows. Records how many times a query ran so we can assert the empty-input
 * short-circuit never hits the db.
 */
function fakeDb(rows: OverrideRow[]) {
  const state = { queries: 0 };
  const chain = {
    from: () => chain,
    where: () => Promise.resolve(rows),
  };
  const db = {
    select: () => {
      state.queries++;
      return chain;
    },
    _queries: () => state.queries,
  };
  return db as never;
}

describe('loadVenueNameOverrides', () => {
  it('returns an empty map and runs no query for empty ids', async () => {
    const db = fakeDb([]);
    const map = await loadVenueNameOverrides(db, 'u1', []);
    assert.equal(map.size, 0);
    assert.equal((db as unknown as { _queries(): number })._queries(), 0);
  });

  it('returns an empty map and runs no query when ids are all falsy', async () => {
    const db = fakeDb([]);
    const map = await loadVenueNameOverrides(db, 'u1', ['', '']);
    assert.equal(map.size, 0);
    assert.equal((db as unknown as { _queries(): number })._queries(), 0);
  });

  it('maps venueId -> customName from the scripted rows', async () => {
    const db = fakeDb([{ venueId: 'v1', customName: 'My Spot' }]);
    const map = await loadVenueNameOverrides(db, 'u1', ['v1', 'v1', 'v2']);
    assert.equal(map.get('v1'), 'My Spot');
    assert.equal(map.has('v2'), false);
    // Deduped to a single query regardless of repeated ids.
    assert.equal((db as unknown as { _queries(): number })._queries(), 1);
  });
});

describe('applyVenueNameOverrides', () => {
  it('returns the same array when there are no rows', async () => {
    const db = fakeDb([]);
    const rows: { venueId: string; name: string }[] = [];
    const out = await applyVenueNameOverrides(db, 'u1', rows);
    assert.equal(out, rows);
  });

  it('leaves rows untouched when no overrides exist', async () => {
    const db = fakeDb([]);
    const rows = [{ venueId: 'v1', name: 'Canonical' }];
    const out = await applyVenueNameOverrides(db, 'u1', rows);
    assert.equal(out, rows); // same reference — no override path
    assert.equal(out[0]!.name, 'Canonical');
  });

  it('rewrites only the matching venueIds', async () => {
    const db = fakeDb([{ venueId: 'v1', customName: 'Alias' }]);
    const rows = [
      { venueId: 'v1', name: 'Canonical' },
      { venueId: 'v2', name: 'Other' },
    ];
    const out = await applyVenueNameOverrides(db, 'u1', rows);
    assert.equal(out[0]!.name, 'Alias');
    assert.equal(out[1]!.name, 'Other');
  });
});

describe('applyNestedVenueNameOverrides', () => {
  it('rewrites the embedded venue name', async () => {
    const db = fakeDb([{ venueId: 'v1', customName: 'Alias' }]);
    const rows = [{ id: 's1', venue: { id: 'v1', name: 'Canonical' } }];
    const out = await applyNestedVenueNameOverrides(db, 'u1', rows, (r) => r.venue);
    assert.equal(out[0]!.venue.name, 'Alias');
  });

  it('skips rows whose venue is null or has no override', async () => {
    const db = fakeDb([{ venueId: 'v1', customName: 'Alias' }]);
    const rows = [
      { id: 's1', venue: { id: 'v2', name: 'Unaliased' } },
      { id: 's2', venue: null as { id: string; name: string } | null },
    ];
    const out = await applyNestedVenueNameOverrides(db, 'u1', rows, (r) => r.venue);
    assert.equal(out[0]!.venue!.name, 'Unaliased');
    assert.equal(out[1]!.venue, null);
  });

  it('returns the same array when no overrides exist', async () => {
    const db = fakeDb([]);
    const rows = [{ id: 's1', venue: { id: 'v1', name: 'Canonical' } }];
    const out = await applyNestedVenueNameOverrides(db, 'u1', rows, (r) => r.venue);
    assert.equal(out, rows);
  });
});
