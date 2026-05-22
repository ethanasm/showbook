/**
 * Verifies that a setlist.fm 429 from `fetchArtistSetlists` does NOT cause
 * `runSetlistCorpusFill` to throw — the job returns cleanly with
 * `skipped: 'rate_limited'`. Without this, every rate-limit storm leaves
 * hundreds of failed rows in `pgboss.job` (observed 2026-05-21: 875
 * enrichment/setlist-corpus-fill rows in `state = 'failed'` after a
 * quota-exhaustion event).
 *
 * The DB + setlist.fm client are mocked via `mock.module`, then the
 * subject is dynamic-imported so the mocked modules win.
 */

import { describe, it, before, mock } from 'node:test';
import assert from 'node:assert/strict';

const PERFORMER_WITH_MBID = {
  id: 'perf-mbid',
  name: 'Test Artist',
  musicbrainzId: 'mbid-test',
};

class FakeSetlistFmError extends Error {
  status: number;
  endpoint: string;
  constructor(message: string, status: number, endpoint: string) {
    super(message);
    this.name = 'SetlistFmError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

mock.module('@showbook/db', {
  namedExports: {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [PERFORMER_WITH_MBID],
          }),
        }),
      }),
      delete: () => ({
        where: async () => undefined,
      }),
    },
    performers: {},
    predictionCache: { performerId: 'performer_id' },
    tourSetlists: {},
  },
});

let fetchArtistSetlistsImpl: () => Promise<unknown[]> = async () => [];
mock.module('@showbook/api', {
  namedExports: {
    fetchArtistSetlists: (..._args: unknown[]) => fetchArtistSetlistsImpl(),
    SetlistFmError: FakeSetlistFmError,
  },
});

let runSetlistCorpusFill: typeof import('../setlist-corpus-fill').runSetlistCorpusFill;

before(async () => {
  ({ runSetlistCorpusFill } = await import('../setlist-corpus-fill'));
});

describe('runSetlistCorpusFill — 429 handling', () => {
  it('returns skipped=rate_limited (does not throw) when fetchArtistSetlists 429s', async () => {
    fetchArtistSetlistsImpl = async () => {
      throw new FakeSetlistFmError(
        'setlist.fm 429: Too Many Requests',
        429,
        '/artist/mbid-test/setlists?p=1',
      );
    };

    const result = await runSetlistCorpusFill({
      performerId: PERFORMER_WITH_MBID.id,
      mode: 'predict',
    });

    assert.equal(result.skipped, 'rate_limited');
    assert.equal(result.fetched, 0);
    assert.equal(result.inserted, 0);
    assert.equal(result.updated, 0);
  });

  it('re-throws non-429 SetlistFmError so the operator still sees real bugs', async () => {
    fetchArtistSetlistsImpl = async () => {
      throw new FakeSetlistFmError('setlist.fm 500: Server Error', 500, '/x');
    };

    await assert.rejects(
      runSetlistCorpusFill({
        performerId: PERFORMER_WITH_MBID.id,
        mode: 'predict',
      }),
      (err: unknown) => {
        assert.ok(err instanceof FakeSetlistFmError);
        assert.equal((err as FakeSetlistFmError).status, 500);
        return true;
      },
    );
  });
});
