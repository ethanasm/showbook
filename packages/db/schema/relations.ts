import { relations } from 'drizzle-orm';
import { users } from './users';
import { venues } from './venues';
import { performers } from './performers';
import { shows, showPerformers } from './shows';
import { announcements, showAnnouncementLinks } from './announcements';
import { userVenueFollows, userPerformerFollows } from './follows';
import { userRegions } from './regions';
import { enrichmentQueue } from './enrichment';
import { userPreferences } from './preferences';

// ── User relations ──────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many, one }) => ({
  shows: many(shows),
  venueFollows: many(userVenueFollows),
  performerFollows: many(userPerformerFollows),
  regions: many(userRegions),
  preferences: one(userPreferences),
}));

// ── Venue relations ─────────────────────────────────────────────────
export const venuesRelations = relations(venues, ({ many }) => ({
  shows: many(shows),
  announcements: many(announcements),
  followers: many(userVenueFollows),
}));

// ── Performer relations ─────────────────────────────────────────────
export const performersRelations = relations(performers, ({ many }) => ({
  showPerformers: many(showPerformers),
  followers: many(userPerformerFollows),
}));

// ── Show relations ──────────────────────────────────────────────────
export const showsRelations = relations(shows, ({ one, many }) => ({
  user: one(users, {
    fields: [shows.userId],
    references: [users.id],
  }),
  venue: one(venues, {
    fields: [shows.venueId],
    references: [venues.id],
  }),
  showPerformers: many(showPerformers),
  announcementLinks: many(showAnnouncementLinks),
  enrichmentQueue: many(enrichmentQueue),
}));

// ── ShowPerformer relations ─────────────────────────────────────────
export const showPerformersRelations = relations(
  showPerformers,
  ({ one }) => ({
    show: one(shows, {
      fields: [showPerformers.showId],
      references: [shows.id],
    }),
    performer: one(performers, {
      fields: [showPerformers.performerId],
      references: [performers.id],
    }),
  })
);

// ── Announcement relations ──────────────────────────────────────────
export const announcementsRelations = relations(
  announcements,
  ({ one, many }) => ({
    venue: one(venues, {
      fields: [announcements.venueId],
      references: [venues.id],
    }),
    headlinerPerformer: one(performers, {
      fields: [announcements.headlinerPerformerId],
      references: [performers.id],
    }),
    showLinks: many(showAnnouncementLinks),
  })
);

// ── ShowAnnouncementLink relations ──────────────────────────────────
export const showAnnouncementLinksRelations = relations(
  showAnnouncementLinks,
  ({ one }) => ({
    show: one(shows, {
      fields: [showAnnouncementLinks.showId],
      references: [shows.id],
    }),
    announcement: one(announcements, {
      fields: [showAnnouncementLinks.announcementId],
      references: [announcements.id],
    }),
  })
);

// ── Follow relations ────────────────────────────────────────────────
export const userVenueFollowsRelations = relations(
  userVenueFollows,
  ({ one }) => ({
    user: one(users, {
      fields: [userVenueFollows.userId],
      references: [users.id],
    }),
    venue: one(venues, {
      fields: [userVenueFollows.venueId],
      references: [venues.id],
    }),
  })
);

export const userPerformerFollowsRelations = relations(
  userPerformerFollows,
  ({ one }) => ({
    user: one(users, {
      fields: [userPerformerFollows.userId],
      references: [users.id],
    }),
    performer: one(performers, {
      fields: [userPerformerFollows.performerId],
      references: [performers.id],
    }),
  })
);

// ── Region relations ────────────────────────────────────────────────
export const userRegionsRelations = relations(userRegions, ({ one }) => ({
  user: one(users, {
    fields: [userRegions.userId],
    references: [users.id],
  }),
}));

// ── Enrichment queue relations ──────────────────────────────────────
export const enrichmentQueueRelations = relations(
  enrichmentQueue,
  ({ one }) => ({
    show: one(shows, {
      fields: [enrichmentQueue.showId],
      references: [shows.id],
    }),
  })
);

// ── Preferences relations ───────────────────────────────────────────
export const userPreferencesRelations = relations(
  userPreferences,
  ({ one }) => ({
    user: one(users, {
      fields: [userPreferences.userId],
      references: [users.id],
    }),
  })
);
