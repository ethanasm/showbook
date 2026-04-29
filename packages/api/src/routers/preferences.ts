import { z } from 'zod';
import { eq, and, not, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { userPreferences, userRegions, userVenueFollows, userPerformerFollows, announcements, venues } from '@showbook/db';
import { enqueueIngestRegion } from '../job-queue';

// ---------------------------------------------------------------------------
// Pure cleanup helper — unit-testable without DB
// ---------------------------------------------------------------------------

export interface AnnouncementCandidate {
  id: string;
  venueId: string;
  headlinerPerformerId: string | null;
  venueLat: number | null;
  venueLng: number | null;
}

export interface RegionBbox {
  latitude: number;
  longitude: number;
  radiusMiles: number;
}

export function isVenueInBbox(lat: number, lng: number, region: RegionBbox): boolean {
  const latDelta = region.radiusMiles / 69.0;
  const lngDelta = region.radiusMiles / (69.0 * Math.cos((region.latitude * Math.PI) / 180));
  return (
    lat >= region.latitude - latDelta &&
    lat <= region.latitude + latDelta &&
    lng >= region.longitude - lngDelta &&
    lng <= region.longitude + lngDelta
  );
}

export function computeAnnouncementsToDelete(
  candidates: AnnouncementCandidate[],
  removedRegion: RegionBbox,
  otherActiveRegions: RegionBbox[],
  followedVenueIds: string[],
  followedPerformerIds: string[],
): string[] {
  const followedVenueSet = new Set(followedVenueIds);
  const followedPerformerSet = new Set(followedPerformerIds);

  return candidates
    .filter((a) => {
      // Only consider announcements whose venue was in the removed region
      if (a.venueLat == null || a.venueLng == null) return false;
      if (!isVenueInBbox(a.venueLat, a.venueLng, removedRegion)) return false;

      // Keep if venue is in another active region
      if (otherActiveRegions.some((r) => isVenueInBbox(a.venueLat!, a.venueLng!, r))) return false;

      // Keep if user directly follows this venue
      if (followedVenueSet.has(a.venueId)) return false;

      // Keep if user follows the headliner performer
      if (a.headlinerPerformerId && followedPerformerSet.has(a.headlinerPerformerId)) return false;

      return true;
    })
    .map((a) => a.id);
}

export function computePerformerAnnouncementsToDelete(
  candidates: AnnouncementCandidate[],
  allActiveRegions: RegionBbox[],
  allFollowedVenueIds: string[],
): string[] {
  const followedVenueSet = new Set(allFollowedVenueIds);

  return candidates
    .filter((a) => {
      if (a.venueLat == null || a.venueLng == null) return false;
      if (followedVenueSet.has(a.venueId)) return false;
      if (allActiveRegions.some((r) => isVenueInBbox(a.venueLat!, a.venueLng!, r))) return false;
      return true;
    })
    .map((a) => a.id);
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const updatePreferencesSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).optional(),
  compactMode: z.boolean().optional(),
  digestFrequency: z.enum(['daily', 'weekly', 'off']).optional(),
  digestTime: z.string().optional(),
  emailNotifications: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
});

