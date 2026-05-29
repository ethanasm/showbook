import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EntityLimit,
  entityLimit,
  canAddEntity,
  entityLimitReachedHint,
  entityLimitExceededError,
} from '../entity-limits';

describe('EntityLimit registry', () => {
  it('declares the documented caps', () => {
    assert.equal(entityLimit('regions'), 5);
    assert.equal(entityLimit('venues'), 100);
    assert.equal(entityLimit('artists'), 250);
  });

  it('keeps every entry shaped consistently', () => {
    for (const key of Object.keys(EntityLimit) as (keyof typeof EntityLimit)[]) {
      const entry = EntityLimit[key];
      assert.ok(Number.isInteger(entry.max) && entry.max > 0);
      assert.ok(entry.nounPlural.length > 0);
      assert.ok(entry.description.length > 0);
    }
  });
});

describe('canAddEntity', () => {
  it('is true below the cap', () => {
    assert.equal(canAddEntity('regions', 0), true);
    assert.equal(canAddEntity('regions', 4), true);
  });

  it('is false at or above the cap', () => {
    assert.equal(canAddEntity('regions', 5), false);
    assert.equal(canAddEntity('regions', 6), false);
    assert.equal(canAddEntity('venues', 100), false);
  });

  it('treats negative / non-finite counts as zero (UI hint, not a guard)', () => {
    assert.equal(canAddEntity('regions', -1), true);
    assert.equal(canAddEntity('regions', Number.NaN), true);
    // Infinity is non-finite, so it falls into the same "treat as zero"
    // branch rather than being read as a huge over-cap count.
    assert.equal(canAddEntity('regions', Number.POSITIVE_INFINITY), true);
  });
});

describe('message builders', () => {
  it('builds the reached hint from the number + noun', () => {
    assert.equal(
      entityLimitReachedHint('regions'),
      'Maximum 5 regions — remove one to add another.',
    );
  });

  it('builds the server error message from the number + noun', () => {
    assert.equal(
      entityLimitExceededError('regions'),
      'You can have at most 5 regions.',
    );
  });
});
