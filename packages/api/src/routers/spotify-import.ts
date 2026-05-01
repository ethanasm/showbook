import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import { router, protectedProcedure } from '../trpc';
import { performers, userPerformerFollows } from '@showbook/db';
import { getFollowedArtists, SpotifyError } from '../spotify';
import { searchAttractions, selectBestImage, type TMAttraction } from '../ticketmaster';
import { matchOrCreatePerformer } from '../performer-matcher';
import { enqueueIngestPerformer } from '../job-queue';
import { enforceRateLimit } from '../rate-limit';
import { TRPCError } from '@trpc/server';
import { child } from '@showbook/observability';

const log = child({ component: 'api.spotify-import' });

// Cap how many Spotify artists we resolve against Ticketmaster in one
// listFollowed call. Each artist is one TM attraction search; with
// concurrency=8 and ~300ms/request this caps end-to-end latency at ~5s
// for a heavy user.
const TM_RESOLVE_CAP = 200;
const TM_RESOLVE_CONCURRENCY = 8;

async function resolveTmInBatches(
  artistNames: string[],
): Promise<(TMAttraction | null)[]> {
  const results: (TMAttraction | null)[] = new Array(artistNames.length).fill(null);
  for (let i = 0; i < artistNames.length; i += TM_RESOLVE_CONCURRENCY) {
    const batch = artistNames
      .slice(i, i + TM_RESOLVE_CONCURRENCY)
      .map((name, j) =>
        searchAttractions(name)
          .then((rows) => {
            // Take the first attraction whose name case-insensitively matches.
            // TM returns fuzzy matches and we'd rather skip than mis-match.
            const exact = rows.find(
              (r) => r.name.toLowerCase() === name.toLowerCase(),
            );
            results[i + j] = exact ?? null;
          })
          .catch((err) => {
            log.warn(
              { err, event: 'spotify_import.tm_resolve.failed', name },
              'TM resolve failed for artist',
            );
            results[i + j] = null;
          }),
      );
    await Promise.all(batch);
  }
  return results;
}

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

      const head = spotifyArtists.slice(0, TM_RESOLVE_CAP);
      const tail = spotifyArtists.slice(TM_RESOLVE_CAP);

      const tmMatches = await resolveTmInBatches(head.map((a) => a.name));

      const matchedTmIds = tmMatches
        .map((m) => m?.id)
        .filter((id): id is string => Boolean(id));

      // Find which Spotify-matched artists the user already follows. We
      // join through performers.tmAttractionId so we recognize follows
      // regardless of whether the row was created by Spotify import,
      // search-external, or scraping.
      const followedTmIds = new Set<string>();
      if (matchedTmIds.length > 0) {
        const rows = await ctx.db
          .select({
            tmAttractionId: performers.ticketmasterAttractionId,
          })
          .from(performers)
          .innerJoin(
            userPerformerFollows,
            eq(userPerformerFollows.performerId, performers.id),
          )
          .where(
            // SAFETY: only union the IDs we just resolved
            inArray(performers.ticketmasterAttractionId, matchedTmIds),
          );
        for (const r of rows) {
          if (r.tmAttractionId) followedTmIds.add(r.tmAttractionId);
        }
      }

      const items = head.map((artist, i) => {
        const tm = tmMatches[i];
        return {
          spotifyId: artist.id,
          name: artist.name,
          imageUrl: artist.imageUrl,
          genres: artist.genres,
          tmMatch: tm
            ? {
                tmAttractionId: tm.id,
                name: tm.name,
                imageUrl: selectBestImage(tm.images) ?? null,
              }
            : null,
          alreadyFollowed: tm ? followedTmIds.has(tm.id) : false,
        };
      });

      // Append over-cap artists with no TM resolution; the UI gray-outs
      // them so users still see them but can't import.
      const overflow = tail.map((artist) => ({
        spotifyId: artist.id,
        name: artist.name,
        imageUrl: artist.imageUrl,
        genres: artist.genres,
        tmMatch: null,
        alreadyFollowed: false,
      }));

      log.info(
        {
          event: 'spotify_import.list.success',
          userId,
          total: spotifyArtists.length,
          resolved: head.length,
          matched: matchedTmIds.length,
          alreadyFollowed: followedTmIds.size,
        },
        'Spotify list resolved',
      );

      return {
        artists: [...items, ...overflow],
        totalCount: spotifyArtists.length,
        resolvedCount: head.length,
        truncated: tail.length > 0,
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

      const imported: { performerId: string; name: string }[] = [];
      const skipped: { name: string; reason: string }[] = [];

      for (const artist of input.artists) {
        try {
          const { performer } = await matchOrCreatePerformer({
            name: artist.name,
            tmAttractionId: artist.tmAttractionId,
            imageUrl: artist.imageUrl,
          });
          await ctx.db
            .insert(userPerformerFollows)
            .values({ userId, performerId: performer.id })
            .onConflictDoNothing();
          await enqueueIngestPerformer(performer.id);
          imported.push({ performerId: performer.id, name: performer.name });
        } catch (err) {
          log.warn(
            { err, event: 'spotify_import.artist.failed', name: artist.name },
            'Failed to import single artist',
          );
          skipped.push({ name: artist.name, reason: 'import failed' });
        }
      }

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
