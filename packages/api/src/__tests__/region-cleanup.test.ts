import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAnnouncementsToDelete,
  type AnnouncementCandidate,
  type RegionBbox,
} from '../routers/preferences';

// San Francisco area: ~37.77, -122.42
const sfRegion: RegionBbox = { latitude: 37.7749, longitude: -122.4194, radiusMiles: 25 };
// Los Angeles area: ~34.05, -118.24
const laRegion: RegionBbox = { latitude: 34.0522, longitude: -118.2437, radiusMiles: 25 };

// Venue clearly inside SF bbox
const sfVenueId = 'venue-sf';
const sfVenueLat = 37.78;
const sfVenueLng = -122.41;

// Venue clearly inside LA bbox
const laVenueId = 'venue-la';
const laVenueLat = 34.06;
const laVenueLng = -118.25;

// Announcement at SF venue, with a performer the user follows
const annSfFollowedPerformer: AnnouncementCandidate = {
  id: 'ann-1',
  venueId: sfVenueId,
  headlinerPerformerId: 'performer-followed',
  supportPerformerIds: null,
  venueLat: sfVenueLat,
  venueLng: sfVenueLng,
};

// Announcement at SF venue, no followed performer, venue not directly followed
const annSfOrphan: AnnouncementCandidate = {
  id: 'ann-2',
  venueId: sfVenueId,
  headlinerPerformerId: null,
  supportPerformerIds: null,
  venueLat: sfVenueLat,
  venueLng: sfVenueLng,
};

// Announcement at LA venue (should not be touched when removing SF region)
const annLa: AnnouncementCandidate = {
  id: 'ann-3',
  venueId: laVenueId,
  headlinerPerformerId: null,
  supportPerformerIds: null,
  venueLat: laVenueLat,
  venueLng: laVenueLng,
};

// Announcement at SF venue, but user directly follows this venue
const annSfFollowedVenue: AnnouncementCandidate = {
  id: 'ann-4',
  venueId: 'venue-sf-directly-followed',
  headlinerPerformerId: null,
  supportPerformerIds: null,
  venueLat: sfVenueLat,
  venueLng: sfVenueLng,
};

describe('computeAnnouncementsToDelete', () => {
  it('deletes orphan announcements in the removed region', () => {
    const toDelete = computeAnnouncementsToDelete(
      [annSfOrphan],
      sfRegion,
      [],    // no other active regions
      [],    // no followed venues
      [],    // no followed performers
    );
    assert.deepEqual(toDelete, ['ann-2']);
  });

  it('preserves announcements whose performer is followed', () => {
    const toDelete = computeAnnouncementsToDelete(
      [annSfFollowedPerformer],
      sfRegion,
      [],
      [],
      ['performer-followed'],
    );
    assert.deepEqual(toDelete, []);
  });

  it('preserves announcements whose venue is directly followed', () => {
    const toDelete = computeAnnouncementsToDelete(
      [annSfFollowedVenue],
      sfRegion,
      [],
      ['venue-sf-directly-followed'],
      [],
    );
    assert.deepEqual(toDelete, []);
  });

  it('preserves announcements reachable via another active region', () => {
    // SF venue is also covered by a second SF-area region
    const sfRegion2: RegionBbox = { latitude: 37.8, longitude: -122.4, radiusMiles: 30 };
    const toDelete = computeAnnouncementsToDelete(
      [annSfOrphan],
      sfRegion,
      [sfRegion2],
      [],
      [],
    );
    assert.deepEqual(toDelete, []);
  });

  it('does not touch announcements outside the removed region', () => {
    const toDelete = computeAnnouncementsToDelete(
      [annLa],
      sfRegion,  // removing SF, not LA
      [],
      [],
      [],
    );
    assert.deepEqual(toDelete, []);
  });

  it('handles multiple candidates correctly', () => {
    const toDelete = computeAnnouncementsToDelete(
      [annSfOrphan, annSfFollowedPerformer, annLa, annSfFollowedVenue],
      sfRegion,
      [],
      ['venue-sf-directly-followed'],
      ['performer-followed'],
    );
    // Only annSfOrphan should be deleted
    assert.deepEqual(toDelete, ['ann-2']);
  });

  it('handles null lat/lng gracefully', () => {
    const nullVenueAnn: AnnouncementCandidate = {
      id: 'ann-null',
      venueId: 'venue-no-coords',
      headlinerPerformerId: null,
      supportPerformerIds: null,
      venueLat: null,
      venueLng: null,
    };
    const toDelete = computeAnnouncementsToDelete(
      [nullVenueAnn],
      sfRegion,
      [],
      [],
      [],
    );
    assert.deepEqual(toDelete, []);
  });
});
