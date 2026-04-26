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
import {
  autocomplete as placesAutocomplete,
  getPlaceDetails,
} from '../google-places';

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
          venueState: venue?.state?.stateCode ?? null,
          venueCountry: venue?.country?.countryCode ?? null,
          venueTmId: venue?.id ?? null,
          venueLat: venue?.location?.latitude ? parseFloat(venue.location.latitude) : null,
          venueLng: venue?.location?.longitude ? parseFloat(venue.location.longitude) : null,
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
  // geocodeVenue — lat/lng lookup for manually entered venues
  // ---------------------------------------------------------------------------
  geocodeVenue: protectedProcedure
    .input(
      z.object({
        venueName: z.string().min(1),
        city: z.string().min(1),
      }),
    )
    .query(async ({ input }) => {
      const headers = { 'User-Agent': 'Showbook/1.0' };
      const queries = [
        `${input.venueName}, ${input.city}`,
        `${input.venueName.replace(/^The /i, '')}, ${input.city}`,
        `${input.venueName} ${input.city.split(',')[0]}`,
      ];

      for (const query of queries) {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
        try {
          const res = await fetch(url, { headers });
          if (!res.ok) continue;
          const results = await res.json() as Array<{ lat: string; lon: string }>;
          if (results.length > 0) {
            return {
              lat: parseFloat(results[0].lat),
              lng: parseFloat(results[0].lon),
            };
          }
        } catch {
          continue;
        }
      }
      return null;
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

  searchPlaces: protectedProcedure
    .input(z.object({
      query: z.string().min(2),
      types: z.enum(['venue', 'city']).default('venue'),
    }))
    .query(async ({ input }) => {
      const typeMap = {
        venue: ['establishment'],
        city: ['locality', 'administrative_area_level_1'],
      };
      return placesAutocomplete(input.query, typeMap[input.types]);
    }),

  placeDetails: protectedProcedure
    .input(z.object({ placeId: z.string().min(1) }))
    .query(async ({ input }) => {
      const details = await getPlaceDetails(input.placeId);
      if (!details) throw new TRPCError({ code: 'NOT_FOUND', message: 'Place not found' });
      return details;
    }),
});
