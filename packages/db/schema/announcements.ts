import {
  date,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { venues } from './venues';
import { performers } from './performers';
import { shows } from './shows';
import { kindEnum } from './shows';

export const onSaleStatusEnum = pgEnum('on_sale_status', [
  'announced',
  'on_sale',
  'sold_out',
]);

export const announcementSourceEnum = pgEnum('announcement_source', [
  'ticketmaster',
  'manual',
]);

export const announcements = pgTable('announcements', {
  id: uuid('id').defaultRandom().primaryKey(),
  venueId: uuid('venue_id')
    .notNull()
    .references(() => venues.id),
  kind: kindEnum('kind').notNull(),
  headliner: text('headliner').notNull(),
  headlinerPerformerId: uuid('headliner_performer_id').references(
    () => performers.id
  ),
  support: text('support').array(),
  showDate: date('show_date').notNull(),
  onSaleDate: timestamp('on_sale_date'),
  onSaleStatus: onSaleStatusEnum('on_sale_status').notNull(),
  source: announcementSourceEnum('source').notNull(),
  sourceEventId: text('source_event_id'),
  discoveredAt: timestamp('discovered_at').defaultNow().notNull(),
});

export const showAnnouncementLinks = pgTable(
  'show_announcement_links',
  {
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => announcements.id),
  },
  (table) => [
    primaryKey({ columns: [table.showId, table.announcementId] }),
  ]
);
