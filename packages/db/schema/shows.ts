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
import type { PerformerSetlistsMap } from '@showbook/shared';
import { users } from './users';
import { venues } from './venues';
import { performers } from './performers';

export const kindEnum = pgEnum('kind', [
  'concert',
  'theatre',
  'comedy',
  'festival',
  'sports',
  'film',
  'unknown',
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
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: kindEnum('kind').notNull(),
    state: stateEnum('state').notNull(),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id),
    // Nullable: state='watching' AND date IS NULL means "intent without a
    // committed performance date" — typically a multi-night theatre run the
    // user wants to see but hasn't picked a night for yet. Once the user
    // picks a date or buys tickets, this is set. Not "missing data."
    date: date('date'),
    endDate: date('end_date'),
    seat: text('seat'),
    pricePaid: decimal('price_paid', { precision: 10, scale: 2 }),
    ticketCount: integer('ticket_count').notNull().default(1),
    tourName: text('tour_name'),
    productionName: text('production_name'),
    // Legacy column — kept for historical rows. New writes go to `setlists`.
    setlist: text('setlist').array(),
    setlists: jsonb('setlists').$type<PerformerSetlistsMap>(),
    photos: text('photos').array(),
    coverImageUrl: text('cover_image_url'),
    sourceRefs: jsonb('source_refs'),
    ticketUrl: text('ticket_url'),
    notes: text('notes'),
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
      .references(() => shows.id, { onDelete: 'cascade' }),
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
