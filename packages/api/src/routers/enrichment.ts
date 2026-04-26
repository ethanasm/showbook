import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import {
  searchEvents,
  getEvent,
  inferKind,
  selectBestImage,
  type TMEvent,
} from '../ticketmaster';
import { searchArtist, searchSetlist } from '../setlistfm';
import {
  parseShowInput,
  extractCast as groqExtractCast,
  extractShowFromEmail,
} from '../groq';
import {
  autocomplete as placesAutocomplete,
  getPlaceDetails,
} from '../google-places';
import {
  searchMessages,
  getMessageBody,
  buildTicketSearchQuery,
  buildBulkScanQueries,
} from '../gmail';

function mapEventToResult(event: TMEvent) {
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
}

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

      return events.map(mapEventToResult);
    }),

  // ---------------------------------------------------------------------------
  // fetchTMEventByUrl — fetch a single TM event from a URL or event ID
  // ---------------------------------------------------------------------------
  fetchTMEventByUrl: protectedProcedure
    .input(z.object({ url: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const match = input.url.match(/\/event\/([A-Za-z0-9]+)/);
      const eventId = match ? match[1] : input.url.trim();
      if (!eventId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Could not parse event ID from URL' });
      }
      const event = await getEvent(eventId);
      if (!event) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Event not found on Ticketmaster' });
      }
      return mapEventToResult(event);
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

  // ---------------------------------------------------------------------------
  // scanGmailForShow — search Gmail for a specific show's tickets
  // ---------------------------------------------------------------------------
  scanGmailForShow: protectedProcedure
    .input(
      z.object({
        accessToken: z.string().min(1),
        headliner: z.string().min(1),
        venue: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const query = buildTicketSearchQuery({
        headliner: input.headliner,
        venue: input.venue,
      });
      const { messages } = await searchMessages(input.accessToken, query, 5);

      const results: Array<{
        headliner: string;
        venue_name: string | null;
        venue_city: string | null;
        date: string | null;
        seat: string | null;
        price: string | null;
        kind_hint: 'concert' | 'theatre' | 'comedy' | 'festival' | null;
        confidence: 'high' | 'medium' | 'low';
      }> = [];

      for (const msg of messages) {
        const detail = await getMessageBody(input.accessToken, msg.id);
        const extracted = await extractShowFromEmail(
          detail.subject,
          detail.body,
          detail.from,
        );
        if (extracted) results.push(extracted);
      }

      return results;
    }),

  // ---------------------------------------------------------------------------
  // bulkScanGmail — scan all ticket emails with pagination
  // ---------------------------------------------------------------------------
  bulkScanGmail: protectedProcedure
    .input(
      z.object({
        accessToken: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const { accessToken } = input;
      const queries = buildBulkScanQueries();

      // Fetch ALL pages from Gmail for each query
      const seen = new Set<string>();
      const allMessages: Array<{ id: string }> = [];

      for (const query of queries) {
        let pageToken: string | undefined;
        do {
          const result = await searchMessages(accessToken, query, 100, pageToken);
          for (const msg of result.messages) {
            if (!seen.has(msg.id)) {
              seen.add(msg.id);
              allMessages.push(msg);
            }
          }
          pageToken = result.nextPageToken;
        } while (pageToken);
      }

      // Parse each message with LLM, dedup by show content
      const tickets: Array<{
        gmailMessageId: string;
        headliner: string;
        venue_name: string | null;
        venue_city: string | null;
        date: string | null;
        seat: string | null;
        price: string | null;
        kind_hint: 'concert' | 'theatre' | 'comedy' | 'festival' | null;
        confidence: 'high' | 'medium' | 'low';
      }> = [];

      const seenShows = new Set<string>();
      for (const msg of allMessages) {
        const detail = await getMessageBody(accessToken, msg.id);
        const extracted = await extractShowFromEmail(
          detail.subject,
          detail.body,
          detail.from,
        );
        if (extracted) {
          const showKey = `${extracted.headliner.toLowerCase()}|${extracted.date ?? ''}|${(extracted.venue_name ?? '').toLowerCase()}`;
          if (!seenShows.has(showKey)) {
            seenShows.add(showKey);
            tickets.push({ ...extracted, gmailMessageId: msg.id });
          }
        }
      }

      return { tickets };
    }),
});
