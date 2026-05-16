/**
 * Setlist intelligence — read-only tRPC procedures for Phase 1.
 *
 * - `predictedSetlist({ showId })` — Bayesian prediction (cached). Resolves
 *   the headliner server-side; gates by show kind + date + headliner
 *   presence. Returns the `cold` empty state with a typed `reason` for
 *   any failing gate (per SI-03 / SI-04).
 * - `songsHeardMost({ scope, limit })` — the user's top songs by times
 *   heard live across attended shows.
 * - `setlistDiff({ showIdA, showIdB })` — symmetric diff of two attended
 *   setlists (Both / Only A / Only B).
 * - `firstTimes({ limit })` — user-scoped only (SI-17). "First time YOU
 *   heard this song live."
 *
 * Phase 9 additions:
 * - `spotifyFollowsDiff()` — Spotify-only artists for the Discover rail.
 * - `skipSpotifyArtist({ spotifyArtistId })` — × on a rail card.
 * - `trackPreviewsForShow({ showId })` — cached 30s preview URLs per
 *   row in the show's predicted/actual setlist.
 * - `resolveTrackPreview({ showId, title })` — lazy resolve a single
 *   row's preview/URI via Spotify search.
 */

import { z } from 'zod';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  performers,
  setlistSongAppearances,
  showPerformers,
  shows,
  songs,
  userPerformerFollows,
  userSpotifySkippedArtists,
  users,
} from '@showbook/db';
import { getHeadlinerId, isProductionShow, type ShowLike } from '@showbook/shared';
import { child } from '@showbook/observability';
import { isFeatureOn } from '@showbook/shared';
import { protectedProcedure, router } from '../trpc';
import {
  coldPrediction,
  predictedSetlistCached,
  type ColdPrediction,
  type HotPrediction,
} from '../setlist-predict';
import { ensureFreshUserToken } from '../spotify-tokens';
import {
  getFollowedArtists,
  searchTrack,
  SpotifyError,
  type SpotifyArtist,
} from '../spotify';
import { diffSpotifyFollows } from '../spotify-follows-diff';
import { enforceRateLimit } from '../rate-limit';

const log = child({ component: 'api.setlist-intel' });

const SUPPORTED_KINDS = new Set(['concert', 'festival']);

const predictedSetlistInput = z.object({
  showId: z.string().uuid(),
});

const songsHeardMostInput = z.object({
  scope: z.union([z.literal('all'), z.string().uuid()]).default('all'),
  limit: z.number().int().min(1).max(200).default(50),
});

const setlistDiffInput = z.object({
  showIdA: z.string().uuid(),
  showIdB: z.string().uuid(),
});

const firstTimesInput = z
  .object({ limit: z.number().int().min(1).max(200).default(50) })
  .default({ limit: 50 });

