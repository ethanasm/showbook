import { z } from 'zod';
import { eq, and, asc, desc, gte, sql, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import {
  venues,
  userVenueFollows,
  userVenueNames,
  userPerformerFollows,
  userRegions,
  announcements,
  shows,
  showPerformers,
  performers,
  showAnnouncementLinks,
  type Database,
} from '@showbook/db';
import { showMatchesAnnouncement } from '@showbook/shared';
import { getPlaceDetails } from '../google-places';
import { matchOrCreateVenue } from '../venue-matcher';
import { geocodeVenue } from '../geocode';
import { enqueueIngestVenue } from '../job-queue';
import { scrapeConfigSchema, parseScrapeConfig } from '../scrape-config';
import { venueScrapeRuns } from '@showbook/db';
import { computeVenueUnfollowAnnouncementsToDelete } from './preferences';
import { enforceRateLimit } from '../rate-limit';
import { assertUnderFollowCap } from '../follow-caps';
import { loadVenueNameOverrides } from '../venue-names';
import { child } from '@showbook/observability';

const log = child({ component: 'api.venues' });

/**
 * Upper bound on how many future announcements we scan when deduping
 * against the user's logged shows at a venue. The dedup is in-memory
 * (joining + fuzzy-matching headliner / production names against the user's
 * shows at the same venue), so the bound exists to keep one user pinning
 * a pathological venue from blowing up the request. Real-world venues
 * rarely break double digits.
 */
const UPCOMING_DEDUP_SCAN_CAP = 200;

/**
 * Load future announcements for a venue, with announcements that map to a
 * show the user already has (either via `show_announcement_links` or via
 * a fuzzy match on date + name) filtered out. Shared between the
 * `detail.upcomingCount` stat and the `upcomingAnnouncements` list so the
 * two never disagree.
 */
async function getDedupedUpcomingAnnouncements(
  db: Database,
  userId: string,
  venueId: string,
  today: string,
) {
  const rows = await db
    .select()
    .from(announcements)
    .where(
      and(
        eq(announcements.venueId, venueId),
        gte(announcements.showDate, today),
      ),
    )
    .orderBy(asc(announcements.showDate), asc(announcements.id))
    .limit(UPCOMING_DEDUP_SCAN_CAP);

  if (rows.length === 0) return rows;

  // Announcements that already point at a show the user owns get dropped
  // outright — that's the explicit dedup signal and avoids re-running the
  // fuzzy match against the user's own watch/ticket actions.
  const linkedRows = await db
    .select({ announcementId: showAnnouncementLinks.announcementId })
    .from(showAnnouncementLinks)
    .innerJoin(shows, eq(shows.id, showAnnouncementLinks.showId))
    .where(and(eq(shows.userId, userId), eq(shows.venueId, venueId)));
  const linkedSet = new Set(linkedRows.map((r) => r.announcementId));

  // User's shows at this venue + headliner name (via show_performers ->
  // performers) so the fuzzy matcher can fall back from productionName to
  // headlinerName.
  const userShowRows = await db
    .select({
      date: shows.date,
      endDate: shows.endDate,
      productionName: shows.productionName,
      headlinerName: performers.name,
    })
    .from(shows)
    .leftJoin(
      showPerformers,
      and(eq(showPerformers.showId, shows.id), eq(showPerformers.role, 'headliner')),
    )
    .leftJoin(performers, eq(performers.id, showPerformers.performerId))
    .where(and(eq(shows.userId, userId), eq(shows.venueId, venueId)));

  return rows.filter((a) => {
    if (linkedSet.has(a.id)) return false;
    return !userShowRows.some((s) => showMatchesAnnouncement(s, a));
  });
}

/**
 * Authorize a caller against shared venue state (rename, scrape config):
 * the user must either follow the venue OR have a show at it. Mirrors the
 * inline check in `rename` so the scrape-config read/write paths can't be
 * driven against arbitrary venues by venueId alone. Throws FORBIDDEN.
 */
async function assertVenueAccess(
  db: Database,
  userId: string,
  venueId: string,
): Promise<void> {
  const [follow] = await db
    .select({ venueId: userVenueFollows.venueId })
    .from(userVenueFollows)
    .where(
      and(
        eq(userVenueFollows.userId, userId),
        eq(userVenueFollows.venueId, venueId),
      ),
    )
    .limit(1);
  if (follow) return;

  const [show] = await db
    .select({ id: shows.id })
    .from(shows)
    .where(and(eq(shows.userId, userId), eq(shows.venueId, venueId)))
    .limit(1);
  if (show) return;

  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'Not authorized for this venue',
  });
}

