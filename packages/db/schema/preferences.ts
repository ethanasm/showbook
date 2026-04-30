import { boolean, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const themeEnum = pgEnum('theme', ['system', 'light', 'dark']);

export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id),
  theme: themeEnum('theme').default('system'),
  compactMode: boolean('compact_mode').default(false),
  emailNotifications: boolean('email_notifications').default(true),
  pushNotifications: boolean('push_notifications').default(true),
  lastDigestSentAt: timestamp('last_digest_sent_at', { withTimezone: true }),
});
