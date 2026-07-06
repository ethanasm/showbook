/**
 * Songs router — read-only surface for the per-song detail page
 * (web + mobile, linked from setlist rows and predicted setlists)
 * and the artist-page "Songs you've heard live" section. All
 * procedures are user-scoped via `shows.user_id` so a user only ever
 * sees stats for their own attended history.
 *
 * Data flow:
 *   `setlist_song_appearances` (built by song-index-rebuild)
 *     →  `songs.list`  — per-performer frequency list (artist page)
 *     →  `songs.byId`  — heard-count + per-show timeline
 *
 * (The standalone `/songs` index page this router originally served
 * was removed in 2026-07; `list` stays because the artist page reads
 * it with a `performerId` scope.)
 *
 * Rarity ("played at X of Y shows on this tour") is computed from
 * `tour_setlists` so it falls back to `null` when no corpus is
 * populated yet — the UI hides the line in that case.
 */

import { z } from 'zod';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  performers,
  setlistSongAppearances,
  shows,
  songs,
  tourSetlists,
  venues,
} from '@showbook/db';
import { protectedProcedure, router } from '../trpc';
import { loadVenueNameOverrides } from '../venue-names';

const songsListInput = z
  .object({
    performerId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(500).default(200),
  })
  .default({ limit: 200 });

const songsByIdInput = z.object({
  songId: z.string().uuid(),
});

// ─── Helpers ─────────────────────────────────────────────────────────

interface SongListRow {
  songId: string;
  performerId: string;
  performerName: string;
  title: string;
  timesHeard: number;
  firstHeard: string;
  lastHeard: string;
  /** True iff this user's earliest attended appearance of the song is
   *  the *only* attended appearance — a "tour debut you caught"
   *  candidate in the original sense. Powers the "🆕 Once" badge on
   *  the artist page's songs section. */
  isUserDebut: boolean;
}

/**
 * Pure helper for the `isUserDebut` flag. Returns true when the
 * row's first-heard date matches the row's last-heard date AND the
 * user has only heard it once — the operational definition of a
 * "tour debut you caught" given the SI-17 caveat (no global-corpus
 * MIN, just the user's own history).
 */
function rowIsUserDebut(row: { timesHeard: number; firstHeard: string; lastHeard: string }): boolean {
  return row.timesHeard === 1 && row.firstHeard === row.lastHeard;
}

// ─── Router ──────────────────────────────────────────────────────────

