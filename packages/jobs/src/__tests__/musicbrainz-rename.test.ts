/**
 * Smoke test: verify performers schema exposes musicbrainzId and NOT setlistfmMbid.
 * Runnable via:
 *   pnpm --filter @showbook/jobs exec node --import tsx --test src/__tests__/musicbrainz-rename.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performers } from '@showbook/db';

test('performers schema has musicbrainzId field', () => {
  assert.ok('musicbrainzId' in performers, 'musicbrainzId should exist on performers schema');
});

test('performers schema does not have setlistfmMbid field', () => {
  assert.ok(!('setlistfmMbid' in performers), 'setlistfmMbid should not exist on performers schema');
});

test('performers.musicbrainzId maps to musicbrainz_id column', () => {
  const col = (performers.musicbrainzId as { name: string }).name;
  assert.equal(col, 'musicbrainz_id');
});
