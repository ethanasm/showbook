import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';
import { venues } from './venues';
import { performers } from './performers';

export const userVenueFollows = pgTable(
  'user_venue_follows',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    performerId: uuid('performer_id')
      .notNull()
      .references(() => performers.id),
    followedAt: timestamp('followed_at').defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.performerId] })]
);
