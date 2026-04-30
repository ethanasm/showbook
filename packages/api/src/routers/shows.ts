import { z } from 'zod';
import { eq, and, sql, desc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import {
  shows,
  showPerformers,
  showAnnouncementLinks,
  announcements,
} from '@showbook/db';
import { matchOrCreateVenue, type VenueInput } from '../venue-matcher';
import {
  matchOrCreatePerformer,
  type PerformerInput,
} from '../performer-matcher';
import { searchEvents } from '../ticketmaster';

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

      // Create the show
      const [show] = await ctx.db
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

      if (headlinerId) {
        await ctx.db.insert(showPerformers).values({
          showId: show.id,
          performerId: headlinerId,
          role: 'headliner',
          characterName: null,
          sortOrder: 0,
        });
      }

      for (const { id, input: p } of resolvedPerformers) {
        await ctx.db.insert(showPerformers).values({
          showId: show.id,
          performerId: id,
          role: p.role,
          characterName: p.characterName ?? null,
          sortOrder: p.sortOrder,
        });
      }

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
        } catch {
          // Non-blocking — don't fail the create if TM is down
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

      const venueResult = await matchOrCreateVenue(input.venue as VenueInput);

      const productionName =
        input.kind === 'theatre'
          ? input.productionName ?? input.headliner.name
          : input.productionName ?? null;

      // Replace all performers and rebuild setlists map by resolved IDs.
      await ctx.db
        .delete(showPerformers)
        .where(eq(showPerformers.showId, input.showId));

      const setlistsMap: Record<string, string[]> = {};

      if (input.kind !== 'theatre') {
        const headlinerResult = await matchOrCreatePerformer({
          name: input.headliner.name,
          tmAttractionId: input.headliner.tmAttractionId,
          musicbrainzId: input.headliner.musicbrainzId,
          imageUrl: input.headliner.imageUrl,
        });

        await ctx.db.insert(showPerformers).values({
          showId: input.showId,
          performerId: headlinerResult.performer.id,
          role: 'headliner',
          characterName: null,
          sortOrder: 0,
        });

        if (input.headliner.setlist?.length) {
          setlistsMap[headlinerResult.performer.id] = input.headliner.setlist;
        }
      }

      if (input.performers?.length) {
        for (const p of input.performers) {
          const result = await matchOrCreatePerformer({
            name: p.name,
            tmAttractionId: p.tmAttractionId,
            musicbrainzId: p.musicbrainzId,
            imageUrl: p.imageUrl,
          });

          await ctx.db.insert(showPerformers).values({
            showId: input.showId,
            performerId: result.performer.id,
            role: p.role,
            characterName: p.characterName ?? null,
            sortOrder: p.sortOrder,
          });

          if (p.setlist?.length) {
            setlistsMap[result.performer.id] = p.setlist;
          }
        }
      }

      await ctx.db
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
