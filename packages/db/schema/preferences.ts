import { boolean, pgEnum, pgTable, text, time } from 'drizzle-orm/pg-core';
import { users } from './users';

export const digestFrequencyEnum = pgEnum('digest_frequency', [
  'daily',
  'weekly',
  'off',
]);

export const themeEnum = pgEnum('theme', ['system', 'light', 'dark']);

export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id),
  theme: themeEnum('theme').default('system'),
  compactMode: boolean('compact_mode').default(false),
  digestFrequency: digestFrequencyEnum('digest_frequency').default('daily'),
  digestTime: time('digest_time').default('08:00'),
  emailNotifications: boolean('email_notifications').default(true),
  pushNotifications: boolean('push_notifications').default(true),
});
