/**
 * Tests for the Discover artist-tab grouping helper.
 *
 * Regression: when Sam Short is imported from Spotify but only appears as
 * a SUPPORT act on Two Feet's tour, the announcement was being grouped
 * solely under the headliner (Two Feet) and her rail row stuck at "0
 * upcoming". The fix lets a single announcement fan out into multiple
 * followed-artist groups via `support_performer_ids`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAnnouncementGroupKeys } from '@/app/(app)/discover/grouping';

const SAM_SHORT = '87630352-b290-46d7-b6b9-9eb2563b440b';
const TWO_FEET = 'd89c5d1d-c57f-495e-a1a9-15da38ccbd3e';
const BROTHEL = 'a80c2aa6-5178-46e0-a285-cd14f4020e20';
const VENUE = '11111111-1111-1111-1111-111111111111';

const twoFeetWithSamSupport = {
  headlinerPerformerId: TWO_FEET,
  supportPerformerIds: [SAM_SHORT, BROTHEL],
  venue: { id: VENUE },
};

test('artist tab: announcement is grouped under each followed artist on the bill', () => {
  // User follows Sam Short only — the Two Feet show should bucket onto her row.
  const keys = computeAnnouncementGroupKeys(twoFeetWithSamSupport, 'artist', [
    { id: SAM_SHORT },
  ]);
  assert.deepEqual(keys, [SAM_SHORT]);
});

test('artist tab: announcement fans out to multiple followed artists', () => {
  // Both headliner and a support are followed — the show appears on both rows.
  const keys = computeAnnouncementGroupKeys(twoFeetWithSamSupport, 'artist', [
    { id: SAM_SHORT },
    { id: TWO_FEET },
  ]);
  assert.deepEqual(keys.sort(), [TWO_FEET, SAM_SHORT].sort());
});

test('artist tab: unrelated support acts do not spawn rail rows', () => {
  // Brothel isn't followed, so it shouldn't get a group key even though
  // it's in supportPerformerIds.
  const keys = computeAnnouncementGroupKeys(twoFeetWithSamSupport, 'artist', [
    { id: SAM_SHORT },
  ]);
  assert.ok(!keys.includes(BROTHEL));
});

test('artist tab: missing followed list returns every performer on the bill', () => {
  // Pre-load fallback so the first paint still buckets correctly.
  const keys = computeAnnouncementGroupKeys(twoFeetWithSamSupport, 'artist');
  assert.deepEqual(keys.sort(), [TWO_FEET, SAM_SHORT, BROTHEL].sort());
});

test('artist tab: announcement with no support array still groups by headliner', () => {
  const keys = computeAnnouncementGroupKeys(
    {
      headlinerPerformerId: TWO_FEET,
      supportPerformerIds: null,
      venue: { id: VENUE },
    },
    'artist',
    [{ id: TWO_FEET }],
  );
  assert.deepEqual(keys, [TWO_FEET]);
});

test('artist tab: returns empty when nothing on the bill is followed', () => {
  const keys = computeAnnouncementGroupKeys(twoFeetWithSamSupport, 'artist', [
    { id: '99999999-9999-9999-9999-999999999999' },
  ]);
  assert.deepEqual(keys, []);
});

test('venue tab: groups by venue id regardless of performers', () => {
  const keys = computeAnnouncementGroupKeys(twoFeetWithSamSupport, 'venue', [
    { id: SAM_SHORT },
  ]);
  assert.deepEqual(keys, [VENUE]);
});

test('region tab: groups by venue id (region buckets are layered later)', () => {
  const keys = computeAnnouncementGroupKeys(twoFeetWithSamSupport, 'region');
  assert.deepEqual(keys, [VENUE]);
});
