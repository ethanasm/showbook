import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';
import { assertUnderFollowCap } from '../follow-caps';
import { entityLimit } from '@showbook/shared';

describe('assertUnderFollowCap', () => {
  it('allows a new follow below the cap', () => {
    assert.doesNotThrow(() => assertUnderFollowCap('venues', ['a', 'b'], 'c'));
  });

  it('allows re-following an already-followed target even at the cap', () => {
    const ids = Array.from({ length: entityLimit('artists') }, (_, i) => `p-${i}`);
    assert.doesNotThrow(() => assertUnderFollowCap('artists', ids, 'p-0'));
  });

  it('rejects a new follow at the cap with BAD_REQUEST + the shared message', () => {
    const ids = Array.from({ length: entityLimit('venues') }, (_, i) => `v-${i}`);
    assert.throws(
      () => assertUnderFollowCap('venues', ids, 'new-venue'),
      (err: unknown) =>
        err instanceof TRPCError &&
        err.code === 'BAD_REQUEST' &&
        err.message === 'You can have at most 100 venues.',
    );
  });

  it('rejects a new follow when over the cap (defensive)', () => {
    const ids = Array.from({ length: entityLimit('artists') + 5 }, (_, i) => `p-${i}`);
    assert.throws(
      () => assertUnderFollowCap('artists', ids, 'new-artist'),
      (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
    );
  });
});
