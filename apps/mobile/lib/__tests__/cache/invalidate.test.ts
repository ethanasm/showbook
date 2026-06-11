import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  invalidateShowsList,
  invalidateAllShowsLists,
  invalidateDiscoverFeeds,
} from '../../cache/invalidate.js';

/**
 * Minimal QueryClient stand-in: records every `queryKey` passed to
 * `invalidateQueries` so we can assert the fan-out targets the
 * mobile-prefixed read keys (the whole point of these helpers — the
 * Discover / Home / Shows screens read under `['mobile', …]` keys that
 * the tRPC-native `utils.*.invalidate()` calls never reach).
 */
function makeFakeClient() {
  const calls: unknown[][] = [];
  return {
    calls,
    client: {
      invalidateQueries: ({ queryKey }: { queryKey: unknown[] }) => {
        calls.push(queryKey);
        return Promise.resolve();
      },
    },
  };
}

describe('invalidateShowsList', () => {
  it('fans out across every mobile shows.list reader', () => {
    const { calls, client } = makeFakeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    invalidateShowsList(client as any);
    assert.deepEqual(calls, [
      ['mobile', 'shows.list'],
      ['mobile', 'home', 'shows.list'],
    ]);
  });
});

describe('invalidateAllShowsLists', () => {
  it('hits the tRPC-native key space AND every mobile reader', () => {
    const { calls, client } = makeFakeClient();
    let trpcInvalidated = 0;
    const utils = {
      shows: {
        list: {
          invalidate: () => {
            trpcInvalidated += 1;
            return Promise.resolve();
          },
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    invalidateAllShowsLists(client as any, utils);
    assert.equal(
      trpcInvalidated,
      1,
      'expected the tRPC-native shows.list invalidate to fire',
    );
    assert.deepEqual(calls, [
      ['mobile', 'shows.list'],
      ['mobile', 'home', 'shows.list'],
    ]);
  });
});

describe('invalidateDiscoverFeeds', () => {
  it('invalidates ingestStatus so the scoped poll arms', () => {
    const { calls, client } = makeFakeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    invalidateDiscoverFeeds(client as any);
    assert.ok(
      calls.some(
        (key) =>
          key.length === 3 &&
          key[0] === 'mobile' &&
          key[1] === 'discover' &&
          key[2] === 'ingestStatus',
      ),
      'expected ingestStatus to be invalidated',
    );
  });

  it('covers all three feeds and the chip-seed sources', () => {
    const { calls, client } = makeFakeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    invalidateDiscoverFeeds(client as any);
    const serialized = calls.map((k) => JSON.stringify(k));
    for (const expected of [
      ['mobile', 'discover', 'followedFeed'],
      ['mobile', 'discover', 'followedArtistsFeed'],
      ['mobile', 'discover', 'nearbyFeed'],
      ['mobile', 'venues', 'followed'],
      ['mobile', 'artists', 'followed'],
      ['mobile', 'preferences', 'get'],
    ]) {
      assert.ok(
        serialized.includes(JSON.stringify(expected)),
        `expected ${JSON.stringify(expected)} to be invalidated`,
      );
    }
  });
});
