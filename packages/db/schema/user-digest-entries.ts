import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { announcements } from './announcements';

// Mirrors `BucketedAnnouncement.reason` in packages/jobs/src/notifications.ts:
// why a given announcement landed in the user's daily-digest snapshot.
export const digestReasonEnum = pgEnum('digest_reason', [
  'venue',
  'artist',
  'region',
]);

// Per-user snapshot of the daily digest's "new for you" announcement set,
// written by `runDailyDigest` (replace-on-write: the job deletes a user's
// rows and re-inserts the fresh set each run) and read back by the
// `discover.digestFeed` tRPC query that powers the Discover "New for you"
// tab. Only membership + ordering live here — the row is re-joined to the
// live `announcements`/`venues`/`performers` rows at read time, so detail
// edits stay fresh and pruned announcements drop out via the inner join.
export const userDigestEntries = pgTable(
  'user_digest_entries',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => announcements.id, { onDelete: 'cascade' }),
    reason: digestReasonEnum('reason').notNull(),
    onSaleSoon: boolean('on_sale_soon').notNull().default(false),
    // Bucketing output order (priority venue > artist > region, then date).
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.announcementId] }),
    index('user_digest_entries_user_position_idx').on(
      table.userId,
      table.position,
    ),
  ],
);
