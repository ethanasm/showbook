import { pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';
import { venues } from './venues';
import { performers } from './performers';

export const userVenueFollows = pgTable(
  'user_venue_follows',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id),
    followedAt: timestamp('followed_at').defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.venueId] })]
);

export const userPerformerFollows = pgTable(
  'user_performer_follows',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    performerId: uuid('performer_id')
      .notNull()
      .references(() => performers.id),
    followedAt: timestamp('followed_at').defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.performerId] })]
);