export const songsRouter = router({
  /**
   * List the songs the user has heard live, optionally scoped to a
   * single artist via `performerId`. Default sort is times heard
   * descending; ties break on title ascending so the list is stable
   * across page transitions.
   */
  list: protectedProcedure
    .input(songsListInput)
    .query(async ({ ctx, input }): Promise<SongListRow[]> => {
      const userId = ctx.session.user.id;
      const where: SQL[] = [eq(shows.userId, userId)];
      if (input.performerId) {
        where.push(eq(setlistSongAppearances.performerId, input.performerId));
      }
      const rows = await ctx.db
        .select({
          songId: setlistSongAppearances.songId,
          performerId: setlistSongAppearances.performerId,
          performerName: performers.name,
          title: songs.title,
          timesHeard: sql<number>`COUNT(*)::int`,
          firstHeard: sql<string>`MIN(${setlistSongAppearances.performanceDate})`,
          lastHeard: sql<string>`MAX(${setlistSongAppearances.performanceDate})`,
        })
        .from(setlistSongAppearances)
        .innerJoin(shows, eq(shows.id, setlistSongAppearances.showId))
        .innerJoin(songs, eq(songs.id, setlistSongAppearances.songId))
        .innerJoin(
          performers,
          eq(performers.id, setlistSongAppearances.performerId),
        )
        .where(and(...where))
        .groupBy(
          setlistSongAppearances.songId,
          setlistSongAppearances.performerId,
          performers.name,
          songs.title,
        )
        .orderBy(desc(sql`COUNT(*)`), asc(songs.title))
        .limit(input.limit);

      const enriched: SongListRow[] = rows.map((r) => ({
        ...r,
        isUserDebut: rowIsUserDebut(r),
      }));
      return enriched;
    }),

  /**
   * Per-song detail. Returns the song metadata, the user's attended
   * timeline (with positions for the sparkline), and (when corpus
   * data is available) the rarity fraction.
   */
  byId: protectedProcedure
    .input(songsByIdInput)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Song header + performer name. The song table is keyed by
      // performer so this is a single indexed lookup.
      const [songRow] = await ctx.db
        .select({
          id: songs.id,
          title: songs.title,
          performerId: songs.performerId,
          performerName: performers.name,
          spotifyTrackId: songs.spotifyTrackId,
          firstKnownPerformance: songs.firstKnownPerformance,
        })
        .from(songs)
        .innerJoin(performers, eq(performers.id, songs.performerId))
        .where(eq(songs.id, input.songId))
        .limit(1);
      if (!songRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Song not found' });
      }

      // User-scoped timeline. Each row is one show where the user
      // heard this song; `positionInSet` powers the per-detail
      // sparkline ("does it tend to land mid-set or as an encore?").
      const timeline = await ctx.db
        .select({
          showId: setlistSongAppearances.showId,
          performanceDate: setlistSongAppearances.performanceDate,
          sectionIndex: setlistSongAppearances.sectionIndex,
          songIndex: setlistSongAppearances.songIndex,
          isEncore: setlistSongAppearances.isEncore,
          role: setlistSongAppearances.role,
          venueId: venues.id,
          venueName: venues.name,
          venueCity: venues.city,
        })
        .from(setlistSongAppearances)
        .innerJoin(shows, eq(shows.id, setlistSongAppearances.showId))
        .innerJoin(venues, eq(venues.id, shows.venueId))
        .where(
          and(
            eq(setlistSongAppearances.songId, input.songId),
            eq(shows.userId, userId),
          ),
        )
        .orderBy(asc(setlistSongAppearances.performanceDate));

      // Apply per-user venue-name overrides so the timeline + first/last
      // cards show the user's alias rather than the canonical name.
      const venueNameOverrides = await loadVenueNameOverrides(
        ctx.db,
        userId,
        timeline.map((r) => r.venueId),
      );
      for (const r of timeline) {
        r.venueName = venueNameOverrides.get(r.venueId) ?? r.venueName;
      }

      // Rarity: corpus hits in the last 12 months, divided by the
      // performer's total corpus setlists in the same window. Both
      // numbers come from `tour_setlists`; null when corpus is empty.
      const [corpusTotalsRow] = await ctx.db
        .select({
          total: sql<number>`COUNT(DISTINCT ${tourSetlists.id})::int`,
        })
        .from(tourSetlists)
        .where(
          and(
            eq(tourSetlists.performerId, songRow.performerId),
            sql`${tourSetlists.performanceDate} > (CURRENT_DATE - INTERVAL '12 months')`,
          ),
        );
      const corpusTotal = corpusTotalsRow?.total ?? 0;

      let corpusHits = 0;
      if (corpusTotal > 0) {
        const [hitsRow] = await ctx.db
          .select({
            hits: sql<number>`COUNT(DISTINCT ${setlistSongAppearances.tourSetlistId})::int`,
          })
          .from(setlistSongAppearances)
          .where(
            and(
              eq(setlistSongAppearances.songId, input.songId),
              sql`${setlistSongAppearances.tourSetlistId} IS NOT NULL`,
              sql`${setlistSongAppearances.performanceDate} > (CURRENT_DATE - INTERVAL '12 months')`,
            ),
          );
        corpusHits = hitsRow?.hits ?? 0;
      }
      const rarityFraction =
        corpusTotal > 0 ? corpusHits / corpusTotal : null;

      // First-heard is just the timeline head (it's pre-sorted asc).
      const first = timeline[0] ?? null;
      const last = timeline[timeline.length - 1] ?? null;
      return {
        song: {
          id: songRow.id,
          title: songRow.title,
          performerId: songRow.performerId,
          performerName: songRow.performerName,
          spotifyTrackId: songRow.spotifyTrackId,
          firstKnownPerformance: songRow.firstKnownPerformance,
        },
        timesHeard: timeline.length,
        firstHeard: first
          ? {
              showId: first.showId,
              date: first.performanceDate,
              venueName: first.venueName,
              venueCity: first.venueCity,
            }
          : null,
        lastHeard: last
          ? {
              showId: last.showId,
              date: last.performanceDate,
              venueName: last.venueName,
              venueCity: last.venueCity,
            }
          : null,
        timeline: timeline.map((r) => ({
          showId: r.showId,
          date: r.performanceDate,
          sectionIndex: r.sectionIndex,
          songIndex: r.songIndex,
          isEncore: r.isEncore,
          role: r.role,
          venueName: r.venueName,
          venueCity: r.venueCity,
        })),
        rarity:
          rarityFraction != null
            ? {
                corpusHits,
                corpusTotal,
                fractionPct: Math.max(1, Math.round(rarityFraction * 100)),
              }
            : null,
      };
    }),

});

export type SongsRouter = typeof songsRouter;

// Exported for unit tests on the `isUserDebut` flag — the underlying
// query is the same; we want a pure function we can assert against.
export { rowIsUserDebut };
