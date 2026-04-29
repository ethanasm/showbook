import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeVenueUnfollowAnnouncementsToDelete,
  type AnnouncementCandidate,
  type RegionBbox,
} from '../routers/preferences';

const sfRegion: RegionBbox = { latitude: 37.7749, longitude: -122.4194, radiusMiles: 25 };
const laRegion: RegionBbox = { latitude: 34.0522, longitude: -118.2437, radiusMiles: 25 };

const sfVenueLat = 37.78;
const sfVenueLng = -122.41;

// Announcement at SF venue, no followed performer
const annSfNoPerformer: AnnouncementCandidate = {
  id: 'ann-1',
  venueId: 'venue-sf',
  headlinerPerformerId: null,
  venueLat: sfVenueLat,
  venueLng: sfVenueLng,
};

// Announcement at SF venue, with a followed headliner
const annSfFollowedPerformer: AnnouncementCandidate = {
  id: 'ann-2',
  venueId: 'venue-sf',
  headlinerPerformerId: 'performer-followed',
  venueLat: sfVenueLat,
  venueLng: sfVenueLng,
};

// Announcement at SF venue, with a non-followed headliner
const annSfUnfollowedPerformer: AnnouncementCandidate = {
  id: 'ann-3',
  venueId: 'venue-sf',
  headlinerPerformerId: 'performer-unknown',
  venueLat: sfVenueLat,
  venueLng: sfVenueLng,
};

describe('computeVenueUnfollowAnnouncementsToDelete', () => {
  it('deletes orphan announcements not preserved by region or follows', () => {
    const toDelete = computeVenueUnfollowAnnouncementsToDelete(
      [annSfNoPerformer],
      [],
      [],
    );
    assert.deepEqual(toDelete, ['ann-1']);
  });

  it('preserves announcements whose venue is in any active region', () => {
    const toDelete = computeVenueUnfollowAnnouncementsToDelete(
      [annSfNoPerformer],
      [sfRegion],
      [],
    );
    assert.deepEqual(toDelete, []);
  });

  it('still deletes when only an unrelated region is active', () => {
    const toDelete = computeVenueUnfollowAnnouncementsToDelete(
      [annSfNoPerformer],
      [laRegion],
      [],
    );
    assert.deepEqual(toDelete, ['ann-1']);
  });

  it('preserves announcements whose headliner is followed', () => {
    const toDelete = computeVenueUnfollowAnnouncementsToDelete(
      [annSfFollowedPerformer],
      [],
      ['performer-followed'],
    );
    assert.deepEqual(toDelete, []);
  });

  it('still deletes when the headliner is not followed', () => {
    const toDelete = computeVenueUnfollowAnnouncementsToDelete(
      [annSfUnfollowedPerformer],
      [],
      ['someone-else'],
    );
    assert.deepEqual(toDelete, ['ann-3']);
  });

  it('preserves announcements whose venue has no coordinates', () => {
    const noCoords: AnnouncementCandidate = {
      id: 'ann-null',
      venueId: 'venue-x',
      headlinerPerformerId: null,
      venueLat: null,
      venueLng: null,
    };
    const toDelete = computeVenueUnfollowAnnouncementsToDelete(
      [noCoords],
      [],
      [],
    );
    assert.deepEqual(toDelete, []);
  });

  it('handles multiple candidates correctly', () => {
    const toDelete = computeVenueUnfollowAnnouncementsToDelete(
      [annSfNoPerformer, annSfFollowedPerformer, annSfUnfollowedPerformer],
      [],
      ['performer-followed'],
    );
    assert.deepEqual(toDelete.sort(), ['ann-1', 'ann-3']);
  });
});
