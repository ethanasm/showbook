import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isFresh, serializeQueryKey } from '../../cache/storage.js';
import { createMemoryStorage } from '../../cache/memory-storage.js';

describe('serializeQueryKey', () => {
  it('produces a stable string for equivalent objects with reordered keys', () => {
    const a = serializeQueryKey(['shows.list', { sort: 'desc', limit: 10 }]);
    const b = serializeQueryKey(['shows.list', { limit: 10, sort: 'desc' }]);
    assert.equal(a, b);
  });

  it('distinguishes different arrays', () => {
    assert.notEqual(
      serializeQueryKey(['shows.list', { limit: 10 }]),
      serializeQueryKey(['shows.list', { limit: 20 }]),
    );
  });

  it('handles primitives', () => {
    assert.equal(serializeQueryKey(null), 'null');
    assert.equal(serializeQueryKey(42), '42');
    assert.equal(serializeQueryKey('x'), '"x"');
  });

  it('round-trips back through JSON.parse as an array', () => {
    const key = serializeQueryKey(['shows.byId', { id: 'abc' }]);
    const parsed = JSON.parse(key);
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed[0], 'shows.byId');
    assert.deepEqual(parsed[1], { id: 'abc' });
  });
});

describe('isFresh', () => {
  it('returns true within ttl', () => {
    assert.equal(isFresh({ value: '', updatedAt: 1000 }, 5000, 4000), true);
  });
  it('returns false past ttl', () => {
    assert.equal(isFresh({ value: '', updatedAt: 1000 }, 1000, 5000), false);
  });
  it('returns false for non-positive ttl', () => {
    assert.equal(isFresh({ value: '', updatedAt: 1000 }, 0, 1500), false);
    assert.equal(isFresh({ value: '', updatedAt: 1000 }, -10, 1500), false);
  });
});

describe('createMemoryStorage', () => {
  it('round-trips a value', async () => {
    const s = createMemoryStorage();
    await s.set('k', { value: 'v', updatedAt: 1 });
    const got = await s.get('k');
    assert.deepEqual(got, { value: 'v', updatedAt: 1 });
  });

  it('returns null for missing keys', async () => {
    const s = createMemoryStorage();
    assert.equal(await s.get('missing'), null);
  });

  it('overwrites on set', async () => {
    const s = createMemoryStorage();
    await s.set('k', { value: 'a', updatedAt: 1 });
    await s.set('k', { value: 'b', updatedAt: 2 });
    assert.deepEqual(await s.get('k'), { value: 'b', updatedAt: 2 });
  });

  it('deletes keys', async () => {
    const s = createMemoryStorage();
    await s.set('k', { value: 'v', updatedAt: 1 });
    await s.delete('k');
    assert.equal(await s.get('k'), null);
  });

  it('clears all entries', async () => {
    const s = createMemoryStorage();
    await s.set('a', { value: '1', updatedAt: 1 });
    await s.set('b', { value: '2', updatedAt: 2 });
    await s.clear();
    assert.deepEqual(await s.entries(), []);
  });

  it('lists every entry', async () => {
    const s = createMemoryStorage();
    await s.set('a', { value: '1', updatedAt: 1 });
    await s.set('b', { value: '2', updatedAt: 2 });
    const all = (await s.entries()).sort(([x], [y]) => x.localeCompare(y));
    assert.deepEqual(all, [
      ['a', { value: '1', updatedAt: 1 }],
      ['b', { value: '2', updatedAt: 2 }],
    ]);
  });
});
