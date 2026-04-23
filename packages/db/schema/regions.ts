import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const userRegions = pgTable('user_regions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  cityName: text('city_name').notNull(),
  latitude: doublePrecision('latitude').notNull(),
  longitude: doublePrecision('longitude').notNull(),
  radiusMiles: integer('radius_miles').notNull(),
  active: boolean('active').notNull().default(true),
});
