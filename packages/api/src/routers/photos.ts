import crypto from 'crypto';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { shows } from '@showbook/db';
import { uploadToR2, deleteFromR2, getPublicUrl } from '../r2';
import { processImage } from '../image-processing';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function photoKey(
  userId: string,
  showId: string,
  photoId: string,
  variant: 'thumb' | 'card' | 'full'
): string {
  return `showbook/${userId}/shows/${showId}/photos/${photoId}/${variant}.webp`;
}

function photoUrls(userId: string, showId: string, photoId: string) {
  return {
    thumb: getPublicUrl(photoKey(userId, showId, photoId, 'thumb')),
    card: getPublicUrl(photoKey(userId, showId, photoId, 'card')),
    full: getPublicUrl(photoKey(userId, showId, photoId, 'full')),
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const photosRouter = router({
  upload: protectedProcedure
    .input(
      z.object({
        showId: z.string().uuid(),
        imageBase64: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify show ownership
      const [show] = await ctx.db
        .select()
        .from(shows)
        .where(and(eq(shows.id, input.showId), eq(shows.userId, userId)))
        .limit(1);

      if (!show) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Show not found' });
      }

      // Generate photo ID
      const photoId = `ph_${crypto.randomUUID().slice(0, 8)}`;

      // Decode base64 to buffer
      const imageBuffer = Buffer.from(input.imageBase64, 'base64');

      // Process into 3 variants
      const processed = await processImage(imageBuffer);

      // Upload all 3 variants to R2
      await Promise.all([
        uploadToR2(
          photoKey(userId, input.showId, photoId, 'thumb'),
          processed.thumb,
          'image/webp'
        ),
        uploadToR2(
          photoKey(userId, input.showId, photoId, 'card'),
          processed.card,
          'image/webp'
        ),
        uploadToR2(
          photoKey(userId, input.showId, photoId, 'full'),
          processed.full,
          'image/webp'
        ),
      ]);

      // Append photo ID to the show's photos array
      await ctx.db
        .update(shows)
        .set({
          photos: sql`array_append(coalesce(${shows.photos}, '{}'), ${photoId})`,
          updatedAt: new Date(),
        })
        .where(eq(shows.id, input.showId));

      const urls = photoUrls(userId, input.showId, photoId);

      return { photoId, urls };
    }),

  delete: protectedProcedure
    .input(
      z.object({
        showId: z.string().uuid(),
        photoId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify show ownership
      const [show] = await ctx.db
        .select()
        .from(shows)
        .where(and(eq(shows.id, input.showId), eq(shows.userId, userId)))
        .limit(1);

      if (!show) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Show not found' });
      }

      // Delete all 3 variants from R2
      await Promise.all([
        deleteFromR2(photoKey(userId, input.showId, input.photoId, 'thumb')),
        deleteFromR2(photoKey(userId, input.showId, input.photoId, 'card')),
        deleteFromR2(photoKey(userId, input.showId, input.photoId, 'full')),
      ]);

      // Remove photo ID from the show's photos array
      await ctx.db
        .update(shows)
        .set({
          photos: sql`array_remove(${shows.photos}, ${input.photoId})`,
          updatedAt: new Date(),
        })
        .where(eq(shows.id, input.showId));

      return { success: true };
    }),

  getUrls: protectedProcedure
    .input(z.object({ showId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify show ownership and get photos
      const [show] = await ctx.db
        .select({ photos: shows.photos })
        .from(shows)
        .where(and(eq(shows.id, input.showId), eq(shows.userId, userId)))
        .limit(1);

      if (!show) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Show not found' });
      }

      const photoIds = show.photos ?? [];

      return photoIds.map((photoId) => ({
        photoId,
        ...photoUrls(userId, input.showId, photoId),
      }));
    }),
});
