import { z } from 'zod';
import { eq, and, or, sql, desc, count, inArray } from 'drizzle-orm';
import { router, protectedProcedure } from '../trpc';
import {
  shows,
  performers,
  venues,
  showPerformers,
  userVenueFollows,
} from '@showbook/db';

const RESULT_LIMIT = 8;

export type GlobalShowResult = {
  id: string;
  date: string | null;
  kind: 'concert' | 'theatre' | 'comedy' | 'festival' | 'sports';
  state: 'past' | 'ticketed' | 'watching';
  title: string;
  venueName: string;
  venueCity: string | null;
};

export type GlobalPerformerResult = {
  id: string;
  name: string;
  imageUrl: string | null;
  showCount: number;
};

export type GlobalVenueResult = {
  id: string;
  name: string;
  city: string | null;
  showCount: number;
};

export type GlobalSearchResults = {
  shows: GlobalShowResult[];
  performers: GlobalPerformerResult[];
  venues: GlobalVenueResult[];
};

export const searchRouter = router({
  global: protectedProcedure
    .input(z.object({ query: z.string().min(1).max(100) }))
    .query(async ({ ctx, input }): Promise<GlobalSearchResults> => {
      const userId = ctx.session.user.id;
      const q = `%${input.query.trim()}%`;

      // ── Shows ───────────────────────────────────────────────────────
      // Match on production_name, tour_name, venue.name, or any performer name
      const matchingShowIdsRows = await ctx.db
        .selectDistinct({ id: shows.id, date: shows.date })
        .from(shows)
        .leftJoin(venues, eq(venues.id, shows.venueId))
        .leftJoin(showPerformers, eq(showPerformers.showId, shows.id))
        .leftJoin(performers, eq(performers.id, showPerformers.performerId))
        .where(
          and(
            eq(shows.userId, userId),
            or(
              sql`${shows.productionName} ILIKE ${q}`,
              sql`${shows.tourName} ILIKE ${q}`,
              sql`${venues.name} ILIKE ${q}`,
              sql`${performers.name} ILIKE ${q}`,
            ),
          ),
        )
        .orderBy(desc(shows.date))
        .limit(RESULT_LIMIT);

      const showIds = matchingShowIdsRows.map((r) => r.id);
      const showRows =
        showIds.length === 0
          ? []
          : await ctx.db.query.shows.findMany({
              where: inArray(shows.id, showIds),
              with: {
                venue: true,
                showPerformers: { with: { performer: true } },
              },
            });

      const showResults: GlobalShowResult[] = showRows
        .sort((a, b) => {
          // Dateless rows (state='watching' with no committed performance
          // date) sort to the top so they're surfaced for date-picking.
          if (a.date === null && b.date === null) return 0;
          if (a.date === null) return -1;
          if (b.date === null) return 1;
          return new Date(b.date).getTime() - new Date(a.date).getTime();
        })
        .map((s) => {
          const headlinerSP =
            s.showPerformers.find(
              (sp) => sp.role === 'headliner' && sp.sortOrder === 0,
            ) ?? s.showPerformers.find((sp) => sp.role === 'headliner');
          const isTheatreLike = s.kind === 'theatre' || s.kind === 'festival';
          const title =
            (isTheatreLike && s.productionName) ||
            headlinerSP?.performer.name ||
            'Untitled';
          return {
            id: s.id,
            date: s.date,
            kind: s.kind,
            state: s.state,
            title,
            venueName: s.venue.name,
            venueCity: s.venue.city ?? null,
          };
        });

      // ── Performers ──────────────────────────────────────────────────
      // Performers the user has shows with, name matches q
      const performerRows = await ctx.db
        .select({
          id: performers.id,
          name: performers.name,
          imageUrl: performers.imageUrl,
          showCount: count(shows.id),
        })
        .from(performers)
        .innerJoin(showPerformers, eq(showPerformers.performerId, performers.id))
        .innerJoin(shows, eq(showPerformers.showId, shows.id))
        .where(
          and(
            eq(shows.userId, userId),
            sql`${performers.name} ILIKE ${q}`,
          ),
        )
        .groupBy(performers.id, performers.name, performers.imageUrl)
        .orderBy(desc(count(shows.id)))
        .limit(RESULT_LIMIT);

      // ── Venues ──────────────────────────────────────────────────────
      // Venues the user has shows at OR follows, where name or city matches q
      const userVenueIdsRows = await ctx.db
        .selectDistinct({ id: shows.venueId })
        .from(shows)
        .where(eq(shows.userId, userId));
      const followedVenueIdsRows = await ctx.db
        .select({ id: userVenueFollows.venueId })
        .from(userVenueFollows)
        .where(eq(userVenueFollows.userId, userId));
      const relevantVenueIds = Array.from(
        new Set([
          ...userVenueIdsRows.map((r) => r.id),
          ...followedVenueIdsRows.map((r) => r.id),
        ]),
      );

      let venueRows: GlobalVenueResult[] = [];
      if (relevantVenueIds.length > 0) {
        const matchedVenues = await ctx.db
          .select({
            id: venues.id,
            name: venues.name,
            city: venues.city,
          })
          .from(venues)
          .where(
            and(
              inArray(venues.id, relevantVenueIds),
              or(
                sql`${venues.name} ILIKE ${q}`,
                sql`${venues.city} ILIKE ${q}`,
              ),
            ),
          )
          .limit(RESULT_LIMIT * 2);

        if (matchedVenues.length > 0) {
          const matchedIds = matchedVenues.map((v) => v.id);
          const counts = await ctx.db
            .select({
              venueId: shows.venueId,
              showCount: count(shows.id),
            })
            .from(shows)
            .where(
              and(
                eq(shows.userId, userId),
                inArray(shows.venueId, matchedIds),
              ),
            )
            .groupBy(shows.venueId);
          const countById = new Map<string, number>(
            counts.map((c) => [c.venueId, Number(c.showCount)]),
          );

          venueRows = matchedVenues
            .map((v) => ({
              id: v.id,
              name: v.name,
              city: v.city ?? null,
              showCount: countById.get(v.id) ?? 0,
            }))
            .sort((a, b) => b.showCount - a.showCount)
            .slice(0, RESULT_LIMIT);
        }
      }

      return {
        shows: showResults,
        performers: performerRows.map((p) => ({
          id: p.id,
          name: p.name,
          imageUrl: p.imageUrl,
          showCount: Number(p.showCount),
        })),
        venues: venueRows,
      };
    }),
});
