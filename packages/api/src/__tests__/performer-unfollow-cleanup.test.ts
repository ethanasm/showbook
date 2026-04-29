import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePerformerAnnouncementsToDelete,
  type AnnouncementCandidate,
  type RegionBbox,
} from '../routers/preferences';

const sfRegion: RegionBbox = { latitude: 37.7749, longitude: -122.4194, radiusMiles: 25 };

const sfVenueLat = 37.78;
const sfVenueLng = -122.41;

const outsideLat = 40.0;
const outsideLng = -74.0;

const orphanAnn: AnnouncementCandidate = {
  id: 'ann-orphan',
  venueId: 'venue-nowhere',
  headlinerPerformerId: 'performer-1',
  venueLat: outsideLat,
  venueLng: outsideLng,
};

const followedVenueAnn: AnnouncementCandidate = {
  id: 'ann-followed-venue',
  venueId: 'venue-followed',
  headlinerPerformerId: 'performer-1',
  venueLat: outsideLat,
  venueLng: outsideLng,
};

const inRegionAnn: AnnouncementCandidate = {
  id: 'ann-in-region',
  venueId: 'venue-sf',
  headlinerPerformerId: 'performer-1',
  venueLat: sfVenueLat,
  venueLng: sfVenueLng,
};

const nullCoordsAnn: AnnouncementCandidate = {
  id: 'ann-null-coords',
  venueId: 'venue-no-coords',
  headlinerPerformerId: 'performer-1',
  venueLat: null,
  venueLng: null,
};

describe('computePerformerAnnouncementsToDelete', () => {
  it('deletes announcements with no follow relationship', () => {
    const toDelete = computePerformerAnnouncementsToDelete(
      [orphanAnn],
      [],
      [],
    );
    assert.deepEqual(toDelete, ['ann-orphan']);
  });

  it('keeps announcements at a followed venue', () => {
    const toDelete = computePerformerAnnouncementsToDelete(
      [followedVenueAnn],
      [],
      ['venue-followed'],
    );
    assert.deepEqual(toDelete, []);
  });

  it('keeps announcements at a venue in an active region', () => {
    const toDelete = computePerformerAnnouncementsToDelete(
      [inRegionAnn],
      [sfRegion],
      [],
    );
    assert.deepEqual(toDelete, []);
  });

  it('keeps announcements with null coordinates', () => {
    const toDelete = computePerformerAnnouncementsToDelete(
      [nullCoordsAnn],
      [sfRegion],
      [],
    );
    assert.deepEqual(toDelete, []);
  });

  it('only deletes truly orphaned announcements from a mixed set', () => {
    const toDelete = computePerformerAnnouncementsToDelete(
      [orphanAnn, followedVenueAnn, inRegionAnn, nullCoordsAnn],
      [sfRegion],
      ['venue-followed'],
    );
    assert.deepEqual(toDelete, ['ann-orphan']);
  });
});
