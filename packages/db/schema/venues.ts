import {
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
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
    // matchOrCreateVenue looks up by these IDs on every show creation, every
    // discover ingest, and every backfill. Without an index that's a seq
    // scan. Not unique because today's data may already contain duplicates.
    index('venues_tm_venue_id_idx').on(table.ticketmasterVenueId),
    index('venues_google_place_id_idx').on(table.googlePlaceId),
    index('venues_name_city_idx').on(table.name, table.city),
  ]
);
