import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import {
  mediaAssetPerformers,
  mediaAssets,
  performers,
  showPerformers,
  shows,
  type MediaVariant,
  type Database,
} from '@showbook/db';
import { router, protectedProcedure } from '../trpc';
import { formatBytes, getMediaConfig } from '../media-config';
import {
  deleteMediaObject,
  getMediaReadUrl,
  getMediaUploadUrl,
  headMediaObject,
} from '../media-storage';
import { child } from '@showbook/observability';

const log = child({ component: 'api.media' });

const pendingOrReady: Array<'pending' | 'ready' | 'failed'> = ['pending', 'ready'];

const variantInput = z.object({
  name: z.string().min(1).max(20),
  mimeType: z.string().min(1).max(100),
  bytes: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

function quotaExceeded(message: string) {
  return new TRPCError({ code: 'BAD_REQUEST', message });
}

async function sumBytes(
  db: Database,
  where: SQL | undefined,
): Promise<number> {
  const [{ total } = { total: 0 }] = await db
    .select({
      total: sql<number>`coalesce(sum(${mediaAssets.bytes}), 0)::double precision`,
    })
    .from(mediaAssets)
    .where(where);
  return Number(total ?? 0);
}

async function getShowOwnedByUser(
  db: Database,
  showId: string,
  userId: string,
) {
  const [show] = await db
    .select()
    .from(shows)
    .where(and(eq(shows.id, showId), eq(shows.userId, userId)))
    .limit(1);
  if (!show) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Show not found' });
  }
  return show;
}

function showTitle(show: {
  kind: string;
  productionName?: string | null;
  showPerformers?: Array<{
    role: string;
    sortOrder: number;
    performer: { name: string };
  }>;
}): string {
  if ((show.kind === 'theatre' || show.kind === 'festival') && show.productionName) {
    return show.productionName;
  }
  const headliner =
    show.showPerformers?.find((sp) => sp.role === 'headliner' && sp.sortOrder === 0) ??
    show.showPerformers?.find((sp) => sp.role === 'headliner');
  return headliner?.performer.name ?? 'Untitled show';
}

async function toMediaDto(asset: typeof mediaAssets.$inferSelect & {
  show?: {
    id: string;
    kind: string;
    date: string | null;
    endDate: string | null;
    productionName: string | null;
    venue?: { id: string; name: string } | null;
    showPerformers?: Array<{
      role: string;
      sortOrder: number;
      performer: { id: string; name: string };
    }>;
  } | null;
  mediaAssetPerformers?: Array<{ performerId: string }>;
}) {
  const variants = asset.variants ?? {};
  const entries: Array<[string, MediaVariant & { url: string }]> = await Promise.all(
    Object.entries(variants).map(async ([name, variant]) => [
      name,
      {
        ...variant,
        url: await getMediaReadUrl(variant.key),
      },
    ] as [string, MediaVariant & { url: string }]),
  );
  const urls = Object.fromEntries(entries.map(([name, variant]) => [name, variant.url]));

  return {
    id: asset.id,
    showId: asset.showId,
    mediaType: asset.mediaType,
    status: asset.status,
    mimeType: asset.mimeType,
    bytes: asset.bytes,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    caption: asset.caption,
    sortOrder: asset.sortOrder,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    variants: Object.fromEntries(entries),
    urls,
    performerIds: asset.mediaAssetPerformers?.map((p) => p.performerId) ?? [],
    sourceShow: asset.show
      ? {
          id: asset.show.id,
          title: showTitle(asset.show),
          date: asset.show.date,
          endDate: asset.show.endDate,
          venue: asset.show.venue
            ? { id: asset.show.venue.id, name: asset.show.venue.name }
            : null,
        }
      : null,
  };
}

export const mediaRouter = router({
  getQuota: protectedProcedure
    .input(z.object({ showId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const config = getMediaConfig();

      const globalUsed = await sumBytes(
        ctx.db,
        inArray(mediaAssets.status, pendingOrReady),
      );
      const userUsed = await sumBytes(
        ctx.db,
        and(eq(mediaAssets.userId, userId), inArray(mediaAssets.status, pendingOrReady)),
      );

      let showUsed = 0;
      let photoCount = 0;
      let videoCount = 0;

      if (input?.showId) {
        await getShowOwnedByUser(ctx.db, input.showId, userId);
        showUsed = await sumBytes(
          ctx.db,
          and(
            eq(mediaAssets.userId, userId),
            eq(mediaAssets.showId, input.showId),
            inArray(mediaAssets.status, pendingOrReady),
          ),
        );
        const counts = await ctx.db
          .select({
            mediaType: mediaAssets.mediaType,
            count: sql<number>`count(*)::int`,
          })
          .from(mediaAssets)
          .where(
            and(
              eq(mediaAssets.userId, userId),
              eq(mediaAssets.showId, input.showId),
              inArray(mediaAssets.status, pendingOrReady),
            ),
          )
          .groupBy(mediaAssets.mediaType);
        photoCount = counts.find((row) => row.mediaType === 'photo')?.count ?? 0;
        videoCount = counts.find((row) => row.mediaType === 'video')?.count ?? 0;
      }

      return {
        storageMode: config.storageMode,
        limits: {
          globalBytes: config.globalQuotaBytes,
          userBytes: config.userQuotaBytes,
          showBytes: config.showQuotaBytes,
          photoMaxSourceBytes: config.photoMaxSourceBytes,
          photoMaxStoredBytes: config.photoMaxStoredBytes,
          videoMaxBytes: config.videoMaxBytes,
          showMaxPhotos: config.showMaxPhotos,
          showMaxVideos: config.showMaxVideos,
        },
        used: {
          globalBytes: globalUsed,
          userBytes: userUsed,
          showBytes: showUsed,
          showPhotos: photoCount,
          showVideos: videoCount,
        },
      };
    }),

  createUploadIntent: protectedProcedure
    .input(
      z.object({
        showId: z.string().uuid(),
        mediaType: z.enum(['photo', 'video']),
        mimeType: z.string().min(1).max(100),
        sourceBytes: z.number().int().positive(),
        storedBytes: z.number().int().positive(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        durationMs: z.number().int().positive().optional(),
        caption: z.string().max(300).optional(),
        performerIds: z.array(z.string().uuid()).max(20).optional(),
        variants: z.array(variantInput).min(1).max(4),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const config = getMediaConfig();
      if (config.storageMode === 'disabled') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Media uploads are disabled' });
      }

      await getShowOwnedByUser(ctx.db, input.showId, userId);

      const mimeType = input.mimeType.toLowerCase();
      const allowed =
        input.mediaType === 'photo'
          ? config.allowedImageTypes.includes(mimeType)
          : config.allowedVideoTypes.includes(mimeType);
      if (!allowed) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            input.mediaType === 'photo'
              ? 'Unsupported image type'
              : 'Only MP4 videos are supported',
        });
      }

      if (input.mediaType === 'photo') {
        if (input.sourceBytes > config.photoMaxSourceBytes) {
          throw quotaExceeded(`Photo source is larger than ${formatBytes(config.photoMaxSourceBytes)}`);
        }
        if (input.storedBytes > config.photoMaxStoredBytes) {
          throw quotaExceeded(`Photo variants exceed ${formatBytes(config.photoMaxStoredBytes)}`);
        }
      } else if (input.storedBytes > config.videoMaxBytes) {
        throw quotaExceeded(`Video is larger than ${formatBytes(config.videoMaxBytes)}`);
      }

      const [globalUsed, userUsed, showUsed] = await Promise.all([
        sumBytes(ctx.db, inArray(mediaAssets.status, pendingOrReady)),
        sumBytes(
          ctx.db,
          and(eq(mediaAssets.userId, userId), inArray(mediaAssets.status, pendingOrReady)),
        ),
        sumBytes(
          ctx.db,
          and(
            eq(mediaAssets.userId, userId),
            eq(mediaAssets.showId, input.showId),
            inArray(mediaAssets.status, pendingOrReady),
          ),
        ),
      ]);

      if (globalUsed + input.storedBytes > config.globalQuotaBytes) {
        throw quotaExceeded('Showbook media storage is full');
      }
      if (userUsed + input.storedBytes > config.userQuotaBytes) {
        throw quotaExceeded('Your media storage is full');
      }
      if (showUsed + input.storedBytes > config.showQuotaBytes) {
        throw quotaExceeded('This show has reached its media storage limit');
      }

      const counts = await ctx.db
        .select({
          mediaType: mediaAssets.mediaType,
          count: sql<number>`count(*)::int`,
        })
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.userId, userId),
            eq(mediaAssets.showId, input.showId),
            inArray(mediaAssets.status, pendingOrReady),
          ),
        )
        .groupBy(mediaAssets.mediaType);
      const sameTypeCount =
        counts.find((row) => row.mediaType === input.mediaType)?.count ?? 0;
      if (input.mediaType === 'photo' && sameTypeCount >= config.showMaxPhotos) {
        throw quotaExceeded('This show has reached its photo limit');
      }
      if (input.mediaType === 'video' && sameTypeCount >= config.showMaxVideos) {
        throw quotaExceeded('This show has reached its video limit');
      }

      const assetId = randomUUID();
      const folder =
        input.mediaType === 'photo'
          ? `showbook/${userId}/shows/${input.showId}/photos/${assetId}`
          : `showbook/${userId}/shows/${input.showId}/videos/${assetId}`;
      const variants: Record<string, MediaVariant> = {};
      for (const variant of input.variants) {
        const extension = input.mediaType === 'photo' ? 'webp' : 'mp4';
        const key =
          input.mediaType === 'photo'
            ? `${folder}/${variant.name}.${extension}`
            : `${folder}/source.${extension}`;
        variants[variant.name] = {
          key,
          mimeType: variant.mimeType,
          bytes: variant.bytes,
          width: variant.width ?? null,
          height: variant.height ?? null,
        };
      }

      const [{ sortOrder } = { sortOrder: 0 }] = await ctx.db
        .select({ sortOrder: sql<number>`count(*)::int` })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.userId, userId), eq(mediaAssets.showId, input.showId)));

      await ctx.db.insert(mediaAssets).values({
        id: assetId,
        userId,
        showId: input.showId,
        mediaType: input.mediaType,
        status: 'pending',
        storageKey: input.mediaType === 'photo' ? folder : variants.source?.key ?? folder,
        mimeType,
        bytes: input.storedBytes,
        width: input.width ?? null,
        height: input.height ?? null,
        durationMs: input.durationMs ?? null,
        caption: input.caption?.trim() || null,
        variants,
        sortOrder,
      });

      const performerIds = input.performerIds ?? [];
      if (performerIds.length > 0) {
        const validRows = await ctx.db
          .select({ performerId: showPerformers.performerId })
          .from(showPerformers)
          .where(
            and(
              eq(showPerformers.showId, input.showId),
              inArray(showPerformers.performerId, performerIds),
            ),
          );
        const validPerformerIds = [...new Set(validRows.map((row) => row.performerId))];
        if (validPerformerIds.length > 0) {
          await ctx.db.insert(mediaAssetPerformers).values(
            validPerformerIds.map((performerId) => ({
              assetId,
              performerId,
            })),
          );
        }
      }

      const targets = await Promise.all(
        Object.entries(variants).map(async ([name, variant]) => ({
          name,
          key: variant.key,
          mimeType: variant.mimeType,
          uploadUrl: await getMediaUploadUrl(variant.key, variant.mimeType),
        })),
      );

      return {
        assetId,
        targets,
      };
    }),

  completeUpload: protectedProcedure
    .input(z.object({ assetId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const asset = await ctx.db.query.mediaAssets.findFirst({
        where: and(eq(mediaAssets.id, input.assetId), eq(mediaAssets.userId, userId)),
        with: {
          show: {
            with: {
              venue: true,
              showPerformers: { with: { performer: true } },
            },
          },
          mediaAssetPerformers: true,
        },
      });
      if (!asset) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Media asset not found' });
      }
      if (asset.status === 'ready') return toMediaDto(asset);
      if (asset.status !== 'pending') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Upload is not pending' });
      }

      const variants = asset.variants ?? {};
      const checkedEntries = await Promise.all(
        Object.entries(variants).map(async ([name, variant]) => {
          const head = await headMediaObject(variant.key);
          return [
            name,
            {
              ...variant,
              bytes: head.bytes,
              mimeType: head.contentType ?? variant.mimeType,
            },
          ] as const;
        }),
      );
      const actualVariants = Object.fromEntries(checkedEntries);
      const actualBytes = checkedEntries.reduce((sum, [, variant]) => sum + variant.bytes, 0);

      if (actualBytes <= 0 || actualBytes > asset.bytes) {
        // Mark failed FIRST so the DB is always consistent. R2 cleanup is
        // best-effort — if it fails we have an orphan we can sweep later,
        // but we must never leave the asset in 'pending' with bytes gone.
        await ctx.db
          .update(mediaAssets)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(mediaAssets.id, asset.id));
        const cleanupResults = await Promise.allSettled(
          Object.values(variants).map((variant) => deleteMediaObject(variant.key)),
        );
        for (const r of cleanupResults) {
          if (r.status === 'rejected') {
            log.warn(
              { err: r.reason, event: 'media.complete.cleanup_failed', assetId: asset.id },
              'Failed to delete oversize media object',
            );
          }
        }
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Uploaded media exceeded its reserved size',
        });
      }

      const [updated] = await ctx.db
        .update(mediaAssets)
        .set({
          status: 'ready',
          bytes: actualBytes,
          variants: actualVariants,
          updatedAt: new Date(),
        })
        .where(eq(mediaAssets.id, asset.id))
        .returning();

      return toMediaDto({
        ...updated!,
        show: asset.show,
        mediaAssetPerformers: asset.mediaAssetPerformers,
      });
    }),

  listForShow: protectedProcedure
    .input(z.object({ showId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await getShowOwnedByUser(ctx.db, input.showId, userId);
      const assets = await ctx.db.query.mediaAssets.findMany({
        where: and(
          eq(mediaAssets.userId, userId),
          eq(mediaAssets.showId, input.showId),
          eq(mediaAssets.status, 'ready'),
        ),
        orderBy: [asc(mediaAssets.sortOrder), asc(mediaAssets.createdAt)],
        with: {
          show: {
            with: {
              venue: true,
              showPerformers: { with: { performer: true } },
            },
          },
          mediaAssetPerformers: true,
        },
      });
      return Promise.all(assets.map(toMediaDto));
    }),

  listForVenue: protectedProcedure
    .input(z.object({ venueId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const showRows = await ctx.db
        .select({ id: shows.id })
        .from(shows)
        .where(and(eq(shows.userId, userId), eq(shows.venueId, input.venueId)));
      const showIds = showRows.map((row) => row.id);
      if (showIds.length === 0) return [];
      const assets = await ctx.db.query.mediaAssets.findMany({
        where: and(
          eq(mediaAssets.userId, userId),
          inArray(mediaAssets.showId, showIds),
          eq(mediaAssets.status, 'ready'),
        ),
        orderBy: [desc(mediaAssets.createdAt)],
        with: {
          show: {
            with: {
              venue: true,
              showPerformers: { with: { performer: true } },
            },
          },
          mediaAssetPerformers: true,
        },
      });
      return Promise.all(assets.map(toMediaDto));
    }),

  listForPerformer: protectedProcedure
    .input(z.object({ performerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const assetRows = await ctx.db
        .select({ assetId: mediaAssetPerformers.assetId })
        .from(mediaAssetPerformers)
        .innerJoin(mediaAssets, eq(mediaAssetPerformers.assetId, mediaAssets.id))
        .where(
          and(
            eq(mediaAssetPerformers.performerId, input.performerId),
            eq(mediaAssets.userId, userId),
            eq(mediaAssets.status, 'ready'),
          ),
        );
      const assetIds = assetRows.map((row) => row.assetId);
      if (assetIds.length === 0) return [];
      const assets = await ctx.db.query.mediaAssets.findMany({
        where: and(
          eq(mediaAssets.userId, userId),
          inArray(mediaAssets.id, assetIds),
          eq(mediaAssets.status, 'ready'),
        ),
        orderBy: [desc(mediaAssets.createdAt)],
        with: {
          show: {
            with: {
              venue: true,
              showPerformers: { with: { performer: true } },
            },
          },
          mediaAssetPerformers: true,
        },
      });
      return Promise.all(assets.map(toMediaDto));
    }),

  setPerformers: protectedProcedure
    .input(
      z.object({
        assetId: z.string().uuid(),
        performerIds: z.array(z.string().uuid()).max(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      // Verify ownership of both the asset AND its show in one query.
      // Without the show join an attacker who somehow owned an asset row
      // could mutate show_performers on a show they don't own.
      const [row] = await ctx.db
        .select({ assetId: mediaAssets.id, showId: mediaAssets.showId })
        .from(mediaAssets)
        .innerJoin(shows, eq(mediaAssets.showId, shows.id))
        .where(
          and(
            eq(mediaAssets.id, input.assetId),
            eq(mediaAssets.userId, userId),
            eq(shows.userId, userId),
          ),
        )
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Media asset not found' });
      }
      const asset = { id: row.assetId, showId: row.showId };

      const requested = [...new Set(input.performerIds)];
      let validIds: string[] = [];
      if (requested.length > 0) {
        // Validate the ids actually point at real performers; reject any
        // that don't so we don't auto-create show_performers rows for
        // non-existent performers.
        const existing = await ctx.db
          .select({ id: performers.id })
          .from(performers)
          .where(inArray(performers.id, requested));
        const existingSet = new Set(existing.map((row) => row.id));
        validIds = requested.filter((id) => existingSet.has(id));

        if (validIds.length > 0) {
          // Auto-add any tagged performer that isn't on this show yet
          // as 'support' so the join's invariant holds. The composite
          // PK (showId, performerId, role) means we only conflict if
          // they're already a 'support' on this show.
          const existingShowPerformers = await ctx.db
            .select({ performerId: showPerformers.performerId })
            .from(showPerformers)
            .where(
              and(
                eq(showPerformers.showId, asset.showId),
                inArray(showPerformers.performerId, validIds),
              ),
            );
          const onShow = new Set(
            existingShowPerformers.map((row) => row.performerId),
          );
          const toAdd = validIds.filter((id) => !onShow.has(id));
          if (toAdd.length > 0) {
            const [{ maxOrder } = { maxOrder: 0 }] = await ctx.db
              .select({
                maxOrder: sql<number>`coalesce(max(${showPerformers.sortOrder}), 0)::int`,
              })
              .from(showPerformers)
              .where(eq(showPerformers.showId, asset.showId));
            await ctx.db
              .insert(showPerformers)
              .values(
                toAdd.map((performerId, idx) => ({
                  showId: asset.showId,
                  performerId,
                  role: 'support' as const,
                  sortOrder: (maxOrder ?? 0) + idx + 1,
                })),
              )
              .onConflictDoNothing();
          }
        }
      }

      await ctx.db
        .delete(mediaAssetPerformers)
        .where(eq(mediaAssetPerformers.assetId, asset.id));
      if (validIds.length > 0) {
        await ctx.db.insert(mediaAssetPerformers).values(
          validIds.map((performerId) => ({ assetId: asset.id, performerId })),
        );
      }
      return { performerIds: validIds };
    }),

  delete: protectedProcedure
    .input(z.object({ assetId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const asset = await ctx.db.query.mediaAssets.findFirst({
        where: and(eq(mediaAssets.id, input.assetId), eq(mediaAssets.userId, userId)),
      });
      if (!asset) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Media asset not found' });
      }
      const variants = asset.variants ?? {};
      await Promise.all(Object.values(variants).map((variant) => deleteMediaObject(variant.key)));
      await ctx.db.delete(mediaAssets).where(eq(mediaAssets.id, asset.id));
      return { success: true };
    }),
});
