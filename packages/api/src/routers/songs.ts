/**
 * Songs router — read-only Phase 2 surface for the Songs index page,
 * per-song detail, and the artist-page "Songs you've heard live"
 * section. All procedures are user-scoped via `shows.user_id` so a
 * user only ever sees stats for their own attended history.
 *
 * Data flow:
 *   `setlist_song_appearances` (built by song-index-rebuild)
 *     →  `songs.list`         — sortable / filterable list
 *     →  `songs.byId`         — heard-count + per-show timeline
 *     →  `songs.firstHeardForUser` — feed of "first times you heard"
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

const songsListInput = z
  .object({
    performerId: z.string().uuid().optional(),
    year: z.number().int().min(1900).max(2200).optional(),
    firstHeardOnly: z.boolean().default(false),
    tourDebutOnly: z.boolean().default(false),
    limit: z.number().int().min(1).max(500).default(200),
  })
  .default({ firstHeardOnly: false, tourDebutOnly: false, limit: 200 });

const songsByIdInput = z.object({
  songId: z.string().uuid(),
});

const firstHeardInput = z
  .object({
    scope: z.union([z.literal('all'), z.string().uuid()]).default('all'),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .default({ scope: 'all', limit: 100 });

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
   *  candidate in the original sense. We expose this flag so the
   *  /songs page can offer a "tour debuts only" filter without needing
   *  a second query. */
  isUserDebut: boolean;
}

/**
 * Pure helper for the `tourDebutOnly` filter. Returns true when the
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
   * List the songs the user has heard live. Default sort is times
   * heard descending; ties break on title ascending so the list is
   * stable across page transitions.
   *
   * Filters (all optional, AND-combined):
   *   - `performerId` — scope to a single artist
   *   - `year`        — only show appearances in this calendar year
   *   - `firstHeardOnly` — only songs the user heard exactly once
   *   - `tourDebutOnly` — alias for "only the user-scoped debuts"
   *     (a song where the only attended date is the user's first AND
   *     last; see `rowIsUserDebut` for the definition)
   */
  list: protectedProcedure
    .input(songsListInput)
    .query(async ({ ctx, input }): Promise<SongListRow[]> => {
      const userId = ctx.session.user.id;
      const where: SQL[] = [eq(shows.userId, userId)];
      if (input.performerId) {
        where.push(eq(setlistSongAppearances.performerId, input.performerId));
      }
      if (input.year) {
        where.push(
          sql`EXTRACT(YEAR FROM ${setlistSongAppearances.performanceDate}) = ${input.year}`,
        );
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
      if (input.tourDebutOnly) {
        return enriched.filter((r) => r.isUserDebut);
      }
      if (input.firstHeardOnly) {
        return enriched.filter((r) => r.timesHeard === 1);
      }
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

  /**
   * "First time YOU heard this song live." Mirrors
   * `setlistIntel.firstTimes` but with an optional `scope` so the
   * artist page can ask for first-times scoped to one performer.
   * Returns rows in attended-date descending order so the UI can
   * render "newest first" by default.
   */
  firstHeardForUser: protectedProcedure
    .input(firstHeardInput)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const scopeFilter =
        input.scope === 'all'
          ? sql``
          : sql`AND first_appearances.performer_id = ${input.scope}`;
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
        WHERE 1 = 1 ${scopeFilter}
        ORDER BY first_appearances.first_date DESC
        LIMIT ${input.limit}
      `);
      const rows = Array.isArray(result)
        ? result
        : (result as { rows?: unknown }).rows;
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
});

export type SongsRouter = typeof songsRouter;

// Exported for unit tests on the (firstHeardOnly | tourDebutOnly)
// filter branches — the underlying query is the same; we want a pure
// function we can assert against.
export { rowIsUserDebut };
