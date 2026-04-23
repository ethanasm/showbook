import { z } from 'zod';
import { eq, and, not } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { userPreferences, userRegions } from '@showbook/db';

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
  showDayReminder: z.boolean().optional(),
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

      return updated;
    }),
});
