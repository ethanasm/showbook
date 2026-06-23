/**
 * Pure-function tests for bucketAnnouncementsForUser. Runnable via:
 *   pnpm --filter @showbook/jobs exec node --import tsx --test src/__tests__/daily-digest.test.ts
 *
 * No DB/Resend required — these protect the announcement-matching logic the
 * daily digest relies on (venue match wins over artist, dedup across both
 * follows, on-sale-this-week classification, sort order).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bucketAnnouncementsForUser,
  whenLabel,
  type AnnouncementInput,
} from '../notifications';

const TODAY = '2026-04-30';
const SEVEN_OUT = '2026-05-07';

function makeAnnouncement(overrides: Partial<AnnouncementInput>): AnnouncementInput {
  return {
    id: overrides.id ?? `id-${Math.random()}`,
    headliner: overrides.headliner ?? 'Test Artist',
    venueId: overrides.venueId ?? 'venue-a',
    venueName: overrides.venueName ?? 'Test Venue',
    venueLat: overrides.venueLat ?? null,
    venueLng: overrides.venueLng ?? null,
    headlinerPerformerId: overrides.headlinerPerformerId ?? null,
    showDate: overrides.showDate ?? '2026-08-01',
    runStartDate: overrides.runStartDate ?? null,
    runEndDate: overrides.runEndDate ?? null,
    performanceDates: overrides.performanceDates ?? null,
    onSaleDate: overrides.onSaleDate ?? null,
  };
}

const SF_REGION = { latitude: 37.7749, longitude: -122.4194, radiusMiles: 25 };
const NYC_REGION = { latitude: 40.7128, longitude: -74.006, radiusMiles: 25 };

test('drops announcements that match neither follow', () => {
  const result = bucketAnnouncementsForUser(
    [
      makeAnnouncement({ venueId: 'unfollowed', headlinerPerformerId: 'unfollowed' }),
    ],
    new Set(['venue-1']),
    new Set(['perf-1']),
    TODAY,
    SEVEN_OUT,
  );
  assert.equal(result.length, 0);
});

test('keeps and labels venue match', () => {
  const result = bucketAnnouncementsForUser(
    [makeAnnouncement({ venueId: 'venue-1', headliner: 'Phoebe' })],
    new Set(['venue-1']),
    new Set(),
    TODAY,
    SEVEN_OUT,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]!.reason, 'venue');
  assert.equal(result[0]!.headliner, 'Phoebe');
});

test('keeps and labels artist match', () => {
  const result = bucketAnnouncementsForUser(
    [
      makeAnnouncement({
        venueId: 'unfollowed',
        headlinerPerformerId: 'perf-1',
        headliner: 'Caroline',
      }),
    ],
    new Set(),
    new Set(['perf-1']),
    TODAY,
    SEVEN_OUT,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]!.reason, 'artist');
});

test('venue match wins over artist match for the same announcement', () => {
  const result = bucketAnnouncementsForUser(
    [
      makeAnnouncement({
        venueId: 'venue-1',
        headlinerPerformerId: 'perf-1',
        headliner: 'Both',
      }),
    ],
    new Set(['venue-1']),
    new Set(['perf-1']),
    TODAY,
    SEVEN_OUT,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]!.reason, 'venue');
});

test('on-sale-soon is true only when onSaleDate is within next 7 days', () => {
  const inWindow = bucketAnnouncementsForUser(
    [
      makeAnnouncement({
        venueId: 'venue-1',
        onSaleDate: new Date('2026-05-03T15:00:00Z'),
      }),
    ],
    new Set(['venue-1']),
    new Set(),
    TODAY,
    SEVEN_OUT,
  );
  assert.equal(inWindow[0]!.onSaleSoon, true);

  const outOfWindow = bucketAnnouncementsForUser(
    [
      makeAnnouncement({
        venueId: 'venue-1',
        onSaleDate: new Date('2026-06-15T15:00:00Z'),
      }),
    ],
    new Set(['venue-1']),
    new Set(),
    TODAY,
    SEVEN_OUT,
  );
  assert.equal(outOfWindow[0]!.onSaleSoon, false);

  const noOnSale = bucketAnnouncementsForUser(
    [makeAnnouncement({ venueId: 'venue-1', onSaleDate: null })],
    new Set(['venue-1']),
    new Set(),
    TODAY,
    SEVEN_OUT,
  );
  assert.equal(noOnSale[0]!.onSaleSoon, false);
});

test('sorts by show date ascending', () => {
  const result = bucketAnnouncementsForUser(
    [
      makeAnnouncement({
        venueId: 'venue-1',
        headliner: 'October',
        showDate: '2026-10-01',
      }),
      makeAnnouncement({
        venueId: 'venue-1',
        headliner: 'August',
        showDate: '2026-08-01',
      }),
      makeAnnouncement({
        venueId: 'venue-1',
        headliner: 'September',
        showDate: '2026-09-01',
      }),
    ],
    new Set(['venue-1']),
    new Set(),
    TODAY,
    SEVEN_OUT,
  );
  assert.deepEqual(
    result.map((a) => a.headliner),
    ['August', 'September', 'October'],
  );
});

test('dedups identical (headliner, venue, when) entries', () => {
  const result = bucketAnnouncementsForUser(
    [
      makeAnnouncement({
        id: 'a',
        venueId: 'venue-1',
        headliner: 'Dup',
        showDate: '2026-08-01',
      }),
      makeAnnouncement({
        id: 'b',
        venueId: 'venue-1',
        headliner: 'Dup',
        showDate: '2026-08-01',
      }),
    ],
    new Set(['venue-1']),
    new Set(),
    TODAY,
    SEVEN_OUT,
  );
  assert.equal(result.length, 1);
});

test('formats run window as "start – end (N dates)"', () => {
  const result = bucketAnnouncementsForUser(
    [
      makeAnnouncement({
        venueId: 'venue-1',
        showDate: '2026-09-12',
        runStartDate: '2026-09-12',
        runEndDate: '2026-09-14',
        performanceDates: ['2026-09-12', '2026-09-13', '2026-09-14'],
      }),
    ],
    new Set(['venue-1']),
    new Set(),
    TODAY,
    SEVEN_OUT,
  );
  assert.equal(result.length, 1);
  assert.match(result[0]!.whenLabel, /Sep 12.*Sep 14.*3 dates/);
});

test('formats single-date show as "Day, Mon DD"', () => {
  const result = bucketAnnouncementsForUser(
    [
      makeAnnouncement({
        venueId: 'venue-1',
        showDate: '2026-08-15',
      }),
    ],
    new Set(['venue-1']),
    new Set(),
    TODAY,
    SEVEN_OUT,
  );
  assert.match(result[0]!.whenLabel, /Aug 15/);
});

// ── whenLabel ───────────────────────────────────────────────────────────

test('whenLabel: single show (no run) renders "Mon, Mon DD"', () => {
  const out = whenLabel({
    showDate: '2026-08-15',
    runStartDate: null,
    runEndDate: null,
    performanceDates: null,
  });
  assert.match(out, /Aug 15/);
  assert.equal(out.includes('('), false);
});

test('whenLabel: multi-night run renders start – end (N dates)', () => {
  const out = whenLabel({
    showDate: '2026-09-12',
    runStartDate: '2026-09-12',
    runEndDate: '2026-09-14',
    performanceDates: ['2026-09-12', '2026-09-13', '2026-09-14'],
  });
  assert.match(out, /Sep 12/);
  assert.match(out, /Sep 14/);
  assert.match(out, /\(3 dates\)/);
});

test('whenLabel: defaults performanceDates length to 1 when null', () => {
  const out = whenLabel({
    showDate: '2026-09-12',
    runStartDate: '2026-09-12',
    runEndDate: '2026-09-14',
    performanceDates: null,
  });
  assert.match(out, /\(1 dates\)/);
});

test('whenLabel: collapses to single-date when start === end', () => {
  const out = whenLabel({
    showDate: '2026-08-15',
    runStartDate: '2026-08-15',
    runEndDate: '2026-08-15',
    performanceDates: ['2026-08-15'],
  });
  assert.match(out, /Aug 15/);
  assert.equal(out.includes('–'), false);
});

test('whenLabel: falls back to showDate when run dates are null', () => {
  const out = whenLabel({
    showDate: '2026-12-31',
    runStartDate: null,
    runEndDate: null,
    performanceDates: null,
  });
  assert.match(out, /Dec 31/);
});

// ── region filter ───────────────────────────────────────────────────────

test('region filter: empty regions list is a no-op (keeps current behavior)', () => {
  const result = bucketAnnouncementsForUser(
    [
      makeAnnouncement({
        venueId: 'unfollowed',
        headlinerPerformerId: 'perf-1',
        venueLat: 41.4993,
        venueLng: -81.6944, // Cleveland
        headliner: 'Lizzo',
      }),
    ],
    new Set(),
    new Set(['perf-1']),
    TODAY,
    SEVEN_OUT,
    [], // no active regions
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]!.reason, 'artist');
});

test('region filter: artist-only match inside an active region is kept', () => {
  const result = bucketAnnouncementsForUser(
    [
      makeAnnouncement({
        venueId: 'unfollowed',
        headlinerPerformerId: 'perf-1',
        venueLat: 37.78, // SF
        venueLng: -122.42,
        headliner: 'Local SF Show',
      }),
    ],
    new Set(),
    new Set(['perf-1']),
    TODAY,
    SEVEN_OUT,
    [SF_REGION],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]!.reason, 'artist');
});

test('region filter: artist-only match outside active regions is dropped and counted', () => {
  const counts = { droppedArtistMatches: 0, droppedOnSale: 0 };
  const result = bucketAnnouncementsForUser(
    [
      makeAnnouncement({
        venueId: 'unfollowed',
        headlinerPerformerId: 'perf-1',
        venueLat: 41.4993, // Cleveland
        venueLng: -81.6944,
        headliner: 'Lizzo Cleveland',
      }),
    ],
    new Set(),
    new Set(['perf-1']),
    TODAY,
    SEVEN_OUT,
    [SF_REGION],
    counts,
  );
  assert.equal(result.length, 0);
  assert.equal(counts.droppedArtistMatches, 1);
});

test('region filter: explicit venue follow overrides region filter', () => {
  const result = bucketAnnouncementsForUser(
    [
      makeAnnouncement({
        venueId: 'venue-followed',
        headlinerPerformerId: 'perf-1',
        venueLat: 41.4993, // Cleveland — outside SF region
        venueLng: -81.6944,
        headliner: 'House of Blues Show',
      }),
    ],
    new Set(['venue-followed']),
    new Set(['perf-1']),
    TODAY,
    SEVEN_OUT,
    [SF_REGION],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]!.reason, 'venue');
});

test('region filter: artist-only match in any of multiple regions is kept', () => {
  const result = bucketAnnouncementsForUser(
    [
      makeAnnouncement({
        venueId: 'unfollowed-nyc',
        headlinerPerformerId: 'perf-1',
        venueLat: 40.7128,
        venueLng: -74.006,
        headliner: 'NYC Show',
      }),
      makeAnnouncement({
        venueId: 'unfollowed-cleveland',
        headlinerPerformerId: 'perf-1',
        venueLat: 41.4993,
        venueLng: -81.6944,
        headliner: 'Cleveland Show',
      }),
    ],
    new Set(),
    new Set(['perf-1']),
    TODAY,
    SEVEN_OUT,
    [SF_REGION, NYC_REGION],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]!.headliner, 'NYC Show');
});

test('region filter: artist-only match with null venue coords is dropped when regions are set', () => {
  const result = bucketAnnouncementsForUser(
    [
      makeAnnouncement({
        venueId: 'unfollowed',
        headlinerPerformerId: 'perf-1',
        venueLat: null,
        venueLng: null,
      }),
    ],
    new Set(),
    new Set(['perf-1']),
    TODAY,
    SEVEN_OUT,
    [SF_REGION],
  );
  assert.equal(result.length, 0);
});

// ── region-only trigger ─────────────────────────────────────────────────

test('region-only: announcement at venue in active region is kept with reason=region', () => {
  const result = bucketAnnouncementsForUser(
    [
      makeAnnouncement({
        venueId: 'unfollowed-venue',
        headlinerPerformerId: 'unfollowed-perf',
        venueLat: 37.78, // SF
        venueLng: -122.42,
        headliner: 'SF Show',
      }),
    ],
    new Set(), // no venue follows
    new Set(), // no performer follows
    TODAY,
    SEVEN_OUT,
    [SF_REGION],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]!.reason, 'region');
  assert.equal(result[0]!.headliner, 'SF Show');
});

test('region-only: announcement outside any region with no follows is dropped', () => {
  const result = bucketAnnouncementsForUser(
    [
      makeAnnouncement({
        venueId: 'unfollowed-venue',
        headlinerPerformerId: 'unfollowed-perf',
        venueLat: 41.4993, // Cleveland
        venueLng: -81.6944,
        headliner: 'Cleveland Show',
      }),
    ],
    new Set(),
    new Set(),
    TODAY,
    SEVEN_OUT,
    [SF_REGION],
  );
  assert.equal(result.length, 0);
});

test('region-only: null venue coords mean the announcement can\'t qualify by region alone', () => {
  const result = bucketAnnouncementsForUser(
    [
      makeAnnouncement({
        venueId: 'unfollowed-venue',
        headlinerPerformerId: 'unfollowed-perf',
        venueLat: null,
        venueLng: null,
      }),
    ],
    new Set(),
    new Set(),
    TODAY,
    SEVEN_OUT,
    [SF_REGION],
  );
  assert.equal(result.length, 0);
});

test('region-only: a venue match still wins precedence even when the venue sits inside an active region', () => {
  const result = bucketAnnouncementsForUser(
    [
      makeAnnouncement({
        venueId: 'venue-followed',
        headlinerPerformerId: null,
        venueLat: 37.78,
        venueLng: -122.42,
        headliner: 'Followed Venue Show',
      }),
    ],
    new Set(['venue-followed']),
    new Set(),
    TODAY,
    SEVEN_OUT,
    [SF_REGION],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]!.reason, 'venue');
});

test('region-only: an artist match wins precedence over a region-only label when both are true', () => {
  const result = bucketAnnouncementsForUser(
    [
      makeAnnouncement({
        venueId: 'unfollowed-venue',
        headlinerPerformerId: 'perf-1',
        venueLat: 37.78,
        venueLng: -122.42,
        headliner: 'Followed Artist Show',
      }),
    ],
    new Set(),
    new Set(['perf-1']),
    TODAY,
    SEVEN_OUT,
    [SF_REGION],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]!.reason, 'artist');
});

test('priority sort: venue / artist rows surface above region rows', () => {
  // Region row earliest by date — without priority sort it would land
  // first. With it, venue and artist hits come ahead regardless of date.
  const result = bucketAnnouncementsForUser(
    [
      makeAnnouncement({
        id: 'a-region',
        venueId: 'unfollowed-venue',
        headlinerPerformerId: 'unfollowed-perf',
        venueLat: 37.78,
        venueLng: -122.42,
        headliner: 'Region Show',
        showDate: '2026-06-01',
      }),
      makeAnnouncement({
        id: 'a-artist',
        venueId: 'unfollowed-venue-2',
        headlinerPerformerId: 'perf-1',
        venueLat: 37.78,
        venueLng: -122.42,
        headliner: 'Artist Show',
        showDate: '2026-09-01',
      }),
      makeAnnouncement({
        id: 'a-venue',
        venueId: 'venue-1',
        headlinerPerformerId: null,
        venueLat: 37.78,
        venueLng: -122.42,
        headliner: 'Venue Show',
        showDate: '2026-12-01',
      }),
    ],
    new Set(['venue-1']),
    new Set(['perf-1']),
    TODAY,
    SEVEN_OUT,
    [SF_REGION],
  );
  assert.equal(result.length, 3);
  assert.deepEqual(
    result.map((r) => r.reason),
    ['venue', 'artist', 'region'],
  );
});

test('carries the announcement id through to the bucketed output', () => {
  // The digest job persists the bucketed set into `user_digest_entries`
  // keyed by announcement id, so the id must survive bucketing + dedupe.
  const result = bucketAnnouncementsForUser(
    [
      makeAnnouncement({
        id: 'announce-123',
        venueId: 'venue-1',
        headliner: 'Keep My Id',
        showDate: '2026-08-01',
      }),
    ],
    new Set(['venue-1']),
    new Set(),
    TODAY,
    SEVEN_OUT,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]!.announcementId, 'announce-123');
});
