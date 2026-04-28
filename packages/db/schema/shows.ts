import {
  date,
  decimal,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { venues } from './venues';
import { performers } from './performers';

export const kindEnum = pgEnum('kind', [
  'concert',
  'theatre',
  'comedy',
  'festival',
]);

export const stateEnum = pgEnum('state', ['past', 'ticketed', 'watching']);

export const performerRoleEnum = pgEnum('performer_role', [
  'headliner',
  'support',
  'cast',
]);

export const shows = pgTable(
  'shows',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    kind: kindEnum('kind').notNull(),
    state: stateEnum('state').notNull(),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id),
    date: date('date').notNull(),
    endDate: date('end_date'),
    seat: text('seat'),
    pricePaid: decimal('price_paid', { precision: 10, scale: 2 }),
    ticketCount: integer('ticket_count').notNull().default(1),
    tourName: text('tour_name'),
    productionName: text('production_name'),
    setlist: text('setlist').array(),
    photos: text('photos').array(),
    sourceRefs: jsonb('source_refs'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('shows_user_state_idx').on(table.userId, table.state),
    index('shows_user_date_idx').on(table.userId, table.date),
    index('shows_user_kind_idx').on(table.userId, table.kind),
    index('shows_venue_idx').on(table.venueId),
  ]
);

export const showPerformers = pgTable(
  'show_performers',
  {
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id),
    performerId: uuid('performer_id')
      .notNull()
      .references(() => performers.id),
    role: performerRoleEnum('role').notNull(),
    characterName: text('character_name'),
    sortOrder: integer('sort_order').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.showId, table.performerId, table.role] }),
  ]
);
