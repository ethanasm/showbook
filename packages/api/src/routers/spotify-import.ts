import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { getFollowedArtists, SpotifyError } from '../spotify';
import {
  resolveArtistsForImport,
  importSelectedArtists,
  type SourceArtist,
} from '../import-shared';
import { enforceRateLimit } from '../rate-limit';
import { TRPCError } from '@trpc/server';
import { child } from '@showbook/observability';

const log = child({ component: 'api.spotify-import' });

export const spotifyImportRouter = router({
  /**
   * Fetch the user's Spotify followed artists, resolve each against
   * Ticketmaster, and return an enriched list with match status. Used by
   * the preferences page to render the import checkbox list.
   *
   * Modeled as a mutation because it makes paged external API calls and
   * we don't want react-query auto-refetching on focus.
   */
  listFollowed: protectedProcedure
    .input(z.object({ accessToken: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      enforceRateLimit(`spotify.list:${userId}`, {
        max: 5,
        windowMs: 60_000,
      });

      let spotifyArtists;
      try {
        spotifyArtists = await getFollowedArtists(input.accessToken);
      } catch (err) {
        if (err instanceof SpotifyError && err.status === 401) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Spotify token expired or invalid',
          });
        }
        log.error({ err, event: 'spotify_import.list.failed' }, 'Spotify fetch failed');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch Spotify followed artists',
        });
      }

      const sourceArtists: SourceArtist[] = spotifyArtists.map((a) => ({
        externalId: a.id,
        name: a.name,
        imageUrl: a.imageUrl,
        genres: a.genres,
      }));
      const resolved = await resolveArtistsForImport(ctx.db, sourceArtists);

      // Spotify-specific shape: rename externalId → spotifyId for backward
      // compatibility with the existing client.
      const artists = resolved.items.map(({ externalId, ...rest }) => ({
        spotifyId: externalId,
        ...rest,
      }));

      log.info(
        {
          event: 'spotify_import.list.success',
          userId,
          total: resolved.totalCount,
          resolved: resolved.resolvedCount,
          matched: resolved.items.filter((i) => i.tmMatch).length,
        },
        'Spotify list resolved',
      );

      return {
        artists,
        totalCount: resolved.totalCount,
        resolvedCount: resolved.resolvedCount,
        truncated: resolved.truncated,
      };
    }),

  /**
   * Persist the user's selected imports: for each TM-matched Spotify
   * artist, run the same match-or-create + follow + ingest path that
   * `performers.followAttraction` uses.
   *
   * Returns per-artist outcomes so the UI can show a summary.
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
      enforceRateLimit(`spotify.import:${userId}`, {
        max: 3,
        windowMs: 60_000,
      });

      const { imported, skipped } = await importSelectedArtists(
        ctx.db,
        userId,
        input.artists,
        'spotify',
      );

      log.info(
        {
          event: 'spotify_import.import.success',
          userId,
          imported: imported.length,
          skipped: skipped.length,
        },
        'Spotify import complete',
      );

      return { imported, skipped };
    }),
});
