import { eq, and, isNotNull, sql } from 'drizzle-orm';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { venues, users } from '@showbook/db';
import { findTmVenueId } from '../venue-matcher';
import { geocodeVenue } from '../geocode';
import { enforceRateLimit } from '../rate-limit';
import { isAdminEmail } from '../admin';
import { child } from '@showbook/observability';

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
});