const addRegionSchema = z.object({
  cityName: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  radiusMiles: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const preferencesRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Fetch preferences, creating defaults if none exist
    let [preferences] = await ctx.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);

    if (!preferences) {
      [preferences] = await ctx.db
        .insert(userPreferences)
        .values({ userId })
        .returning();
    }

    // Fetch all regions for this user
    const regions = await ctx.db
      .select()
      .from(userRegions)
      .where(eq(userRegions.userId, userId));

    return { preferences, regions };
  }),

  update: protectedProcedure
    .input(updatePreferencesSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const [preferences] = await ctx.db
        .insert(userPreferences)
        .values({ userId, ...input })
        .onConflictDoUpdate({
          target: userPreferences.userId,
          set: input,
        })
        .returning();

      return preferences;
    }),

  addRegion: protectedProcedure
    .input(addRegionSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const existing = await ctx.db
        .select({ id: userRegions.id })
        .from(userRegions)
        .where(eq(userRegions.userId, userId));

      if (existing.length >= 5) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'You can have at most 5 regions.',
        });
      }

      const [region] = await ctx.db
        .insert(userRegions)
        .values({
          userId,
          cityName: input.cityName,
          latitude: input.latitude,
          longitude: input.longitude,
          radiusMiles: input.radiusMiles,
        })
        .returning();

      await enqueueIngestRegion(region.id);

      return region;
    }),

  removeRegion: protectedProcedure
    .input(z.object({ regionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify ownership
      const [existing] = await ctx.db
        .select()
        .from(userRegions)
        .where(
          and(
            eq(userRegions.id, input.regionId),
            eq(userRegions.userId, userId)
          )
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Region not found',
        });
      }

      // Gather data for smart cleanup before deletion
      const otherRegions = await ctx.db
        .select()
        .from(userRegions)
        .where(
          and(
            eq(userRegions.userId, userId),
            eq(userRegions.active, true),
          )
        );
      const otherActiveRegions = otherRegions.filter((r) => r.id !== input.regionId);

      const followedVenueRows = await ctx.db
        .select({ venueId: userVenueFollows.venueId })
        .from(userVenueFollows)
        .where(eq(userVenueFollows.userId, userId));
      const followedVenueIds = followedVenueRows.map((r) => r.venueId);

      const followedPerformerRows = await ctx.db
        .select({ performerId: userPerformerFollows.performerId })
        .from(userPerformerFollows)
        .where(eq(userPerformerFollows.userId, userId));
      const followedPerformerIds = followedPerformerRows.map((r) => r.performerId);

      // Find announcements whose venue is in the removed region's bbox
      const removedRegion: RegionBbox = {
        latitude: existing.latitude,
        longitude: existing.longitude,
        radiusMiles: existing.radiusMiles,
      };
      const latDelta = removedRegion.radiusMiles / 69.0;
      const lngDelta = removedRegion.radiusMiles / (69.0 * Math.cos((removedRegion.latitude * Math.PI) / 180));

      const candidateRows = await ctx.db
        .select({
          id: announcements.id,
          venueId: announcements.venueId,
          headlinerPerformerId: announcements.headlinerPerformerId,
          venueLat: venues.latitude,
          venueLng: venues.longitude,
        })
        .from(announcements)
        .innerJoin(venues, eq(announcements.venueId, venues.id))
        .where(
          sql`(
            ${venues.latitude} BETWEEN ${removedRegion.latitude - latDelta} AND ${removedRegion.latitude + latDelta}
            AND ${venues.longitude} BETWEEN ${removedRegion.longitude - lngDelta} AND ${removedRegion.longitude + lngDelta}
          )`
        );

      const toDelete = computeAnnouncementsToDelete(
        candidateRows.map((r) => ({
          id: r.id,
          venueId: r.venueId,
          headlinerPerformerId: r.headlinerPerformerId,
          venueLat: r.venueLat,
          venueLng: r.venueLng,
        })),
        removedRegion,
        otherActiveRegions.map((r) => ({
          latitude: r.latitude,
          longitude: r.longitude,
          radiusMiles: r.radiusMiles,
        })),
        followedVenueIds,
        followedPerformerIds,
      );

      if (toDelete.length > 0) {
        await ctx.db
          .delete(announcements)
          .where(inArray(announcements.id, toDelete));
      }

      await ctx.db
        .delete(userRegions)
        .where(eq(userRegions.id, input.regionId));

      return { success: true as const };
    }),

  toggleRegion: protectedProcedure
    .input(z.object({ regionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify ownership
      const [existing] = await ctx.db
        .select()
        .from(userRegions)
        .where(
          and(
            eq(userRegions.id, input.regionId),
            eq(userRegions.userId, userId)
          )
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Region not found',
        });
      }

      const [updated] = await ctx.db
        .update(userRegions)
        .set({ active: not(userRegions.active) })
        .where(eq(userRegions.id, input.regionId))
        .returning();

      // Re-activating a region should backfill announcements just like adding.
      if (updated.active && !existing.active) {
        await enqueueIngestRegion(updated.id);
      }

      return updated;
    }),
});
