import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import {
  getLibraryArtists,
  getDeveloperToken,
  AppleMusicError,
  AppleMusicConfigError,
} from '../apple-music';
import {
  resolveArtistsForImport,
  importSelectedArtists,
  type SourceArtist,
} from '../import-shared';
import { enforceRateLimit } from '../rate-limit';
import { TRPCError } from '@trpc/server';
import { child } from '@showbook/observability';

const log = child({ component: 'api.apple-music-import' });

export const appleMusicImportRouter = router({
  /**
   * Fetch the user's Apple Music library artists, resolve each against
   * Ticketmaster, and return an enriched list with match status. Mirrors
   * `spotifyImport.listFollowed` — see that doc for the rationale on
   * mutation vs query and the TM resolution cap.
   *
   * Apple Music has no redirect-based OAuth; the client obtains a
   * Music-User-Token via MusicKit.js and posts it here.
   */
  listFollowed: protectedProcedure
    .input(z.object({ musicUserToken: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      enforceRateLimit(`appleMusic.list:${userId}`, {
        max: 5,
        windowMs: 60_000,
      });

      let developerToken: string;
      try {
        developerToken = getDeveloperToken();
      } catch (err) {
        if (err instanceof AppleMusicConfigError) {
          // Treat missing server config as a feature-disabled signal so
          // the client can hide the entry-point cleanly.
          log.warn(
            { event: 'apple_music_import.config_missing' },
            'Apple Music developer-token env vars unset',
          );
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Apple Music import is not configured on this server',
          });
        }
        throw err;
      }

      let artists;
      try {
        artists = await getLibraryArtists(developerToken, input.musicUserToken);
      } catch (err) {
        if (err instanceof AppleMusicError && err.status === 401) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Apple Music token expired or invalid',
          });
        }
        log.error(
          { err, event: 'apple_music_import.list.failed' },
          'Apple Music fetch failed',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch Apple Music library artists',
        });
      }

      const sourceArtists: SourceArtist[] = artists.map((a) => ({
        externalId: a.id,
        name: a.name,
        imageUrl: a.imageUrl,
        genres: a.genres,
      }));
      const resolved = await resolveArtistsForImport(ctx.db, sourceArtists);

      // Apple-Music-specific shape: rename externalId → appleMusicId.
      const items = resolved.items.map(({ externalId, ...rest }) => ({
        appleMusicId: externalId,
        ...rest,
      }));

      log.info(
        {
          event: 'apple_music_import.list.success',
          userId,
          total: resolved.totalCount,
          resolved: resolved.resolvedCount,
          matched: resolved.items.filter((i) => i.tmMatch).length,
        },
        'Apple Music list resolved',
      );

      return {
        artists: items,
        totalCount: resolved.totalCount,
        resolvedCount: resolved.resolvedCount,
        truncated: resolved.truncated,
      };
    }),

  /**
   * Persist the user's selected imports — identical pipeline to the
   * Spotify equivalent. Kept as a separate procedure so per-source rate
   * limits don't leak across providers.
   */
  importSelected: protectedProcedure
    .input(
      z.object({
        artists: z
          .array(
            z.object({
              tmAttractionId: z.string().min(1),
              name: z.string().min(1).max(200),
              imageUrl: z.string().url().optional(),
              musicbrainzId: z.string().optional(),
            }),
          )
          .min(1)
          .max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      enforceRateLimit(`appleMusic.import:${userId}`, {
        max: 3,
        windowMs: 60_000,
      });

      const { imported, skipped } = await importSelectedArtists(
        ctx.db,
        userId,
        input.artists,
        'apple-music',
      );

      log.info(
        {
          event: 'apple_music_import.import.success',
          userId,
          imported: imported.length,
          skipped: skipped.length,
        },
        'Apple Music import complete',
      );

      return { imported, skipped };
    }),
});
