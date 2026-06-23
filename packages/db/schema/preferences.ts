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
  // Snapshot idempotency guard for the Discover "New for you" tab, distinct
  // from `lastDigestSentAt` (email only). The digest job advances this for
  // EVERY user (regardless of `emailNotifications`) once it has computed and
  // persisted their `user_digest_entries` snapshot for the day, so a pg-boss
  // retry mid-run won't re-delete/re-clear a snapshot that was already built.
  // It also drives the per-user cutoff (coalesce computed -> sent -> 7d back).
  lastDigestComputedAt: timestamp('last_digest_computed_at', {
    withTimezone: true,
  }),
  setlistSpoilers: setlistSpoilersPrefEnum('setlist_spoilers').default(
    'style_default',
  ),
  // GDPR Art. 6 / Art. 28 consent record for the Gmail-import flow,
  // which ships the matched email subject + body (first 8 KB) to Groq
  // (third-party AI processor) to extract ticket details. Null = the
  // user hasn't been shown the disclosure yet; a timestamp = they
  // accepted at that wall-clock moment. The Gmail scan UI gates on
  // this column being non-null. Operator-triggered re-scans from
  // `/admin` are intentionally ungated.
  acceptedGmailScanAt: timestamp('accepted_gmail_scan_at', {
    withTimezone: true,
  }),
});
