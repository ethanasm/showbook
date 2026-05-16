/**
 * Setlist intelligence — read-only tRPC procedures for Phases 1 + 7.
 *
 * Phase 1:
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
 * Phase 7 (music layer v2):
 * - `musicLayerV2Feature()` — flag gate query (admin-bypass).
 * - `fanLoyalty({ showId })` — donut ring source data (past shows).
 * - `discoveredLive({ showId })` — list-row rail data (past shows).
 * - `saveDiscoveredSong({ songId })` — PUT /me/tracks mutation.
 * - `primingStat({ showId })` — italic title-block line.
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
  users,
} from '@showbook/db';
import {
  getHeadlinerId,
  isProductionShow,
  isFeatureOn,
  type FeatureFlagKey,
  type ShowLike,
} from '@showbook/shared';
import { child } from '@showbook/observability';
import { protectedProcedure, router } from '../trpc';
import {
  coldPrediction,
  predictedSetlistCached,
  type ColdPrediction,
  type HotPrediction,
} from '../setlist-predict';
import {
  fanLoyaltyForShow,
  discoveredLiveForShow,
  saveDiscoveredSong,
  primingStatForShow,
} from '../spotify-music-layer';
import { isAdminEmail } from '../admin';

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

const showIdOnly = z.object({ showId: z.string().uuid() });
const saveDiscoveredInput = z.object({ songId: z.string().uuid() });

const MUSIC_LAYER_V2_FLAG: FeatureFlagKey = 'SetlistIntelMusicLayerV2';

/**
 * Resolves the Phase 7 music-layer-v2 gate for a user. The flag is OFF
 * globally; the `ADMIN_EMAILS` allowlist bypasses so the developer can
 * validate against a real Spotify connection before rollout.
 */
async function isMusicLayerV2EnabledForUser(
  dbi: typeof import('@showbook/db').db,
  userId: string,
): Promise<boolean> {
  if (isFeatureOn(MUSIC_LAYER_V2_FLAG)) return true;
  const [user] = await dbi
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return isAdminEmail(user?.email);
}

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

  // ───────────────────────────────────────────────────────────────────
  // Phase 7 — music layer v2
  // ───────────────────────────────────────────────────────────────────

  /**
   * Gate query for the Phase 7 music-layer-v2 UI (fan loyalty ring,
   * discovered-live rail, priming stat). Returns `{ enabled }` based
   * on the global flag and the admin-email allowlist.
   */
  musicLayerV2Feature: protectedProcedure.query(async ({ ctx }) => {
    const enabled = await isMusicLayerV2EnabledForUser(
      ctx.db,
      ctx.session.user.id,
    );
    return { enabled };
  }),

  /**
   * Fan-loyalty ring source data — past shows only. Walks the actual
   * setlist, asks Spotify which of those tracks the user has saved,
   * and returns the rolled-up count/percentage. Computed on demand;
   * never persisted (SI-12).
   */
  fanLoyalty: protectedProcedure
    .input(showIdOnly)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (!(await isMusicLayerV2EnabledForUser(ctx.db, userId))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'feature_disabled:SetlistIntelMusicLayerV2',
        });
      }
      try {
        return await fanLoyaltyForShow({
          db: ctx.db,
          userId,
          showId: input.showId,
        });
      } catch (err) {
        log.error(
          {
            event: 'setlistIntel.fan_loyalty.failed',
            err,
            userId,
            showId: input.showId,
          },
          'Fan loyalty computation failed',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'fan_loyalty_failed',
        });
      }
    }),

  /**
   * Discovered-live rail — songs played at this show that the user
   * does NOT have saved on Spotify. List-row layout per the design
   * handoff. The companion `saveDiscoveredSong` mutation flips
   * individual rows.
   */
  discoveredLive: protectedProcedure
    .input(showIdOnly)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (!(await isMusicLayerV2EnabledForUser(ctx.db, userId))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'feature_disabled:SetlistIntelMusicLayerV2',
        });
      }
      try {
        return await discoveredLiveForShow({
          db: ctx.db,
          userId,
          showId: input.showId,
        });
      } catch (err) {
        log.error(
          {
            event: 'setlistIntel.discovered_live.failed',
            err,
            userId,
            showId: input.showId,
          },
          'Discovered-live computation failed',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'discovered_live_failed',
        });
      }
    }),

  /**
   * Save a single track to the user's Spotify library. The mutation
   * patches the in-process saved-cache so the next ring/rail render
   * reflects the new state without waiting for the 60s TTL.
   */
  saveDiscoveredSong: protectedProcedure
    .input(saveDiscoveredInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (!(await isMusicLayerV2EnabledForUser(ctx.db, userId))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'feature_disabled:SetlistIntelMusicLayerV2',
        });
      }
      const result = await saveDiscoveredSong({
        db: ctx.db,
        userId,
        songId: input.songId,
      });
      if (!result.ok) {
        if (result.reason === 'not_connected') {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'spotify_not_connected',
          });
        }
        if (result.reason === 'no_spotify_id') {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'no_spotify_id',
          });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'save_discovered_failed',
        });
      }
      return { ok: true as const };
    }),

  /**
   * Priming stat — italic line on the show title block. Reads the
   * pre/post counts populated by the nightly recently-played job.
   * Returns nulls when the job hasn't yet filled the show.
   */
  primingStat: protectedProcedure
    .input(showIdOnly)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (!(await isMusicLayerV2EnabledForUser(ctx.db, userId))) {
        // Quiet failure path — the UI hides the line entirely when the
        // flag is off, no need to bubble an error.
        return { prepCount: null, postCount: null };
      }
      return primingStatForShow({
        db: ctx.db,
        userId,
        showId: input.showId,
      });
    }),
});

export type SetlistIntelRouter = typeof setlistIntelRouter;
