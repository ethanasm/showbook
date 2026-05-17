import { eq, and, ilike, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import {
  venues,
  users,
  enrichmentQueue,
  performers,
} from '@showbook/db';
import { findTmVenueId } from '../venue-matcher';
import { geocodeVenue } from '../geocode';
import { enforceRateLimit } from '../rate-limit';
import { isAdminEmail } from '../admin';
import {
  enqueuePruneOrphanCatalog,
  enqueueSetlistRetry,
  enqueueSetlistCorpusFill,
  enqueueSetlistCorpusFillRefresh,
} from '../job-queue';
import { child } from '@showbook/observability';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const log = child({ component: 'api.admin' });

// Both backfills mutate every venue row globally, hit paid upstream APIs
// (Google geocoding + Places, Ticketmaster), and were previously exposed on
// `protectedProcedure` — meaning any signed-in user could fire them. They
// now live behind `adminProcedure` (`ADMIN_EMAILS` allowlist). The per-admin
// rate limit is defense in depth: it caps how often an admin can torch the
// API budget, even by accident from a stuck dev tool.
const BACKFILL_RATE_LIMIT = { max: 4, windowMs: 60 * 60 * 1000 } as const;

export const adminRouter = router({
  /**
   * Cheap "should the web sidebar render the Admin tab?" query. Available to
   * any authenticated user — returns false for non-admins. Re-derives admin
   * status from the DB on every call so revoking via env takes effect on the
   * next page load.
   */
  amIAdmin: protectedProcedure.query(async ({ ctx }) => {
    const [user] = await ctx.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, ctx.session.user.id))
      .limit(1);
    return { isAdmin: isAdminEmail(user?.email) };
  }),

  /**
   * Fill in missing latitude/longitude/stateRegion/country for every venue
   * with a known city. Calls Google geocoding per row.
   */
  backfillVenueCoordinates: adminProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    enforceRateLimit(`admin.backfill_coordinates:${userId}`, BACKFILL_RATE_LIMIT);

    log.info(
      { event: 'admin.backfill_coordinates.start', userId },
      'Admin coordinate backfill started',
    );

    const incomplete = await ctx.db
      .select()
      .from(venues)
      .where(
        and(
          isNotNull(venues.city),
          sql`${venues.city} != 'Unknown'`,
          sql`(${venues.latitude} IS NULL OR ${venues.stateRegion} IS NULL OR ${venues.stateRegion} = '')`,
        ),
      );

    let geocoded = 0;
    let failed = 0;

    for (const venue of incomplete) {
      try {
        const geo = await geocodeVenue(venue.name, venue.city, venue.stateRegion ?? null);
        if (geo) {
          const updates: Record<string, unknown> = {};
          if (venue.latitude == null) {
            updates.latitude = geo.lat;
            updates.longitude = geo.lng;
          }
          if (!venue.stateRegion && geo.stateRegion) updates.stateRegion = geo.stateRegion;
          if ((!venue.country || venue.country === 'US') && geo.country) updates.country = geo.country;
          if (Object.keys(updates).length > 0) {
            await ctx.db
              .update(venues)
              .set(updates)
              .where(eq(venues.id, venue.id));
          }
          geocoded++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    log.info(
      {
        event: 'admin.backfill_coordinates.complete',
        userId,
        total: incomplete.length,
        geocoded,
        failed,
      },
      'Admin coordinate backfill complete',
    );

    return { total: incomplete.length, geocoded, failed };
  }),

  /**
   * Look up a Ticketmaster venue id for every venue that doesn't have one.
   * Uses the Ticketmaster Discovery API.
   */
  backfillVenueTicketmaster: adminProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    enforceRateLimit(`admin.backfill_ticketmaster:${userId}`, BACKFILL_RATE_LIMIT);

    log.info(
      { event: 'admin.backfill_ticketmaster.start', userId },
      'Admin Ticketmaster backfill started',
    );

    const missing = await ctx.db
      .select()
      .from(venues)
      .where(
        and(
          sql`${venues.ticketmasterVenueId} IS NULL`,
          isNotNull(venues.city),
          sql`${venues.city} != 'Unknown'`,
        ),
      );

    let matched = 0;
    let failed = 0;

    for (const venue of missing) {
      try {
        const tmId = await findTmVenueId(venue.name, venue.city, venue.stateRegion);
        if (tmId) {
          await ctx.db
            .update(venues)
            .set({ ticketmasterVenueId: tmId })
            .where(eq(venues.id, venue.id));
          matched++;
        }
      } catch {
        failed++;
      }
    }

    log.info(
      {
        event: 'admin.backfill_ticketmaster.complete',
        userId,
        total: missing.length,
        matched,
        failed,
      },
      'Admin Ticketmaster backfill complete',
    );

    return { total: missing.length, matched, failed };
  }),

  /**
   * Enqueue the prune-orphan-catalog pg-boss job. The job sweeps
   * announcements / venues / performers that have no remaining preservers
   * (no shows, follows, or referencing announcements). It already runs
   * nightly at 02:30 ET; this lets an operator trigger it on demand
   * after a manual cleanup or if the cron missed.
   */
  enqueuePruneOrphanCatalog: adminProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    log.info(
      { event: 'admin.prune_orphan_catalog.enqueue', userId },
      'Admin enqueued prune-orphan-catalog job',
    );
    const jobId = await enqueuePruneOrphanCatalog();
    return { jobId };
  }),

  /**
   * Globally enqueue every (past show, lineup performer) pair that's
   * missing a setlist into the enrichment queue, then trigger the
   * setlist-retry pg-boss job for immediate processing. Covers both the
   * Gmail-import gap (past shows created directly in `past` state never
   * hit the nightly ticketed→past transition that normally schedules
   * enrichment) and any festival lineup artists that were skipped before
   * per-performer queueing existed — without waiting for the next 03:00
   * ET nightly catch-up sweep.
   *
   * Eligibility: state='past', kind in (concert,festival), date set,
   * performer role in (headliner,support), no existing queue entry for
   * the pair, and the performer is not already represented in
   * `shows.setlists` (whether by a full setlist or an empty give-up
   * marker). The legacy `setlists = '{}'` global give-up marker is
   * respected — we don't re-queue exhausted shows.
   */
  enqueueSetlistRetry: adminProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    log.info(
      { event: 'admin.setlist_retry.start', userId },
      'Admin setlist enrichment started',
    );

    const eligible = await ctx.db.execute<{
      show_id: string;
      performer_id: string;
    }>(sql`
      SELECT s.id AS show_id, sp.performer_id
      FROM shows s
      JOIN show_performers sp ON sp.show_id = s.id
      LEFT JOIN enrichment_queue eq
        ON eq.show_id = sp.show_id
        AND eq.performer_id = sp.performer_id
        AND eq.type = 'setlist'
      WHERE s.state = 'past'
        AND s.kind IN ('concert', 'festival')
        AND s.date IS NOT NULL
        AND sp.role IN ('headliner', 'support')
        AND eq.id IS NULL
        AND (
          s.setlists IS NULL
          OR (
            s.setlists != '{}'::jsonb
            AND NOT (s.setlists ? sp.performer_id::text)
          )
        )
    `);

    let queued = 0;
    if (eligible.length > 0) {
      const inserted = await ctx.db
        .insert(enrichmentQueue)
        .values(
          eligible.map((row) => ({
            showId: row.show_id,
            performerId: row.performer_id,
            type: 'setlist' as const,
            attempts: 0,
            maxAttempts: 14,
            nextRetry: new Date(),
          })),
        )
        .onConflictDoNothing()
        .returning({ id: enrichmentQueue.id });
      queued = inserted.length;
    }

    const jobId = await enqueueSetlistRetry();

    log.info(
      {
        event: 'admin.setlist_retry.complete',
        userId,
        queued,
        jobId,
      },
      'Admin setlist enrichment complete',
    );

    return { queued, jobId };
  }),

  /**
   * Enqueue an `enrichment/setlist-corpus-fill` job for a single performer
   * so the predicted-setlist tab can leave the "We're pulling recent
   * setlists" cold state ahead of an upcoming show. Accepts either a
   * performer UUID or a name (case-insensitive substring). Errors with
   * NOT_FOUND if no performer matches and PRECONDITION_FAILED if more than
   * one does, so the operator can disambiguate by ID.
   */
  enqueueSetlistCorpusFill: adminProcedure
    .input(
      z.object({
        performerQuery: z.string().trim().min(1).max(200),
        mode: z.enum(['predict', 'deep', 'refresh']).default('predict'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const isUuid = UUID_RE.test(input.performerQuery);
      const matches = await ctx.db
        .select({
          id: performers.id,
          name: performers.name,
          musicbrainzId: performers.musicbrainzId,
        })
        .from(performers)
        .where(
          isUuid
            ? eq(performers.id, input.performerQuery)
            : ilike(performers.name, `%${input.performerQuery}%`),
        )
        .limit(10);

      if (matches.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `No performer matched "${input.performerQuery}"`,
        });
      }
      if (matches.length > 1) {
        const sample = matches
          .slice(0, 5)
          .map((m) => `${m.name} (${m.id})`)
          .join(', ');
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `${matches.length} performers matched — refine the query or paste an ID. Matches: ${sample}`,
        });
      }

      const performer = matches[0];
      const jobId = await enqueueSetlistCorpusFill(performer.id, input.mode);

      log.info(
        {
          event: 'admin.setlist_corpus_fill.enqueue',
          userId,
          performerId: performer.id,
          performerName: performer.name,
          hasMbid: performer.musicbrainzId != null,
          mode: input.mode,
          jobId,
        },
        'Admin enqueued setlist-corpus-fill job',
      );

      return {
        jobId,
        performerId: performer.id,
        performerName: performer.name,
        hasMbid: performer.musicbrainzId != null,
        mode: input.mode,
      };
    }),

  /**
   * Enqueue the `enrichment/setlist-corpus-fill-refresh` cron job on
   * demand. The handler refreshes corpus for the top-500 followed
   * performers plus everyone with a watching / ticketed show in the next
   * 30 days. Already runs daily at 04:45 ET — this lets an operator
   * trigger the sweep without waiting for the next cron firing.
   */
  enqueueSetlistCorpusFillRefresh: adminProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const jobId = await enqueueSetlistCorpusFillRefresh();
    log.info(
      {
        event: 'admin.setlist_corpus_fill_refresh.enqueue',
        userId,
        jobId,
      },
      'Admin enqueued setlist-corpus-fill-refresh job',
    );
    return { jobId };
  }),
});
