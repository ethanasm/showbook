// `load-env-local` is a no-op when no .env.local is present (the prod
// container case), so it's safe to import unconditionally even when this
// module is loaded from the registry inside Next.js. Local CLI invocations
// still get their .env.local merged.
import './load-env-local';

import { db, venues } from '@showbook/db';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import {
  geocodeVenue,
  getPlaceDetails,
  isUniqueViolation,
} from '@showbook/api';
import { child, flushObservability } from '@showbook/observability';

const log = child({ component: 'jobs.backfill-venue-photos' });
const WAIT_MS = 1100;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BackfillVenuePhotosSummary {
  total: number;
  updated: number;
  missing: number;
  failed: number;
  placeIdResolved: number;
  placeIdMissing: number;
  placeIdFailed: number;
  photoRefreshed: number;
}

async function resolveMissingPlaceIds(): Promise<{
  resolved: number;
  missing: number;
  failed: number;
}> {
  const rows = await db
    .select({
      id: venues.id,
      name: venues.name,
      city: venues.city,
      stateRegion: venues.stateRegion,
    })
    .from(venues)
    .where(isNull(venues.googlePlaceId));

  let resolved = 0;
  let missing = 0;
  let failed = 0;

  for (const [index, venue] of rows.entries()) {
    if (!venue.name || !venue.city) {
      missing++;
      continue;
    }
    if (index > 0) await sleep(WAIT_MS);

    try {
      const geo = await geocodeVenue(venue.name, venue.city, venue.stateRegion);
      if (!geo?.googlePlaceId) {
        missing++;
        log.info(
          { event: 'venue.placeid.missing', venueId: venue.id, venueName: venue.name },
          'Google Places returned no Place ID',
        );
        continue;
      }

      try {
        await db
          .update(venues)
          .set({
            googlePlaceId: geo.googlePlaceId,
            // Only persist photo on this pass — leave coordinates alone if
            // we already have them from Ticketmaster.
            ...(geo.photoUrl ? { photoUrl: geo.photoUrl } : {}),
          })
          .where(eq(venues.id, venue.id));
        resolved++;
        log.info(
          {
            event: 'venue.placeid.updated',
            venueId: venue.id,
            venueName: venue.name,
            googlePlaceId: geo.googlePlaceId,
            hadPhoto: Boolean(geo.photoUrl),
          },
          'Linked venue to Google Place',
        );
      } catch (err) {
        // Another row already owns this Place ID. Log and move on; the
        // partial UNIQUE index on `google_place_id` enforces global
        // singularity, and the existing row presumably has the same data.
        if (isUniqueViolation(err)) {
          missing++;
          log.warn(
            {
              event: 'venue.placeid.conflict',
              venueId: venue.id,
              venueName: venue.name,
              googlePlaceId: geo.googlePlaceId,
            },
            'Place ID already linked to another venue; skipping',
          );
          continue;
        }
        throw err;
      }
    } catch (err) {
      failed++;
      log.error(
        { err, event: 'venue.placeid.failed', venueId: venue.id, venueName: venue.name },
        'Place ID lookup failed',
      );
    }
  }

  return { resolved, missing, failed };
}

export async function runBackfillVenuePhotos(): Promise<BackfillVenuePhotosSummary> {
  const placeIdSummary = await resolveMissingPlaceIds();

  // Photo pass: every venue with a Place ID. We refresh even rows that
  // already have a photoUrl because Google rotates the per-photo resource
  // name (~weekly) — stale names cause the venue-photo proxy to 502 and
  // RemoteImage falls back to the initials placeholder. We only write
  // when the resource name actually changes.
  const rows = await db
    .select({
      id: venues.id,
      name: venues.name,
      googlePlaceId: venues.googlePlaceId,
      photoUrl: venues.photoUrl,
    })
    .from(venues)
    .where(isNotNull(venues.googlePlaceId));

  let updated = 0;
  let refreshed = 0;
  let missing = 0;
  let failed = 0;

  for (const [index, venue] of rows.entries()) {
    if (!venue.googlePlaceId) continue;
    if (index > 0) await sleep(WAIT_MS);

    try {
      const details = await getPlaceDetails(venue.googlePlaceId);
      if (!details?.photoUrl) {
        missing++;
        log.info({ event: 'venue.photo.missing', venueId: venue.id, venueName: venue.name }, 'No photo on Place');
        continue;
      }

      if (details.photoUrl === venue.photoUrl) continue;

      await db
        .update(venues)
        .set({ photoUrl: details.photoUrl })
        .where(eq(venues.id, venue.id));

      if (venue.photoUrl == null) {
        updated++;
        log.info({ event: 'venue.photo.updated', venueId: venue.id, venueName: venue.name }, 'Updated venue photo');
      } else {
        refreshed++;
        log.info(
          { event: 'venue.photo.refreshed', venueId: venue.id, venueName: venue.name },
          'Refreshed stale venue photo resource name',
        );
      }
    } catch (err) {
      failed++;
      log.error({ err, event: 'venue.photo.failed', venueId: venue.id, venueName: venue.name }, 'Photo lookup failed');
    }
  }

  const summary: BackfillVenuePhotosSummary = {
    total: rows.length,
    updated,
    missing,
    failed,
    placeIdResolved: placeIdSummary.resolved,
    placeIdMissing: placeIdSummary.missing,
    placeIdFailed: placeIdSummary.failed,
    photoRefreshed: refreshed,
  };

  log.info({ event: 'venue.photo.done', ...summary }, 'Backfill complete');

  return summary;
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  runBackfillVenuePhotos()
    .then(async () => {
      await flushObservability();
      process.exit(0);
    })
    .catch(async (err) => {
      log.error({ err, event: 'venue.photo.fatal' }, 'Backfill failed');
      await flushObservability();
      process.exit(1);
    });
}