export const venuesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const today = new Date().toISOString().slice(0, 10);

    const rows = await ctx.db
      .select({
        id: venues.id,
        name: venues.name,
        city: venues.city,
        stateRegion: venues.stateRegion,
        country: venues.country,
        googlePlaceId: venues.googlePlaceId,
        photoUrl: venues.photoUrl,
        ticketmasterVenueId: venues.ticketmasterVenueId,
        pastShowsCount: sql<number>`count(case when ${shows.date} < ${today} then 1 end)::int`,
        futureShowsCount: sql<number>`count(case when ${shows.date} >= ${today} then 1 end)::int`,
      })
      .from(venues)
      .innerJoin(shows, eq(shows.venueId, venues.id))
      .where(eq(shows.userId, userId))
      .groupBy(venues.id);

    const followed = await ctx.db
      .select({ venueId: userVenueFollows.venueId })
      .from(userVenueFollows)
      .where(eq(userVenueFollows.userId, userId));
    const followedSet = new Set(followed.map((f) => f.venueId));

    const overrides = await loadVenueNameOverrides(
      ctx.db,
      userId,
      rows.map((r) => r.id),
    );

    return rows.map((r) => ({
      ...r,
      name: overrides.get(r.id) ?? r.name,
      isFollowed: followedSet.has(r.id),
    }));
  }),

  /**
   * Count of distinct venues the user has shows at — matches the row count
   * returned by `list`. Used by the sidebar badge.
   */
  count: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const [row] = await ctx.db
      .select({ count: sql<number>`count(distinct ${shows.venueId})::int` })
      .from(shows)
      .where(eq(shows.userId, userId));
    return row?.count ?? 0;
  }),

  search: protectedProcedure
    .input(z.object({ query: z.string().min(1).max(200) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      enforceRateLimit(`venues.search:${userId}`, {
        max: 60,
        windowMs: 60_000,
      });
      const rows = await ctx.db
        .select()
        .from(venues)
        .where(sql`${venues.name} ILIKE ${'%' + input.query + '%'}`)
        .limit(20);
      // Match is against the canonical name only; we still surface the
      // user's alias as the displayed `name` so results read consistently
      // with the rest of the app. (A venue matched on its canonical name
      // can therefore show the user's custom name in the result.)
      const overrides = await loadVenueNameOverrides(
        ctx.db,
        userId,
        rows.map((r) => r.id),
      );
      return rows.map((r) => ({ ...r, name: overrides.get(r.id) ?? r.name }));
    }),

  follow: protectedProcedure
    .input(z.object({ venueId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const followed = await ctx.db
        .select({ venueId: userVenueFollows.venueId })
        .from(userVenueFollows)
        .where(eq(userVenueFollows.userId, userId));
      assertUnderFollowCap('venues', followed.map((f) => f.venueId), input.venueId);

      await ctx.db
        .insert(userVenueFollows)
        .values({ userId, venueId: input.venueId })
        .onConflictDoNothing();

      log.info({ event: 'venue.follow', userId, venueId: input.venueId }, 'Venue followed');

      await enqueueIngestVenue(input.venueId);

      // Auto-fill googlePlaceId for venues created via TM ingestion (which
      // skip the venue-matcher geocoding path).
      try {
        const [venue] = await ctx.db
          .select({
            name: venues.name,
            city: venues.city,
            stateRegion: venues.stateRegion,
            googlePlaceId: venues.googlePlaceId,
            photoUrl: venues.photoUrl,
          })
          .from(venues)
          .where(eq(venues.id, input.venueId))
          .limit(1);

        if (venue && (!venue.googlePlaceId || !venue.photoUrl) && venue.name && venue.city) {
          const geo = await geocodeVenue(venue.name, venue.city, venue.stateRegion ?? null);
          if (geo?.googlePlaceId || geo?.photoUrl) {
            const updates: Record<string, unknown> = {};
            if (geo.googlePlaceId && !venue.googlePlaceId) updates.googlePlaceId = geo.googlePlaceId;
            if (geo.photoUrl && !venue.photoUrl) updates.photoUrl = geo.photoUrl;
            await ctx.db
              .update(venues)
              .set(updates)
              .where(eq(venues.id, input.venueId));
          }
        }
      } catch (err) {
        log.warn({ err, event: 'venue.follow.place_backfill_failed', userId, venueId: input.venueId }, 'googlePlaceId backfill failed');
      }

      return { success: true };
    }),

  /**
   * Set a per-user name override for a venue. This is a personal alias —
   * only the editing user sees it; the shared `venues.name` is untouched.
   * Upserts into `user_venue_names`. Returns a `{ id, name, customName }`
   * patch so optimistic caches that write `{ ...prev, name }` keep working.
   */
  rename: protectedProcedure
    .input(z.object({ venueId: z.string().uuid(), name: z.string().min(1).max(300) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await assertVenueAccess(ctx.db, userId, input.venueId);

      const trimmed = input.name.trim();
      const [row] = await ctx.db
        .insert(userVenueNames)
        .values({ userId, venueId: input.venueId, customName: trimmed })
        .onConflictDoUpdate({
          target: [userVenueNames.userId, userVenueNames.venueId],
          set: { customName: trimmed, updatedAt: new Date() },
        })
        .returning();
      log.info(
        { event: 'venue.rename', userId, venueId: input.venueId },
        'Venue alias set',
      );
      return { id: input.venueId, name: row.customName, customName: row.customName };
    }),

  /**
   * Clear a per-user venue-name override, falling back to the canonical
   * `venues.name`. Returns the canonical name so the client can repaint
   * immediately.
   */
  resetName: protectedProcedure
    .input(z.object({ venueId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await assertVenueAccess(ctx.db, userId, input.venueId);

      await ctx.db
        .delete(userVenueNames)
        .where(
          and(
            eq(userVenueNames.userId, userId),
            eq(userVenueNames.venueId, input.venueId),
          ),
        );

      const [venue] = await ctx.db
        .select({ name: venues.name })
        .from(venues)
        .where(eq(venues.id, input.venueId))
        .limit(1);
      if (!venue) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Venue not found' });
      }
      log.info(
        { event: 'venue.rename.reset', userId, venueId: input.venueId },
        'Venue alias cleared',
      );
      return { id: input.venueId, name: venue.name, customName: null };
    }),

  unfollow: protectedProcedure
    .input(z.object({ venueId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await ctx.db
        .delete(userVenueFollows)
        .where(
          and(
            eq(userVenueFollows.userId, userId),
            eq(userVenueFollows.venueId, input.venueId),
          ),
        );

      log.info({ event: 'venue.unfollow', userId, venueId: input.venueId }, 'Venue unfollowed');

      const [stillFollowed] = await ctx.db
        .select({ userId: userVenueFollows.userId })
        .from(userVenueFollows)
        .where(eq(userVenueFollows.venueId, input.venueId))
        .limit(1);

      if (!stillFollowed) {
        // Selectively delete this venue's announcements: drop only those
        // not preserved by some active region or followed performer.
        // show_announcement_links cascade on announcement delete.
        const candidateRows = await ctx.db
          .select({
            id: announcements.id,
            venueId: announcements.venueId,
            headlinerPerformerId: announcements.headlinerPerformerId,
            supportPerformerIds: announcements.supportPerformerIds,
            venueLat: venues.latitude,
            venueLng: venues.longitude,
          })
          .from(announcements)
          .innerJoin(venues, eq(announcements.venueId, venues.id))
          .where(eq(announcements.venueId, input.venueId));

        if (candidateRows.length > 0) {
          const activeRegionRows = await ctx.db
            .select({
              latitude: userRegions.latitude,
              longitude: userRegions.longitude,
              radiusMiles: userRegions.radiusMiles,
            })
            .from(userRegions)
            .where(eq(userRegions.active, true));

          const followedPerformerRows = await ctx.db
            .select({ performerId: userPerformerFollows.performerId })
            .from(userPerformerFollows);

          const toDelete = computeVenueUnfollowAnnouncementsToDelete(
            candidateRows,
            activeRegionRows,
            followedPerformerRows.map((r) => r.performerId),
          );

          if (toDelete.length > 0) {
            await ctx.db
              .delete(announcements)
              .where(inArray(announcements.id, toDelete));
          }
        }
      }

      // Check if the venue was orphan-deleted by the DB trigger
      // (cleanup_orphaned_venue fires when shows + announcements are both gone).
      const [venueStillExists] = await ctx.db
        .select({ id: venues.id })
        .from(venues)
        .where(eq(venues.id, input.venueId))
        .limit(1);

      return { success: true, deleted: !venueStillExists, venueId: input.venueId };
    }),

  createFromPlace: protectedProcedure
    .input(z.object({ placeId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const details = await getPlaceDetails(input.placeId);
      if (!details) throw new Error('Place not found');
      const result = await matchOrCreateVenue({
        name: details.name,
        city: details.city,
        stateRegion: details.stateRegion ?? undefined,
        country: details.country,
        lat: details.latitude,
        lng: details.longitude,
        googlePlaceId: details.googlePlaceId,
        photoUrl: details.photoUrl ?? undefined,
      });
      return result.venue;
    }),

  followed: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const follows = await ctx.db.query.userVenueFollows.findMany({
      where: eq(userVenueFollows.userId, userId),
      with: { venue: true },
    });

    const venueRows = follows.map((f) => f.venue);
    const overrides = await loadVenueNameOverrides(
      ctx.db,
      userId,
      venueRows.map((v) => v.id),
    );
    return venueRows.map((v) => ({ ...v, name: overrides.get(v.id) ?? v.name }));
  }),

  detail: protectedProcedure
    .input(z.object({ venueId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const [venue] = await ctx.db
        .select()
        .from(venues)
        .where(eq(venues.id, input.venueId))
        .limit(1);

      if (!venue) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Venue not found' });
      }

      const [followRow] = await ctx.db
        .select({ venueId: userVenueFollows.venueId })
        .from(userVenueFollows)
        .where(
          and(
            eq(userVenueFollows.userId, userId),
            eq(userVenueFollows.venueId, input.venueId),
          ),
        )
        .limit(1);

      const [{ count: userShowCount } = { count: 0 }] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(shows)
        .where(
          and(eq(shows.venueId, input.venueId), eq(shows.userId, userId)),
        );

      const today = new Date().toISOString().slice(0, 10);
      const dedupedUpcoming = await getDedupedUpcomingAnnouncements(
        ctx.db,
        userId,
        input.venueId,
        today,
      );

      const overrides = await loadVenueNameOverrides(ctx.db, userId, [venue.id]);
      const customName = overrides.get(venue.id) ?? null;

      return {
        ...venue,
        // `name` is the resolved name the UI renders; `canonicalName` is the
        // shared baseline so the UI can offer "reset to original".
        name: customName ?? venue.name,
        canonicalName: venue.name,
        hasCustomName: customName !== null,
        isFollowed: Boolean(followRow),
        userShowCount,
        upcomingCount: dedupedUpcoming.length,
      };
    }),

  /**
   * Save a scrape config (URL + frequency) on a venue. Replaces any existing
   * config. Pass `null` to remove. Visible to anyone who follows the venue.
   * Note: the system prompt is built server-side at scrape time using the
   * venue's name/city/kind history — users do not supply prompt text.
   */
  saveScrapeConfig: protectedProcedure
    .input(
      z.object({
        venueId: z.string().uuid(),
        config: z
          .object({
            url: z.string().url(),
            frequencyDays: z
              .number()
              .int()
              .min(1)
              .max(30)
              .optional()
              .default(7),
          })
          .nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertVenueAccess(ctx.db, ctx.session.user.id, input.venueId);
      if (input.config === null) {
        await ctx.db
          .update(venues)
          .set({ scrapeConfig: null })
          .where(eq(venues.id, input.venueId));
        return { success: true };
      }
      const config = scrapeConfigSchema.parse({
        type: 'llm',
        url: input.config.url,
        frequencyDays: input.config.frequencyDays,
      });
      await ctx.db
        .update(venues)
        .set({ scrapeConfig: config })
        .where(eq(venues.id, input.venueId));
      return { success: true };
    }),

  /**
   * Read the parsed scrape config + the most recent scrape run for a venue.
   * Used by the venue detail page to render the "Scrape config" section
   * with last-run status.
   */
  scrapeStatus: protectedProcedure
    .input(z.object({ venueId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertVenueAccess(ctx.db, ctx.session.user.id, input.venueId);
      const [venue] = await ctx.db
        .select({ scrapeConfig: venues.scrapeConfig })
        .from(venues)
        .where(eq(venues.id, input.venueId))
        .limit(1);
      if (!venue) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Venue not found' });
      }
      const [lastRun] = await ctx.db
        .select()
        .from(venueScrapeRuns)
        .where(eq(venueScrapeRuns.venueId, input.venueId))
        .orderBy(desc(venueScrapeRuns.startedAt))
        .limit(1);
      return {
        config: parseScrapeConfig(venue.scrapeConfig),
        lastRun: lastRun ?? null,
      };
    }),

  upcomingAnnouncements: protectedProcedure
    .input(
      z.object({
        venueId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).optional().default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const today = new Date().toISOString().slice(0, 10);
      const deduped = await getDedupedUpcomingAnnouncements(
        ctx.db,
        ctx.session.user.id,
        input.venueId,
        today,
      );
      return deduped.slice(0, input.limit);
    }),

  userShows: protectedProcedure
    .input(z.object({ venueId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      return ctx.db.query.shows.findMany({
        where: and(
          eq(shows.userId, userId),
          eq(shows.venueId, input.venueId),
        ),
        orderBy: [desc(shows.date)],
        with: {
          showPerformers: {
            with: { performer: true },
          },
        },
      });
    }),

});
