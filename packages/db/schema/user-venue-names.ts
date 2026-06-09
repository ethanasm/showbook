import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';
import { venues } from './venues';

/**
 * Per-user venue name overrides ("aliases"). A user editing a venue's name
 * writes a row here instead of mutating the shared `venues.name`, so the
 * rename is visible only to them. Read paths COALESCE the override over the
 * canonical name (see `packages/api/src/venue-names.ts`).
 *
 * Both FKs cascade on delete: deleting a user drops their aliases, and the
 * `cleanup_orphaned_venue` trigger that hard-deletes an unreferenced venue
 * should take its aliases with it. The composite PK `(userId, venueId)`
 * serves every lookup (`WHERE user_id = ? AND venue_id IN (...)`), so no
 * extra index is needed.
 */
export const userVenueNames = pgTable(
  'user_venue_names',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'cascade' }),
    customName: text('custom_name').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.venueId] })]
);
