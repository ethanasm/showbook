import {
  doublePrecision,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const venues = pgTable('venues', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  neighborhood: text('neighborhood'),
  city: text('city').notNull(),
  stateRegion: text('state_region'),
  country: text('country').notNull(),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  ticketmasterVenueId: text('ticketmaster_venue_id'),
  googlePlaceId: text('google_place_id'),
  scrapeConfig: jsonb('scrape_config'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
