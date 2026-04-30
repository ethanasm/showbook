import { z } from 'zod';
import { eq, and, sql, desc, inArray, isNotNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import {
  shows,
  showPerformers,
  showAnnouncementLinks,
  announcements,
  venues,
  performers,
} from '@showbook/db';
import { matchOrCreateVenue, type VenueInput } from '../venue-matcher';
import {
  matchOrCreatePerformer,
  type PerformerInput,
} from '../performer-matcher';
import { searchEvents } from '../ticketmaster';
import { child } from '@showbook/observability';

const log = child({ component: 'api.shows' });

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const venueInputSchema = z.object({
  name: z.string().min(1),
  city: z.string().min(1),
  stateRegion: z.string().optional(),
  country: z.string().optional(),
  tmVenueId: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  googlePlaceId: z.string().optional(),
  photoUrl: z.string().optional(),
});

const performerInputSchema = z.object({
  name: z.string().min(1),
  role: z.enum(['headliner', 'support', 'cast']),
  characterName: z.string().optional(),
  sortOrder: z.number().int(),
  tmAttractionId: z.string().optional(),
  musicbrainzId: z.string().optional(),
  imageUrl: z.string().optional(),
  setlist: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// State machine transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<string, string[]> = {
  watching: ['ticketed'],
  ticketed: ['past'],
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const showsRouter = router({
  /**
   * For a show that came from a multi-night-run announcement, return the
   * available performance dates so the user can pick one. Returns null if
   * the show has no linked announcement.
   */
  announcementLink: protectedProcedure
    .input(z.object({ showId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const [link] = await ctx.db
        .select({
          announcementId: showAnnouncementLinks.announcementId,
          runStartDate: announcements.runStartDate,
          runEndDate: announcements.runEndDate,
          performanceDates: announcements.performanceDates,
          productionName: announcements.productionName,
          headliner: announcements.headliner,
        })
        .from(showAnnouncementLinks)
        .innerJoin(shows, eq(showAnnouncementLinks.showId, shows.id))
        .innerJoin(
          announcements,
          eq(showAnnouncementLinks.announcementId, announcements.id),
        )
        .where(
          and(
            eq(showAnnouncementLinks.showId, input.showId),
            eq(shows.userId, userId),
          ),
        )
        .limit(1);
      if (!link) return null;
      return {
        announcementId: link.announcementId,
        runStartDate: link.runStartDate,
        runEndDate: link.runEndDate,
        performanceDates: link.performanceDates,
        productionName: link.productionName,
        headliner: link.headliner,
      };
    }),

  list: protectedProcedure
    .input(
      z.object({
        state: z.enum(['past', 'ticketed', 'watching']).optional(),
        kind: z.enum(['concert', 'theatre', 'comedy', 'festival']).optional(),
        year: z.number().int().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const conditions = [eq(shows.userId, userId)];

      if (input.state) {
        conditions.push(eq(shows.state, input.state));
      }
      if (input.kind) {
        conditions.push(eq(shows.kind, input.kind));
      }
      if (input.year) {
        conditions.push(
          sql`extract(year from ${shows.date}::date) = ${input.year}`
        );
      }

      return ctx.db.query.shows.findMany({
        where: and(...conditions),
        orderBy: [desc(shows.date)],
        with: {
          venue: true,
          showPerformers: {
            with: { performer: true },
          },
        },
      });
    }),

  /**
   * Slim per-show shape: { id, date, kind, state, performerIds }. Used by
   * callsites that need to filter / index shows by performer or year but
   * don't render the full venue and performer object graph (the artists
   * page right-click menu, for example).
   */
  listSlim: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const baseRows = await ctx.db
      .select({
        id: shows.id,
        date: shows.date,
        kind: shows.kind,
        state: shows.state,
      })
      .from(shows)
      .where(eq(shows.userId, userId))
      .orderBy(desc(shows.date));

    if (baseRows.length === 0) return [];

    const performerRows = await ctx.db
      .select({
        showId: showPerformers.showId,
        performerId: showPerformers.performerId,
      })
      .from(showPerformers)
      .innerJoin(shows, eq(showPerformers.showId, shows.id))
      .where(eq(shows.userId, userId));

    const idsByShow = new Map<string, string[]>();
    for (const row of performerRows) {
      const arr = idsByShow.get(row.showId);
      if (arr) arr.push(row.performerId);
      else idsByShow.set(row.showId, [row.performerId]);
    }

    return baseRows.map((row) => ({
      ...row,
      performerIds: idsByShow.get(row.id) ?? [],
    }));
  }),

  /**
   * Map-shaped projection: every show with its venue's geo fields plus a
   * single denormalized headliner (name, id, imageUrl). The map view
   * needs all shows to compute "unmapped" counts but never iterates
   * showPerformers — denormalizing lets us drop the array-of-N join.
   */
  listForMap: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const rows = await ctx.db
      .select({
        id: shows.id,
        kind: shows.kind,
        state: shows.state,
        date: shows.date,
        seat: shows.seat,
        pricePaid: shows.pricePaid,
        ticketCount: shows.ticketCount,
        productionName: shows.productionName,
        venue: {
          id: venues.id,
          name: venues.name,
          city: venues.city,
          stateRegion: venues.stateRegion,
          latitude: venues.latitude,
          longitude: venues.longitude,
          photoUrl: venues.photoUrl,
        },
      })
      .from(shows)
      .innerJoin(venues, eq(shows.venueId, venues.id))
      .where(eq(shows.userId, userId))
      .orderBy(desc(shows.date));

    if (rows.length === 0) return [];

    const headlinerName = new Map<string, string>();
    const headlinerId = new Map<string, string>();
    const headlinerImageUrl = new Map<string, string | null>();
    const nonTheatreIds: string[] = [];

    for (const r of rows) {
      if (r.kind === 'theatre' && r.productionName) {
        headlinerName.set(r.id, r.productionName);
      } else {
        nonTheatreIds.push(r.id);
      }
    }

    if (nonTheatreIds.length > 0) {
      const performerRows = await ctx.db
        .select({
          showId: showPerformers.showId,
          performerId: performers.id,
          name: performers.name,
          imageUrl: performers.imageUrl,
          sortOrder: showPerformers.sortOrder,
        })
        .from(showPerformers)
        .innerJoin(performers, eq(showPerformers.performerId, performers.id))
        .where(
          and(
            inArray(showPerformers.showId, nonTheatreIds),
            eq(showPerformers.role, 'headliner'),
          ),
        );
      // Lowest sortOrder wins per show.
      const bestSort = new Map<string, number>();
      for (const row of performerRows) {
        const cur = bestSort.get(row.showId);
        if (cur === undefined || row.sortOrder < cur) {
          bestSort.set(row.showId, row.sortOrder);
          headlinerName.set(row.showId, row.name);
          headlinerId.set(row.showId, row.performerId);
          headlinerImageUrl.set(row.showId, row.imageUrl);
        }
      }
    }

    return rows.map(({ productionName: _pn, ...show }) => ({
      ...show,
      headlinerName: headlinerName.get(show.id) ?? null,
      headlinerId: headlinerId.get(show.id) ?? null,
      headlinerImageUrl: headlinerImageUrl.get(show.id) ?? null,
    }));
  }),

  /**
   * Lightweight count for sidebar badges. Avoids shipping the full show
   * list to the client just to read `.length` — every page-shell render
   * subscribes to this.
   */
  count: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const [row] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(shows)
      .where(eq(shows.userId, userId));
    return row?.count ?? 0;
  }),

  detail: protectedProcedure
    .input(z.object({ showId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const show = await ctx.db.query.shows.findFirst({
        where: and(eq(shows.id, input.showId), eq(shows.userId, userId)),
        with: {
          venue: true,
          showPerformers: {
            with: { performer: true },
          },
        },
      });

      if (!show) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Show not found' });
      }

      return show;
    }),

  create: protectedProcedure
    .input(
      z.object({
        kind: z.enum(['concert', 'theatre', 'comedy', 'festival']),
        headliner: z.object({
          name: z.string().min(1),
          tmAttractionId: z.string().optional(),
          musicbrainzId: z.string().optional(),
          imageUrl: z.string().optional(),
          setlist: z.array(z.string()).optional(),
        }),
        venue: venueInputSchema,
        date: z.string(), // ISO date string YYYY-MM-DD
        endDate: z.string().optional(),
        seat: z.string().optional(),
        pricePaid: z.string().optional(), // decimal as string
        ticketCount: z.number().int().min(1).default(1),
        tourName: z.string().optional(),
        productionName: z.string().optional(),
        notes: z.string().max(5000).optional(),
        performers: z.array(performerInputSchema).optional(),
        sourceRefs: z.any().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Determine state based on date and seat/price
      const showDate = new Date(input.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let state: 'past' | 'ticketed' | 'watching';
      if (showDate < today) {
        state = 'past';
      } else if (input.seat || input.pricePaid) {
        state = 'ticketed';
      } else {
        state = 'watching';
      }

      // Match or create venue
      const venueResult = await matchOrCreateVenue(input.venue as VenueInput);

      // For theatre, the "headliner" name is the production title — store
      // it on the show row rather than in the performers table.
      const productionName =
        input.kind === 'theatre'
          ? input.productionName ?? input.headliner.name
          : input.productionName ?? null;

      // Resolve performers first so we can build the setlists map by ID.
      const setlistsMap: Record<string, string[]> = {};

      let headlinerId: string | null = null;
      if (input.kind !== 'theatre') {
        const headlinerResult = await matchOrCreatePerformer({
          name: input.headliner.name,
          tmAttractionId: input.headliner.tmAttractionId,
          musicbrainzId: input.headliner.musicbrainzId,
          imageUrl: input.headliner.imageUrl,
        });
        headlinerId = headlinerResult.performer.id;
        if (input.headliner.setlist?.length) {
          setlistsMap[headlinerId] = input.headliner.setlist;
        }
      }

      const resolvedPerformers: Array<{ id: string; input: NonNullable<typeof input.performers>[number] }> = [];
      if (input.performers?.length) {
        for (const p of input.performers) {
          const result = await matchOrCreatePerformer({
            name: p.name,
            tmAttractionId: p.tmAttractionId,
            musicbrainzId: p.musicbrainzId,
            imageUrl: p.imageUrl,
          });
          resolvedPerformers.push({ id: result.performer.id, input: p });
          if (p.setlist?.length) {
            setlistsMap[result.performer.id] = p.setlist;
          }
        }
      }

      // Atomic: show + headliner + support performers all-or-nothing.
      // Performer rows are now batched into a single insert.
      const show = await ctx.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(shows)
          .values({
            userId,
            kind: input.kind,
            state,
            venueId: venueResult.venue.id,
            date: input.date,
            endDate: input.endDate ?? null,
            seat: input.seat ?? null,
            pricePaid: input.pricePaid ?? null,
            ticketCount: input.ticketCount,
            tourName: input.tourName ?? null,
            productionName,
            setlists: Object.keys(setlistsMap).length > 0 ? setlistsMap : null,
            photos: null,
            notes: input.notes ?? null,
            sourceRefs: input.sourceRefs ?? null,
          })
          .returning();

        const showPerformerRows: Array<typeof showPerformers.$inferInsert> = [];
        if (headlinerId) {
          showPerformerRows.push({
            showId: created.id,
            performerId: headlinerId,
            role: 'headliner',
            characterName: null,
            sortOrder: 0,
          });
        }
        for (const { id, input: p } of resolvedPerformers) {
          showPerformerRows.push({
            showId: created.id,
            performerId: id,
            role: p.role,
            characterName: p.characterName ?? null,
            sortOrder: p.sortOrder,
          });
        }
        if (showPerformerRows.length > 0) {
          await tx.insert(showPerformers).values(showPerformerRows);
        }

        return created;
      });

      // TM ticket-URL enrichment is best-effort and non-blocking — it's a
      // nice-to-have, not part of the show's correctness, so it lives
      // outside the transaction. Failures are logged so we know if TM is
      // down rather than silently swallowed.
      if (state === 'watching' && input.kind !== 'festival') {
        try {
          const tmVenueId = venueResult.venue.ticketmasterVenueId;
          const { events } = await searchEvents({
            keyword: input.headliner.name,
            venueId: tmVenueId ?? undefined,
            startDateTime: `${input.date}T00:00:00Z`,
            endDateTime: `${input.date}T23:59:59Z`,
            size: 1,
          });
          if (events.length > 0 && events[0]!.url) {
            await ctx.db
              .update(shows)
              .set({ ticketUrl: events[0]!.url })
              .where(eq(shows.id, show.id));
          }
        } catch (err) {
          log.warn(
            { err, event: 'shows.create.tm_enrichment_failed', showId: show.id },
            'TM ticket URL lookup failed (non-blocking)',
          );
        }
      }

      // Return the full show with relations
      return ctx.db.query.shows.findFirst({
        where: eq(shows.id, show.id),
        with: {
          venue: true,
          showPerformers: {
            with: { performer: true },
          },
        },
      });
    }),

  setTicketUrl: protectedProcedure
    .input(
      z.object({
        showId: z.string().uuid(),
        ticketUrl: z.string().url(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const [updated] = await ctx.db
        .update(shows)
        .set({ ticketUrl: input.ticketUrl })
        .where(and(eq(shows.id, input.showId), eq(shows.userId, userId)))
        .returning();
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Show not found' });
      }
      return updated;
    }),

  updateState: protectedProcedure
    .input(
      z.object({
        showId: z.string().uuid(),
        newState: z.enum(['past', 'ticketed', 'watching']),
        seat: z.string().optional(),
        pricePaid: z.string().optional(),
        ticketCount: z.number().int().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Fetch the existing show
      const [existing] = await ctx.db
        .select()
        .from(shows)
        .where(and(eq(shows.id, input.showId), eq(shows.userId, userId)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Show not found' });
      }

      // Validate state transition
      const allowed = VALID_TRANSITIONS[existing.state];
      if (!allowed || !allowed.includes(input.newState)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot transition from "${existing.state}" to "${input.newState}"`,
        });
      }

      // watching -> ticketed requires seat
      if (existing.state === 'watching' && input.newState === 'ticketed') {
        if (!input.seat && !existing.seat) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Seat is required when transitioning from watching to ticketed',
          });
        }
      }

      const updates: Record<string, unknown> = {
        state: input.newState,
        updatedAt: new Date(),
      };
      if (input.seat) updates.seat = input.seat;
      if (input.pricePaid) updates.pricePaid = input.pricePaid;
      if (input.ticketCount) updates.ticketCount = input.ticketCount;

      const [updated] = await ctx.db
        .update(shows)
        .set(updates)
        .where(and(eq(shows.id, input.showId), eq(shows.userId, userId)))
        .returning();

      return updated;
    }),

  update: protectedProcedure
    .input(
      z.object({
        showId: z.string().uuid(),
        kind: z.enum(['concert', 'theatre', 'comedy', 'festival']),
        headliner: z.object({
          name: z.string().min(1),
          tmAttractionId: z.string().optional(),
          musicbrainzId: z.string().optional(),
          imageUrl: z.string().optional(),
          setlist: z.array(z.string()).optional(),
        }),
        venue: venueInputSchema,
        date: z.string(),
        endDate: z.string().optional(),
        seat: z.string().optional(),
        pricePaid: z.string().optional(),
        ticketCount: z.number().int().min(1).default(1),
        tourName: z.string().optional(),
        productionName: z.string().optional(),
        notes: z.string().max(5000).nullable().optional(),
        performers: z.array(performerInputSchema).optional(),
        sourceRefs: z.any().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const [existing] = await ctx.db
        .select()
        .from(shows)
        .where(and(eq(shows.id, input.showId), eq(shows.userId, userId)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Show not found' });
      }

      const showDate = new Date(input.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let state: 'past' | 'ticketed' | 'watching';
      if (showDate < today) {
        state = 'past';
      } else if (input.seat || input.pricePaid) {
        state = 'ticketed';
      } else {
        state = 'watching';
      }

      // Resolve venue + performer rows BEFORE the transaction. These touch
      // external APIs (TM, geocoding) and we don't want to hold a tx open
      // while they run.
      const venueResult = await matchOrCreateVenue(input.venue as VenueInput);

      const productionName =
        input.kind === 'theatre'
          ? input.productionName ?? input.headliner.name
          : input.productionName ?? null;

      let resolvedHeadlinerId: string | null = null;
      const setlistsMap: Record<string, string[]> = {};
      if (input.kind !== 'theatre') {
        const headlinerResult = await matchOrCreatePerformer({
          name: input.headliner.name,
          tmAttractionId: input.headliner.tmAttractionId,
          musicbrainzId: input.headliner.musicbrainzId,
          imageUrl: input.headliner.imageUrl,
        });
        resolvedHeadlinerId = headlinerResult.performer.id;
        if (input.headliner.setlist?.length) {
          setlistsMap[resolvedHeadlinerId] = input.headliner.setlist;
        }
      }

      const resolvedSupport: Array<{
        id: string;
        input: NonNullable<typeof input.performers>[number];
      }> = [];
      if (input.performers?.length) {
        for (const p of input.performers) {
          const result = await matchOrCreatePerformer({
            name: p.name,
            tmAttractionId: p.tmAttractionId,
            musicbrainzId: p.musicbrainzId,
            imageUrl: p.imageUrl,
          });
          resolvedSupport.push({ id: result.performer.id, input: p });
          if (p.setlist?.length) {
            setlistsMap[result.performer.id] = p.setlist;
          }
        }
      }

      // Atomic: delete old performer rows, insert new ones, update show.
      // The previous code did delete + sequential inserts + update outside a
      // transaction, so a partial failure could leave a show with no
      // performers. The UPDATE retains a userId guard (defense-in-depth on
      // top of the SELECT-first ownership check above).
      await ctx.db.transaction(async (tx) => {
        await tx
          .delete(showPerformers)
          .where(eq(showPerformers.showId, input.showId));

        const showPerformerRows: Array<typeof showPerformers.$inferInsert> = [];
        if (resolvedHeadlinerId) {
          showPerformerRows.push({
            showId: input.showId,
            performerId: resolvedHeadlinerId,
            role: 'headliner',
            characterName: null,
            sortOrder: 0,
          });
        }
        for (const { id, input: p } of resolvedSupport) {
          showPerformerRows.push({
            showId: input.showId,
            performerId: id,
            role: p.role,
            characterName: p.characterName ?? null,
            sortOrder: p.sortOrder,
          });
        }
        if (showPerformerRows.length > 0) {
          await tx.insert(showPerformers).values(showPerformerRows);
        }

        await tx
          .update(shows)
          .set({
            kind: input.kind,
            state,
            venueId: venueResult.venue.id,
            date: input.date,
            endDate: input.endDate ?? null,
            seat: input.seat ?? null,
            pricePaid: input.pricePaid ?? null,
            ticketCount: input.ticketCount,
            tourName: input.tourName ?? null,
            productionName,
            setlists: Object.keys(setlistsMap).length > 0 ? setlistsMap : null,
            notes: input.notes ?? null,
            sourceRefs: input.sourceRefs ?? null,
            updatedAt: new Date(),
          })
          .where(and(eq(shows.id, input.showId), eq(shows.userId, userId)));
      });

      return ctx.db.query.shows.findFirst({
        where: eq(shows.id, input.showId),
        with: {
          venue: true,
          showPerformers: {
            with: { performer: true },
          },
        },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ showId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify ownership
      const [existing] = await ctx.db
        .select()
        .from(shows)
        .where(and(eq(shows.id, input.showId), eq(shows.userId, userId)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Show not found' });
      }

      await ctx.db
        .delete(shows)
        .where(and(eq(shows.id, input.showId), eq(shows.userId, userId)));

      return { success: true };
    }),

  deleteAll: protectedProcedure
    .mutation(async ({ ctx }) => {
      const userId = ctx.session.user.id;

      // Follows (venues, performers) are independent of show history — a
      // user's Discover state is preserved even if they wipe their shows.
      const deleted = await ctx.db
        .delete(shows)
        .where(eq(shows.userId, userId))
        .returning({ id: shows.id });

      return { deleted: deleted.length };
    }),
});
