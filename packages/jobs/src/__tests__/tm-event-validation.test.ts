/**
 * Unit tests for the TM-event skip predicates, focused on the
 * `tm.normalize.skipped` severity contract: `unknown_kind` is deliberate
 * content filtering (info — it fired ~3.9k/week at warn in prod and was
 * the dominant warn in the dataset) while the venue-data reasons remain
 * warn (genuine TM data-quality problems). `emitSkip` in
 * discover-ingest.ts logs at the level each predicate carries.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasValidKind,
  hasValidVenueCity,
  hasValidVenueName,
} from '../tm-event-validation';
import type { TMEvent } from '@showbook/api';

function makeEvent(overrides: Partial<TMEvent> = {}): TMEvent {
  const base: TMEvent = {
    id: 'tm-e-1',
    name: 'Some Event',
    dates: { start: { localDate: '2026-08-01' } },
    _embedded: {
      venues: [{ id: 'tm-v-1', name: 'Greek Theater', city: { name: 'Berkeley' } }],
    },
  };
  return { ...base, ...overrides };
}

describe('tm-event-validation skip levels', () => {
  it('unknown_kind skips at info — deliberate filtering, not a fault', () => {
    const result = hasValidKind('unknown', makeEvent());
    assert.ok(result.skip);
    assert.equal(result.reason, 'unknown_kind');
    assert.equal(result.level, 'info');
    assert.deepEqual(result.fields, { tmEventId: 'tm-e-1', name: 'Some Event' });
  });

  it('a known kind does not skip', () => {
    assert.deepEqual(hasValidKind('concert', makeEvent()), { skip: false });
  });

  it('missing_venue_name skips at warn (no venue object)', () => {
    const result = hasValidVenueName(makeEvent({ _embedded: {} }));
    assert.ok(result.skip);
    assert.equal(result.reason, 'missing_venue_name');
    assert.equal(result.level, 'warn');
  });

  it('missing_venue_name skips at warn (blank name)', () => {
    const result = hasValidVenueName(
      makeEvent({
        _embedded: { venues: [{ id: 'tm-v-1', name: '  ', city: { name: 'Berkeley' } }] },
      }),
    );
    assert.ok(result.skip);
    assert.equal(result.reason, 'missing_venue_name');
    assert.equal(result.level, 'warn');
  });

  it('missing_venue_city skips at warn', () => {
    const result = hasValidVenueCity(
      makeEvent({
        _embedded: { venues: [{ id: 'tm-v-1', name: 'Friendly Notary' }] },
      }),
    );
    assert.ok(result.skip);
    assert.equal(result.reason, 'missing_venue_city');
    assert.equal(result.level, 'warn');
  });

  it('a well-formed venue passes both venue checks', () => {
    assert.deepEqual(hasValidVenueName(makeEvent()), { skip: false });
    assert.deepEqual(hasValidVenueCity(makeEvent()), { skip: false });
  });
});