export const setlistIntelRouter = router({
  /**
   * Predicted setlist for an attended/upcoming show. Eligibility gate
   * runs server-side per SI-03 — the client always calls this and the
   * procedure decides cold vs hot.
   */
  predictedSetlist: protectedProcedure
    .input(predictedSetlistInput)
    .query(async ({ ctx, input }): Promise<HotPrediction | ColdPrediction> => {
      const userId = ctx.session.user.id;
      const show = await ctx.db.query.shows.findFirst({
        where: and(eq(shows.id, input.showId), eq(shows.userId, userId)),
        with: {
          showPerformers: { with: { performer: true } },
        },
      });
      if (!show) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Show not found' });
      }

      if (!SUPPORTED_KINDS.has(show.kind)) {
        return coldPrediction('wrong_kind');
      }
      if (isProductionShow(show as ShowLike)) {
        return coldPrediction('production_show');
      }
      if (!show.date) {
        return coldPrediction('date_not_set');
      }
      const headlinerId = getHeadlinerId(show as ShowLike);
      if (!headlinerId) {
        return coldPrediction('no_headliner');
      }

      // No-MBID short-circuit (SI-04). The corpus-fill job is the
      // primary writer; we additionally check here so a fresh
      // performer with no corpus row yet doesn't burn a wasted query.
      const [perf] = await ctx.db
        .select({
          id: performers.id,
          name: performers.name,
          musicbrainzId: performers.musicbrainzId,
        })
        .from(performers)
        .where(eq(performers.id, headlinerId))
        .limit(1);
      if (!perf) {
        return coldPrediction('no_headliner');
      }
      if (!perf.musicbrainzId) {
        return coldPrediction('no_mbid', perf.name);
      }

      try {
        return await predictedSetlistCached({
          performerId: headlinerId,
          targetDate: show.date,
          snapshotContext: { userId, showId: input.showId },
        });
      } catch (err) {
        log.error(
          { event: 'setlist.predict.failed', err, showId: input.showId, performerId: headlinerId },
          'predicted-setlist failed',
        );
        return coldPrediction('no_corpus', perf.name);
      }
    }),

  /**
   * The user's top songs by times-heard. `scope` is either `'all'` for
   * across every attended performer, or a specific `performerId`. Reads
   * the denormalized `setlist_song_appearances` index built by Phase 1's
   * indexer.
   */
  songsHeardMost: protectedProcedure
    .input(songsHeardMostInput)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const filters = [eq(shows.userId, userId)];
      if (input.scope !== 'all') {
        filters.push(eq(setlistSongAppearances.performerId, input.scope));
      }
      const rows = await ctx.db
        .select({
          songId: setlistSongAppearances.songId,
          performerId: setlistSongAppearances.performerId,
          timesHeard: sql<number>`COUNT(*)::int`,
          firstHeard: sql<string>`MIN(${setlistSongAppearances.performanceDate})`,
          lastHeard: sql<string>`MAX(${setlistSongAppearances.performanceDate})`,
          title: songs.title,
          performerName: performers.name,
        })
        .from(setlistSongAppearances)
        .innerJoin(shows, eq(shows.id, setlistSongAppearances.showId))
        .innerJoin(songs, eq(songs.id, setlistSongAppearances.songId))
        .innerJoin(performers, eq(performers.id, setlistSongAppearances.performerId))
        .where(and(...filters))
        .groupBy(
          setlistSongAppearances.songId,
          setlistSongAppearances.performerId,
          songs.title,
          performers.name,
        )
        .orderBy(desc(sql`COUNT(*)`), asc(songs.title))
        .limit(input.limit);
      return rows;
    }),

  /**
   * Symmetric diff of two attended shows. Each section returns titles
   * in the order they first appeared in the source setlist.
   */
  setlistDiff: protectedProcedure
    .input(setlistDiffInput)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const showRows = await ctx.db
        .select({
          showId: setlistSongAppearances.showId,
          songId: setlistSongAppearances.songId,
          songIndex: setlistSongAppearances.songIndex,
          sectionIndex: setlistSongAppearances.sectionIndex,
          title: songs.title,
          performerName: performers.name,
        })
        .from(setlistSongAppearances)
        .innerJoin(shows, eq(shows.id, setlistSongAppearances.showId))
        .innerJoin(songs, eq(songs.id, setlistSongAppearances.songId))
        .innerJoin(performers, eq(performers.id, setlistSongAppearances.performerId))
        .where(
          and(
            eq(shows.userId, userId),
            inArray(setlistSongAppearances.showId, [input.showIdA, input.showIdB]),
          ),
        )
        .orderBy(
          asc(setlistSongAppearances.sectionIndex),
          asc(setlistSongAppearances.songIndex),
        );

      const titlesByShow = new Map<string, { title: string; songId: string }[]>();
      for (const row of showRows) {
        if (!row.showId) continue;
        const list = titlesByShow.get(row.showId) ?? [];
        list.push({ title: row.title, songId: row.songId });
        titlesByShow.set(row.showId, list);
      }
      const aList = titlesByShow.get(input.showIdA) ?? [];
      const bList = titlesByShow.get(input.showIdB) ?? [];
      const aTitles = new Set(aList.map((s) => s.title.toLowerCase()));
      const bTitles = new Set(bList.map((s) => s.title.toLowerCase()));

      const both: { title: string; songId: string }[] = [];
      const onlyA: { title: string; songId: string }[] = [];
      const onlyB: { title: string; songId: string }[] = [];
      const seen = new Set<string>();
      for (const item of aList) {
        const lower = item.title.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        if (bTitles.has(lower)) both.push(item);
        else onlyA.push(item);
      }
      const seenB = new Set<string>();
      for (const item of bList) {
        const lower = item.title.toLowerCase();
        if (seenB.has(lower)) continue;
        seenB.add(lower);
        if (!aTitles.has(lower) && !seen.has(lower)) onlyB.push(item);
      }
      return { both, onlyA, onlyB };
    }),

  /**
   * "First time YOU heard this song live." User-scoped only per SI-17.
   * The global "tour debut you caught" rail was dropped from the plan
   * because it required honesty caveats about corpus completeness.
   */
  firstTimes: protectedProcedure
    .input(firstTimesInput)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const result = await ctx.db.execute<{
        song_id: string;
        performer_id: string;
        first_date: string;
        show_id: string;
        title: string;
        performer_name: string;
      }>(sql`
        SELECT
          first_appearances.song_id,
          first_appearances.performer_id,
          first_appearances.first_date,
          first_appearances.show_id,
          songs.title,
          performers.name AS performer_name
        FROM (
          SELECT DISTINCT ON (a.song_id)
            a.song_id,
            a.performer_id,
            a.performance_date AS first_date,
            a.show_id
          FROM setlist_song_appearances a
          JOIN shows s ON s.id = a.show_id
          WHERE s.user_id = ${userId}
          ORDER BY a.song_id, a.performance_date ASC
        ) first_appearances
        JOIN songs ON songs.id = first_appearances.song_id
        JOIN performers ON performers.id = first_appearances.performer_id
        ORDER BY first_appearances.first_date DESC
        LIMIT ${input.limit}
      `);

      const rows = Array.isArray(result) ? result : (result as { rows?: unknown }).rows;
      if (!Array.isArray(rows)) return [];
      return rows.map((r) => {
        const row = r as {
          song_id: string;
          performer_id: string;
          first_date: string;
          show_id: string;
          title: string;
          performer_name: string;
        };
        return {
          songId: row.song_id,
          performerId: row.performer_id,
          firstDate: row.first_date,
          showId: row.show_id,
          title: row.title,
          performerName: row.performer_name,
        };
      });
    }),

  // ─────────────────────────────────────────────────────────────────
  // Phase 9 — Spotify-follow rail (Discover)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Spotify artists the user follows on Spotify but NOT on Showbook,
   * minus any explicitly skipped via the rail's × button. Returns an
   * empty list (and `connected: false`) when the user hasn't
   * connected Spotify so the rail can hide itself without a separate
   * status hop.
   */
  spotifyFollowsDiff: protectedProcedure.query(
    async ({ ctx }): Promise<{
      connected: boolean;
      artists: SpotifyArtist[];
    }> => {
      const userId = ctx.session.user.id;
      if (!isFeatureOn('SetlistIntelPreviews')) {
        log.debug(
          { event: 'spotify.follow_diff.empty', reason: 'flag_off', userId },
          'follow-diff served empty (flag off)',
        );
        return { connected: false, artists: [] };
      }
      const accessToken = await ensureFreshUserToken(userId);
      if (!accessToken) {
        return { connected: false, artists: [] };
      }
      enforceRateLimit(`setlist-intel.follow-diff:${userId}`, {
        max: 30,
        windowMs: 60_000,
      });

      let spotifyArtists: SpotifyArtist[];
      try {
        spotifyArtists = await getFollowedArtists(accessToken);
      } catch (err) {
        if (err instanceof SpotifyError && err.status === 401) {
          // ensureFreshUserToken handled the refresh; this hop was
          // still rejected. Surface as a disconnected state so the
          // rail collapses; the next page load picks up the connect
          // modal via the global hook.
          return { connected: false, artists: [] };
        }
        log.error(
          { err, event: 'spotify.follow_diff.failed', userId },
          'Spotify follow-diff failed',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'spotify_follow_diff_failed',
        });
      }

      // Showbook-followed performers (lowercase name match — see
      // diffSpotifyFollows for the trade-off note).
      const followedNames = await ctx.db
        .select({ name: performers.name })
        .from(userPerformerFollows)
        .innerJoin(
          performers,
          eq(performers.id, userPerformerFollows.performerId),
        )
        .where(eq(userPerformerFollows.userId, userId));
      const followedSet = new Set(
        followedNames.map((r) => r.name.toLowerCase()),
      );

      const skipped = await ctx.db
        .select({ id: userSpotifySkippedArtists.spotifyArtistId })
        .from(userSpotifySkippedArtists)
        .where(eq(userSpotifySkippedArtists.userId, userId));
      const skippedSet = new Set(skipped.map((r) => r.id));

      const artists = diffSpotifyFollows({
        spotifyArtists,
        showbookFollowedNames: followedSet,
        skippedSpotifyArtistIds: skippedSet,
      });

      if (artists.length === 0) {
        log.info(
          { event: 'spotify.follow_diff.empty', userId, total: spotifyArtists.length },
          'follow-diff empty',
        );
      } else {
        log.info(
          {
            event: 'spotify.follow_diff.served',
            userId,
            served: artists.length,
            spotifyTotal: spotifyArtists.length,
            followedTotal: followedSet.size,
            skippedTotal: skippedSet.size,
          },
          'follow-diff served',
        );
      }

      return { connected: true, artists };
    },
  ),

  /**
   * Dismiss a Spotify artist from the rail. Writes to
   * `user_spotify_skipped_artists` so the same card never re-surfaces.
   * Idempotent — duplicate (userId, spotifyArtistId) is a no-op via
   * the primary-key constraint.
   */
  skipSpotifyArtist: protectedProcedure
    .input(z.object({ spotifyArtistId: z.string().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await ctx.db
        .insert(userSpotifySkippedArtists)
        .values({
          userId,
          spotifyArtistId: input.spotifyArtistId,
        })
        .onConflictDoNothing();
      return { ok: true as const };
    }),

  // ─────────────────────────────────────────────────────────────────
  // Phase 9 — Track previews (30s clips + Spotify URIs)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Cached preview/URI map for every title in the show's predicted or
   * actual setlist. Used by the row-play button to flip directly into
   * "ready" without a Spotify hop on every render.
   *
   * Returns a record keyed by lower(title) so the client can resolve
   * a row in O(1). Values:
   *   - `previewUrl` — null if Spotify never had a preview (the row's
   *     play button stays disabled with a "no preview available"
   *     tooltip per the Phase-9 spec).
   *   - `spotifyTrackId` — null until the song-resolution path has
   *     cached one; Premium users use this to call Web Playback SDK.
   */
  trackPreviewsForShow: protectedProcedure
    .input(z.object({ showId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<{
      previews: Record<
        string,
        { previewUrl: string | null; spotifyTrackId: string | null }
      >;
    }> => {
      const userId = ctx.session.user.id;
      const show = await ctx.db.query.shows.findFirst({
        where: and(eq(shows.id, input.showId), eq(shows.userId, userId)),
        with: { showPerformers: { with: { performer: true } } },
      });
      if (!show) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Show not found' });
      }
      const headlinerId = getHeadlinerId(show as ShowLike);
      if (!headlinerId) return { previews: {} };

      const rows = await ctx.db
        .select({
          title: songs.title,
          previewUrl: songs.spotifyPreviewUrl,
          spotifyTrackId: songs.spotifyTrackId,
        })
        .from(songs)
        .where(eq(songs.performerId, headlinerId));

      const previews: Record<
        string,
        { previewUrl: string | null; spotifyTrackId: string | null }
      > = {};
      for (const row of rows) {
        const trackId =
          row.spotifyTrackId && row.spotifyTrackId !== '__none__'
            ? row.spotifyTrackId
            : null;
        previews[row.title.toLowerCase()] = {
          previewUrl: row.previewUrl ?? null,
          spotifyTrackId: trackId,
        };
      }
      return { previews };
    }),

  /**
   * Lazy-resolve a single setlist row's Spotify preview + URI on
   * tap. Persists the result to `songs.spotify_preview_url` /
   * `songs.spotify_track_id` so future visits skip the search. The
   * sentinel `__none__` value on `spotify_track_id` is preserved
   * from the Phase-3 resolver — re-tapping a known-miss returns
   * `{ previewUrl: null, spotifyTrackId: null }` without re-searching.
   */
  resolveTrackPreview: protectedProcedure
    .input(
      z.object({
        showId: z.string().uuid(),
        title: z.string().min(1).max(300),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{
      previewUrl: string | null;
      spotifyTrackId: string | null;
    }> => {
      const userId = ctx.session.user.id;
      enforceRateLimit(`setlist-intel.resolve-preview:${userId}`, {
        max: 60,
        windowMs: 60_000,
      });
      const accessToken = await ensureFreshUserToken(userId);
      if (!accessToken) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'spotify_not_connected',
        });
      }
      const show = await ctx.db.query.shows.findFirst({
        where: and(eq(shows.id, input.showId), eq(shows.userId, userId)),
        with: { showPerformers: { with: { performer: true } } },
      });
      if (!show) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Show not found' });
      }
      const headlinerId = getHeadlinerId(show as ShowLike);
      if (!headlinerId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'no_headliner',
        });
      }
      const headlinerName =
        show.showPerformers.find((sp) => sp.performer.id === headlinerId)
          ?.performer.name ?? '';

      // Catalog cache first — re-tapping a row should never hit Spotify.
      const titleLower = input.title.toLowerCase();
      const [cached] = await ctx.db
        .select({
          id: songs.id,
          previewUrl: songs.spotifyPreviewUrl,
          spotifyTrackId: songs.spotifyTrackId,
        })
        .from(songs)
        .where(
          and(
            eq(songs.performerId, headlinerId),
            sql`LOWER(${songs.title}) = ${titleLower}`,
          ),
        )
        .limit(1);
      if (cached?.previewUrl || cached?.spotifyTrackId === '__none__') {
        return {
          previewUrl: cached.previewUrl ?? null,
          spotifyTrackId:
            cached.spotifyTrackId && cached.spotifyTrackId !== '__none__'
              ? cached.spotifyTrackId
              : null,
        };
      }

      let track;
      try {
        track = await searchTrack(accessToken, headlinerName, input.title);
      } catch (err) {
        log.warn(
          {
            err,
            event: 'spotify.preview.unavailable',
            userId,
            showId: input.showId,
            title: input.title,
          },
          'Track preview lookup failed',
        );
        return { previewUrl: null, spotifyTrackId: null };
      }

      if (!track) {
        // Cache the negative as `__none__` so re-taps don't re-search.
        if (cached) {
          await ctx.db
            .update(songs)
            .set({ spotifyTrackId: '__none__' })
            .where(eq(songs.id, cached.id));
        }
        log.info(
          {
            event: 'spotify.preview.unavailable',
            userId,
            title: input.title,
            reason: 'not_found',
          },
          'No Spotify match for track',
        );
        return { previewUrl: null, spotifyTrackId: null };
      }

      // Persist the catalog row. We upsert by (performerId, lower(title))
      // to interoperate with the song-index-rebuild job, which is the
      // authoritative writer for everything else on the songs row.
      if (cached) {
        await ctx.db
          .update(songs)
          .set({
            spotifyTrackId: track.id,
            spotifyPreviewUrl: track.previewUrl,
            durationMs: track.durationMs,
          })
          .where(eq(songs.id, cached.id));
      } else {
        await ctx.db
          .insert(songs)
          .values({
            performerId: headlinerId,
            title: input.title,
            spotifyTrackId: track.id,
            spotifyPreviewUrl: track.previewUrl,
            durationMs: track.durationMs,
          })
          .onConflictDoNothing();
      }

      log.info(
        {
          event: 'spotify.preview.resolved',
          userId,
          title: input.title,
          hasPreview: !!track.previewUrl,
        },
        'Track preview resolved',
      );

      return {
        previewUrl: track.previewUrl,
        spotifyTrackId: track.id,
      };
    }),
});

export type SetlistIntelRouter = typeof setlistIntelRouter;
