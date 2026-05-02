import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, QueryObserver } from '@tanstack/react-query';

import { triggerForegroundSync } from '../../cache/sync.js';

describe('triggerForegroundSync', () => {
  it('refetches active queries (those with at least one observer)', async () => {
    const qc = new QueryClient();
    let activeFetches = 0;
    let inactiveFetches = 0;

    const activeObserver = new QueryObserver(qc, {
      queryKey: ['active'],
      queryFn: async () => {
        activeFetches += 1;
        return 'a';
      },
    });
    const unsub = activeObserver.subscribe(() => undefined);
    await activeObserver.refetch();

    // Inactive: build the query in the cache, never subscribe.
    qc.getQueryCache().build(qc, {
      queryKey: ['inactive'],
      queryFn: async () => {
        inactiveFetches += 1;
        return 'i';
      },
    });
    qc.setQueryData(['inactive'], 'i');

    const beforeActive = activeFetches;
    const beforeInactive = inactiveFetches;
    await triggerForegroundSync(qc);

    assert.ok(activeFetches > beforeActive, 'active query should refetch');
    assert.equal(inactiveFetches, beforeInactive, 'inactive query stays put');
    unsub();
  });

  it('returns a promise that resolves', async () => {
    const qc = new QueryClient();
    const result = triggerForegroundSync(qc);
    assert.ok(result && typeof result.then === 'function');
    await result;
  });
});
