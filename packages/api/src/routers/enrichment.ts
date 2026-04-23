import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import {
  searchEvents,
  inferKind,
  selectBestImage,
} from '../ticketmaster';
import { searchArtist, searchSetlist } from '../setlistfm';
import {
  parseShowInput,
  extractCast as groqExtractCast,
} from '../groq';

export const enrichmentRouter = router({
  // ---------------------------------------------------------------------------
  // searchTM — search Ticketmaster events by headliner
  // ---------------------------------------------------------------------------
  searchTM: protectedProcedure
    .input(
      z.object({
        headliner: z.string().min(1),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        kind: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const { events } = await searchEvents({
        keyword: input.headliner,
        startDateTime: input.startDate,
        endDateTime: input.endDate,
        classificationName: input.kind,
        size: 5,
      });

      return events.map((event) => {
        const venue = event._embedded?.venues?.[0];
        const attractions = event._embedded?.attractions ?? [];

        return {
          tmEventId: event.id,
          name: event.name,
          date: event.dates.start.localDate,
          venueName: venue?.name ?? null,
          venueCity: venue?.city?.name ?? null,
          kind: inferKind(event.classifications),
          performers: attractions.map((attraction) => ({
            name: attraction.name,
            tmAttractionId: attraction.id,
            imageUrl: selectBestImage(attraction.images),
          })),
        };
      });
    }),

  // ---------------------------------------------------------------------------
  // fetchSetlist — get setlist for a performer + date
  // ---------------------------------------------------------------------------
  fetchSetlist: protectedProcedure
    .input(
      z.object({
        performerName: z.string().min(1),
        performerMbid: z.string().optional(),
        date: z.string().min(1),
      }),
    )
    .query(async ({ input }) => {
      let mbid = input.performerMbid;

      if (!mbid) {
        const artists = await searchArtist(input.performerName);
        if (artists.length === 0) {
          return null;
        }
        mbid = artists[0]!.mbid;
      }

      const setlist = await searchSetlist(mbid, input.date);
      if (!setlist) {
        return null;
      }

      return {
        songs: setlist.songs,
        tourName: setlist.tourName,
        mbid,
      };
    }),

  // ---------------------------------------------------------------------------
  // parseChat — LLM free-text parsing
  // ---------------------------------------------------------------------------
  parseChat: protectedProcedure
    .input(
      z.object({
        freeText: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      return parseShowInput(input.freeText);
    }),

  // ---------------------------------------------------------------------------
  // extractCast — playbill image → cast list
  // ---------------------------------------------------------------------------
  extractCast: protectedProcedure
    .input(
      z.object({
        imageBase64: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const cast = await groqExtractCast(input.imageBase64);
      return { cast };
    }),
});
