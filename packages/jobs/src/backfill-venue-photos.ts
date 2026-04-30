// MUST be the first import: loads .env.local from the workspace root before
// anything reads process.env at module init time (DB client, Places key …).
import './load-env-local';

import { db, venues } from '@showbook/db';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { getPlaceDetails } from '@showbook/api/google-places';

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
        console.log(`[venue-photos] no photo: ${venue.name}`);
        continue;
      }

      await db
        .update(venues)
        .set({ photoUrl: details.photoUrl })
        .where(eq(venues.id, venue.id));
      updated++;
      console.log(`[venue-photos] updated: ${venue.name}`);
    } catch (err) {
      failed++;
      console.error(`[venue-photos] failed: ${venue.name}`, err);
    }
  }

  console.log(
    `[venue-photos] done total=${rows.length} updated=${updated} missing=${missing} failed=${failed}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
