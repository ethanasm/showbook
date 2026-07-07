import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MediaVariant } from '@showbook/db';
import { matchPendingVariant } from '../media-upload-auth';

function variant(key: string, bytes: number): MediaVariant {
  return { key, mimeType: 'image/webp', bytes, width: null, height: null };
}

describe('matchPendingVariant', () => {
  const k = 'showbook/u1/shows/s1/photos/a1/full.webp';

  it('returns the variant whose key matches, carrying its reserved bytes', () => {
    const rows = [
      { thumb: variant('showbook/u1/shows/s1/photos/a1/thumb.webp', 100), full: variant(k, 5000) },
    ];
    const match = matchPendingVariant(rows, k);
    assert.equal(match?.key, k);
    assert.equal(match?.bytes, 5000); // the ceiling the PUT must respect
  });

  it('returns null when no pending variant owns the key', () => {
    const rows = [{ thumb: variant('showbook/u1/shows/s1/photos/a1/thumb.webp', 100) }];
    assert.equal(matchPendingVariant(rows, k), null);
  });

  it('scans across multiple pending assets', () => {
    const rows: Record<string, MediaVariant>[] = [
      { thumb: variant('other/key.webp', 10) },
      { full: variant(k, 42) },
    ];
    assert.equal(matchPendingVariant(rows, k)?.bytes, 42);
  });

  it('is safe against null/undefined/empty variant maps', () => {
    assert.equal(matchPendingVariant([null, undefined, {}], k), null);
  });

  it('requires an exact key match (no prefix / substring collision)', () => {
    const rows: Record<string, MediaVariant>[] = [{ full: variant(k + '.extra', 5000) }, { full: variant(k.slice(0, -1), 5000) }];
    assert.equal(matchPendingVariant(rows, k), null);
  });
});
