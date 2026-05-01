import { sql } from 'drizzle-orm';
import {
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const venues = pgTable(
  'venues',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    city: text('city').notNull(),
    stateRegion: text('state_region'),
    country: text('country').notNull(),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    ticketmasterVenueId: text('ticketmaster_venue_id'),
    googlePlaceId: text('google_place_id'),
    photoUrl: text('photo_url'),
    scrapeConfig: jsonb('scrape_config'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // Partial UNIQUE on the external IDs: a single TM venue id / Google
    // place id should map to exactly one row. The IS NOT NULL predicate
    // keeps the constraint from forcing every row to fill the column.
    // matchOrCreateVenue's catch(isUniqueViolation) branch relies on
    // these indexes to fall back to the existing row under a race.
    uniqueIndex('venues_tm_venue_uniq')
      .on(table.ticketmasterVenueId)
      .where(sql`${table.ticketmasterVenueId} IS NOT NULL`),
    uniqueIndex('venues_google_place_uniq')
      .on(table.googlePlaceId)
      .where(sql`${table.googlePlaceId} IS NOT NULL`),
    index('venues_name_city_idx').on(table.name, table.city),
  ]
);
