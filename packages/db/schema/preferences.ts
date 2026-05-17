import { boolean, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const themeEnum = pgEnum('theme', ['system', 'light', 'dark']);

// Phase 11 (§15o) — user override for the spoiler-curtain default.
// 'style_default' falls back to `prediction.spoilerBlurDefault` from
// the algorithm (true for stable/theatrical, false for rotating/
// improvised); 'always_blur' / 'never_blur' force the behavior.
// Applied across the predicted-setlist tab AND the daily digest's
// PredictedSetlistTile.
export const setlistSpoilersPrefEnum = pgEnum('setlist_spoilers_pref', [
  'always_blur',
  'never_blur',
  'style_default',
]);

export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  theme: themeEnum('theme').default('system'),
  compactMode: boolean('compact_mode').default(false),
  emailNotifications: boolean('email_notifications').default(true),
  pushNotifications: boolean('push_notifications').default(true),
  lastDigestSentAt: timestamp('last_digest_sent_at', { withTimezone: true }),
  setlistSpoilers: setlistSpoilersPrefEnum('setlist_spoilers').default(
    'style_default',
  ),
});
