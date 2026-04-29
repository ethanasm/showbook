/**
 * Unit tests for the pure region-grouping helpers used by the Discover
 * Near You tab.
 *
 * Run with:
 *   pnpm --filter web exec node --import tsx --test \
 *     'app/(app)/discover/__tests__/region-helpers.test.ts'
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupAnnouncementsByRegion,
  groupVenuesByRegion,
  type ActiveRegion,
  type RegionableAnnouncement,
} from '../region-helpers';

const SF: ActiveRegion = { id: 'sf', cityName: 'San Francisco', radiusMiles: 25 };
const LA: ActiveRegion = { id: 'la', cityName: 'Los Angeles', radiusMiles: 25 };

const venueA = { id: 'venue-a', name: 'Bill Graham', city: 'San Francisco' };
const venueB = { id: 'venue-b', name: 'The Fillmore', city: 'San Francisco' };
const venueC = { id: 'venue-c', name: 'The Wiltern', city: 'Los Angeles' };

function ann(
  id: string,
  venue: { id: string; name: string; city: string },
  regionId: string,
  cityName: string,
): RegionableAnnouncement {
  return {
    id,
    venue,
    regionId,
    regionCityName: cityName,
    regionRadiusMiles: 25,
  };
}

describe('groupAnnouncementsByRegion', () => {
  const items = [
    ann('a1', venueA, 'sf', 'San Francisco'),
    ann('a2', venueA, 'sf', 'San Francisco'),
    ann('a3', venueB, 'sf', 'San Francisco'),
    ann('a4', venueC, 'la', 'Los Angeles'),
    ann('a5', venueC, 'la', 'Los Angeles'),
  ];

  it('groups items by region with no filter', () => {
    const groups = groupAnnouncementsByRegion(items, [SF, LA]);
    assert.equal(groups.length, 2);
    assert.equal(groups.find((g) => g.id === 'sf')!.items.length, 3);
    assert.equal(groups.find((g) => g.id === 'la')!.items.length, 2);
  });

  it('seeds empty region groups from activeRegions even when items is undefined', () => {
    const groups = groupAnnouncementsByRegion(undefined, [SF, LA]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0]!.items.length, 0);
    assert.equal(groups[1]!.items.length, 0);
  });

  it('seeds empty region groups when items has no entries for that region', () => {
    const onlySfItems = items.filter((i) => i.regionId === 'sf');
    const groups = groupAnnouncementsByRegion(onlySfItems, [SF, LA]);
    assert.equal(groups.length, 2);
    assert.equal(groups.find((g) => g.id === 'la')!.items.length, 0);
  });

  // The bug fix: when a venue is selected on Near You, the right-side feed
  // must filter to that venue. Previously the regionGroups memo iterated the
  // unfiltered `items` so all rows still rendered.
  it('filters items to the selected venue id', () => {
    const groups = groupAnnouncementsByRegion(items, [SF, LA], 'venue-a');
    const sf = groups.find((g) => g.id === 'sf')!;
    const la = groups.find((g) => g.id === 'la')!;
    assert.equal(sf.items.length, 2, 'venue-a contributes both SF items');
    assert.equal(la.items.length, 0, 'no LA items for venue-a');
    assert.deepEqual(
      sf.items.map((i) => i.id),
      ['a1', 'a2'],
    );
  });

  it('returns empty items in every region when no item matches the selected venue', () => {
    const groups = groupAnnouncementsByRegion(items, [SF, LA], 'venue-does-not-exist');
    assert.equal(groups.length, 2);
    assert.ok(groups.every((g) => g.items.length === 0));
  });

  it('selecting a LA venue leaves SF region empty (header still rendered)', () => {
    const groups = groupAnnouncementsByRegion(items, [SF, LA], 'venue-c');
    const sf = groups.find((g) => g.id === 'sf')!;
    const la = groups.find((g) => g.id === 'la')!;
    assert.equal(sf.items.length, 0);
    assert.equal(la.items.length, 2);
  });

  it('falls back to __unknown bucket when item has no regionId', () => {
    const orphan: RegionableAnnouncement = {
      id: 'orphan',
      venue: venueA,
      regionId: null,
      regionCityName: null,
      regionRadiusMiles: null,
    };
    const groups = groupAnnouncementsByRegion([orphan], []);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.id, '__unknown');
    assert.equal(groups[0]!.cityName, 'Unknown');
  });

  it('preserves item insertion order within each region', () => {
    const groups = groupAnnouncementsByRegion(items, [SF, LA]);
    const sfIds = groups.find((g) => g.id === 'sf')!.items.map((i) => i.id);
    assert.deepEqual(sfIds, ['a1', 'a2', 'a3']);
  });
});

describe('groupVenuesByRegion', () => {
  const items = [
    ann('a1', venueA, 'sf', 'San Francisco'),
    ann('a2', venueA, 'sf', 'San Francisco'),
    ann('a3', venueB, 'sf', 'San Francisco'),
    ann('a4', venueC, 'la', 'Los Angeles'),
    ann('a5', venueC, 'la', 'Los Angeles'),
    ann('a6', venueC, 'la', 'Los Angeles'),
  ];

  it('builds per-region venue lists with announcement counts', () => {
    const groups = groupVenuesByRegion(items, [SF, LA]);
    const sf = groups.find((g) => g.id === 'sf')!;
    const la = groups.find((g) => g.id === 'la')!;
    assert.equal(sf.venues.length, 2);
    assert.equal(la.venues.length, 1);
  });

  it('sorts each region’s venues by count descending', () => {
    const groups = groupVenuesByRegion(items, [SF, LA]);
    const sfVenueIds = groups.find((g) => g.id === 'sf')!.venues.map((v) => v.id);
    // venue-a has 2 announcements, venue-b has 1 → venue-a first
    assert.deepEqual(sfVenueIds, ['venue-a', 'venue-b']);
  });

  it('returns active regions even when they have no venues', () => {
    const onlySfItems = items.filter((i) => i.regionId === 'sf');
    const groups = groupVenuesByRegion(onlySfItems, [SF, LA]);
    assert.equal(groups.length, 2);
    assert.equal(groups.find((g) => g.id === 'la')!.venues.length, 0);
  });

  it('does not filter by selected venue (rail always shows full venue list)', () => {
    // groupVenuesByRegion has no selected-venue parameter — confirm it
    // always returns the full set so the rail counts are stable when the
    // user clicks a venue.
    const groups = groupVenuesByRegion(items, [SF, LA]);
    assert.equal(groups.find((g) => g.id === 'sf')!.venues.length, 2);
  });
});
