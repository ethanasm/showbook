/**
 * Persister tests use a real `QueryClient` from @tanstack/react-query
 * paired with an in-memory `CacheStorage`. No React Native or Expo
 * deps are pulled in, so this runs cleanly under `node --test`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';

import { createMemoryStorage } from '../../cache/memory-storage.js';
import { attachQueryPersister, hydrateQueryClient } from '../../cache/persister.js';
import { serializeQueryKey } from '../../cache/storage.js';

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe('attachQueryPersister', () => {
  it('writes successful query results to storage on fetch', async () => {
    const storage = createMemoryStorage();
    const qc = new QueryClient();
    const detach = attachQueryPersister(qc, { storage, now: () => 9999 });

    await qc.fetchQuery({
      queryKey: ['shows.list'],
      queryFn: async () => [{ id: 'a' }],
    });
    await tick();

    const entry = await storage.get(serializeQueryKey(['shows.list']));
    assert.ok(entry, 'expected entry to be persisted');
    assert.equal(entry?.updatedAt, 9999);
    assert.deepEqual(JSON.parse(entry!.value), [{ id: 'a' }]);
    detach();
  });

  it('removes from storage when a query is removed', async () => {
    const storage = createMemoryStorage();
    const qc = new QueryClient();
    const detach = attachQueryPersister(qc, { storage });
    qc.setQueryData(['k'], { v: 1 });
    await tick();
    qc.getQueryCache().clear();
    await tick();
    const all = await storage.entries();
    assert.deepEqual(all, []);
    detach();
  });

  it('reports JSON.stringify failures via onError without throwing', async () => {
    const storage = createMemoryStorage();
    const qc = new QueryClient();
    const errors: Array<{ op: string; key?: string }> = [];
    const detach = attachQueryPersister(qc, {
      storage,
      onError: (_e, ctx) => errors.push(ctx),
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    qc.setQueryData(['k'], cyclic);
    await tick();
    assert.ok(errors.some((e) => e.op === 'write'));
    detach();
  });

  it('detach unsubscribes — later updates are not persisted', async () => {
    const storage = createMemoryStorage();
    const qc = new QueryClient();
    const detach = attachQueryPersister(qc, { storage });
    detach();
    qc.setQueryData(['k'], { v: 1 });
    await tick();
    assert.deepEqual(await storage.entries(), []);
  });
});

describe('hydrateQueryClient', () => {
  it('seeds the query cache from storage', async () => {
    const storage = createMemoryStorage();
    await storage.set(serializeQueryKey(['shows.list']), {
      value: JSON.stringify([{ id: 'x' }]),
      updatedAt: 4242,
    });
    const qc = new QueryClient();
    await hydrateQueryClient(qc, { storage });
    assert.deepEqual(qc.getQueryData(['shows.list']), [{ id: 'x' }]);
    const state = qc.getQueryState(['shows.list']);
    assert.equal(state?.dataUpdatedAt, 4242);
  });

  it('skips entries whose key is not a JSON array', async () => {
    const storage = createMemoryStorage();
    await storage.set('"not-an-array"', { value: '{}', updatedAt: 1 });
    const qc = new QueryClient();
    await hydrateQueryClient(qc, { storage });
    // No queries should be seeded.
    assert.equal(qc.getQueryCache().getAll().length, 0);
  });

  it('reports onError and skips an entry with malformed JSON', async () => {
    const storage = createMemoryStorage();
    await storage.set(serializeQueryKey(['k']), { value: 'not-json', updatedAt: 1 });
    const qc = new QueryClient();
    const errors: Array<{ op: string; key?: string }> = [];
    await hydrateQueryClient(qc, { storage, onError: (_e, ctx) => errors.push(ctx) });
    assert.equal(qc.getQueryCache().getAll().length, 0);
    assert.ok(errors.some((e) => e.op === 'read'));
  });

  it('reports onError when storage.entries() rejects', async () => {
    const storage = createMemoryStorage();
    storage.entries = async () => {
      throw new Error('boom');
    };
    const qc = new QueryClient();
    let captured: unknown = null;
    await hydrateQueryClient(qc, { storage, onError: (e) => (captured = e) });
    assert.match(String(captured), /boom/);
  });
});
