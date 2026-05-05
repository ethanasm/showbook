import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { router, protectedProcedure } from '../trpc';
import { shows, venues } from '@showbook/db';
import {
  getUserAttended,
  SetlistFmError,
  type AttendedSetlist,
} from '../setlistfm';
import { enforceRateLimit } from '../rate-limit';
import { TRPCError } from '@trpc/server';
import { child } from '@showbook/observability';

const log = child({ component: 'api.imports' });

// setlist.fm caps each page at 20 attended entries. Cap pages here so a
// power user with thousands of attended shows doesn't burn through the
// shared 500ms rate limiter for an unbounded duration.
const SETLISTFM_MAX_PAGES = 50;

export interface SetlistFmReviewTicket {
  source: 'setlistfm';
  setlistId: string;
  date: string;
  headliner: string;
  musicbrainzId: string;
  venueName: string;
  venueCity: string | null;
  venueState: string | null;
  tourName: string | null;
  setlist: AttendedSetlist['setlist'];
  duplicate: boolean;
}

function ticketKey(date: string, headliner: string): string {
  return `${date.slice(0, 10)}|${headliner.toLowerCase().trim()}`;
}

export const importsRouter = router({
  /**
   * One-shot setlist.fm import. Pages through `/user/{username}/attended`,
   * maps each setlist into the same review-ticket shape the Gmail import uses,
   * and flags rows that already exist in the user's logbook so the modal can
   * pre-uncheck them.
   *
   * No persistence of `username` — this is a one-time bulk import; we'll add
   * a recurring sync (and persist the handle then) when there's a job for it.
   */
  setlistfmFetchAttended: protectedProcedure
    .input(z.object({ username: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      enforceRateLimit(`setlistfm.attended:${userId}`, {
        max: 5,
        windowMs: 60 * 60 * 1000,
      });

      const collected: AttendedSetlist[] = [];
      let totalReported = 0;
      try {
        for (let page = 1; page <= SETLISTFM_MAX_PAGES; page++) {
          const result = await getUserAttended(input.username, page);
          if (page === 1) totalReported = result.total;
          if (result.attended.length === 0) break;
          collected.push(...result.attended);
          if (result.attended.length < (result.itemsPerPage || 20)) break;
          if (collected.length >= result.total) break;
        }
      } catch (err) {
        if (err instanceof SetlistFmError) {
          if (err.status === 404) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: 'setlist.fm user not found',
            });
          }
          if (err.status === 403) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: "This user's attended list is private on setlist.fm",
            });
          }
        }
        log.warn({ err, event: 'imports.setlistfm.failed', userId }, 'setlist.fm import failed');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch attended list from setlist.fm',
        });
      }

      // Build dedupe set against the user's existing shows. Match on
      // (date, headliner-lowercased) — venue name is too noisy to key on
      // (setlist.fm and Showbook venues frequently disagree on punctuation).
      const existing = await ctx.db
        .select({
          date: shows.date,
          tourName: shows.tourName,
          productionName: shows.productionName,
          venueName: venues.name,
          venueCity: venues.city,
        })
        .from(shows)
        .leftJoin(venues, eq(venues.id, shows.venueId))
        .where(eq(shows.userId, userId));

      // We don't have headliner name on the show row directly, so this dedupe
      // pass is date-keyed only — the modal also surfaces a per-row badge that
      // an item already exists, and the user can untick. Headliner-level
      // dedupe would require joining show_performers + performers; cheap to
      // add later if false positives turn out to be common.
      const existingDates = new Set(
        existing
          .map((r) => (r.date ? r.date.slice(0, 10) : null))
          .filter((d): d is string => d != null),
      );

      const tickets: SetlistFmReviewTicket[] = [];
      const seenKeys = new Set<string>();
      for (const a of collected) {
        const key = ticketKey(a.date, a.artist.name);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        tickets.push({
          source: 'setlistfm',
          setlistId: a.setlistId,
          date: a.date,
          headliner: a.artist.name,
          musicbrainzId: a.artist.mbid,
          venueName: a.venue.name,
          venueCity: a.venue.city ?? null,
          venueState: a.venue.state ?? null,
          tourName: a.tourName ?? null,
          setlist: a.setlist,
          duplicate: existingDates.has(a.date.slice(0, 10)),
        });
      }

      log.info(
        {
          event: 'imports.setlistfm.complete',
          userId,
          total: totalReported,
          fetched: collected.length,
          tickets: tickets.length,
        },
        'setlist.fm attended import complete',
      );

      return { tickets, total: totalReported };
    }),
});
