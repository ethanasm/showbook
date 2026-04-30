// MUST be the first import: loads .env.local from the workspace root before
// anything reads process.env at module init time (DB client, Places key …).
import './load-env-local';

import { db, venues } from '@showbook/db';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { getPlaceDetails } from '@showbook/api/google-places';
import { child, flushObservability } from '@showbook/observability';

const log = child({ component: 'jobs.backfill-venue-photos' });
const WAIT_MS = 1100;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const rows = await db
    .select({
      id: venues.id,
      name: venues.name,
      googlePlaceId: venues.googlePlaceId,
    })
    .from(venues)
    .where(and(isNotNull(venues.googlePlaceId), isNull(venues.photoUrl)));

  let updated = 0;
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

      await db
        .update(venues)
        .set({ photoUrl: details.photoUrl })
        .where(eq(venues.id, venue.id));
      updated++;
      log.info({ event: 'venue.photo.updated', venueId: venue.id, venueName: venue.name }, 'Updated venue photo');
    } catch (err) {
      failed++;
      log.error({ err, event: 'venue.photo.failed', venueId: venue.id, venueName: venue.name }, 'Photo lookup failed');
    }
  }

  log.info(
    { event: 'venue.photo.done', total: rows.length, updated, missing, failed },
    'Backfill complete',
  );
}

main()
  .then(async () => {
    await flushObservability();
    process.exit(0);
  })
  .catch(async (err) => {
    log.error({ err, event: 'venue.photo.fatal' }, 'Backfill failed');
    await flushObservability();
    process.exit(1);
  });
