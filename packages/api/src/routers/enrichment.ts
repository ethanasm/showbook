import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withTrace, child } from '@showbook/observability';
import { router, protectedProcedure } from '../trpc';

const log = child({ component: 'api.enrichment' });
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
  extractShowFromPdfText,
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
import { geocodeVenue } from '../geocode';

function correctExtractedYear(
  extractedDate: string | null,
  emailDateHeader: string,
): string | null {
  if (!extractedDate || !emailDateHeader) return extractedDate;
  const emailSent = new Date(emailDateHeader);
  if (isNaN(emailSent.getTime())) return extractedDate;

  const match = extractedDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return extractedDate;

  const [, yearStr, month, day] = match;
  const extractedYear = parseInt(yearStr, 10);
  const emailYear = emailSent.getFullYear();

  // Event should be on or after the email was sent, within ~13 months
  if (extractedYear === emailYear || extractedYear === emailYear + 1) {
    return extractedDate;
  }

  // Year is wrong — pick emailYear or emailYear+1 based on which makes the
  // event date fall on or after the email sent date
  const candidateSame = new Date(`${emailYear}-${month}-${day}T00:00:00`);
  const candidateNext = new Date(`${emailYear + 1}-${month}-${day}T00:00:00`);

  const correctedYear =
    candidateSame >= emailSent ? emailYear : emailYear + 1;

  // Sanity check: don't "correct" to more than 13 months after email
  if (candidateNext < emailSent) return extractedDate;

  return `${correctedYear}-${month}-${day}`;
}

function mapEventToResult(event: TMEvent) {
  const venue = event._embedded?.venues?.[0];
  const attractions = event._embedded?.attractions ?? [];
  return {
    tmEventId: event.id,
    url: event.url ?? null,
    name: event.name,
    date: event.dates.start.localDate,
    venueName: venue?.name ?? null,
    venueCity: venue?.city?.name ?? null,
    venueState: venue?.state?.stateCode ?? null,
    venueCountry: venue?.country?.countryCode ?? null,
    venueTmId: venue?.id ?? null,
    venueLat: venue?.location?.latitude ? parseFloat(venue.location.latitude) : null,
    venueLng: venue?.location?.longitude ? parseFloat(venue.location.longitude) : null,
    kind: inferKind(event.classifications, { eventName: event.name }),
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
      const pathMatch = input.url.match(/\/event\/([A-Za-z0-9]+)/);
      const queryMatch = input.url.match(/[?&]eventId=([A-Za-z0-9]+)/);
      const eventId = pathMatch?.[1] ?? queryMatch?.[1] ?? input.url.trim();
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
    .mutation(async ({ input, ctx }) =>
      withTrace(
        'trpc.enrichment.parseChat',
        () => parseShowInput(input.freeText),
        { userId: ctx.session.user.id, tags: ['enrichment', 'llm'] },
      ),
    ),

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
      return geocodeVenue(input.venueName, input.city);
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
    .mutation(async ({ input, ctx }) =>
      withTrace(
        'trpc.enrichment.extractCast',
        async () => {
          const cast = await groqExtractCast(input.imageBase64);
          return { cast };
        },
        { userId: ctx.session.user.id, tags: ['enrichment', 'llm', 'playbill'] },
      ),
    ),

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
  // extractFromPdf — PDF ticket image(s) → structured show data
  // ---------------------------------------------------------------------------
  extractFromPdf: protectedProcedure
    .input(z.object({ fileBase64: z.string().min(1) }))
    .mutation(async ({ input, ctx }) =>
      withTrace(
        'trpc.enrichment.extractFromPdf',
        async () => {
          const pdfParse = (await import(/* webpackIgnore: true */ 'pdf-parse')).default;
          const buffer = Buffer.from(input.fileBase64, 'base64');
          const result = await pdfParse(buffer);
          if (!result.text.trim()) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Could not extract text from PDF' });
          }
          return extractShowFromPdfText(result.text);
        },
        { userId: ctx.session.user.id, tags: ['enrichment', 'llm', 'pdf'] },
      ),
    ),

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
    .mutation(async ({ input, ctx }) =>
      withTrace(
        'trpc.enrichment.scanGmailForShow',
        async () => {
          const query = buildTicketSearchQuery({
            headliner: input.headliner,
            venue: input.venue,
          });
          const { messages } = await searchMessages(input.accessToken, query, 5);

          const results: Array<{
            headliner: string;
            production_name: string | null;
            venue_name: string | null;
            venue_city: string | null;
            venue_state: string | null;
            date: string | null;
            seat: string | null;
            price: string | null;
            ticket_count: number | null;
            kind_hint: 'concert' | 'theatre' | 'comedy' | 'festival' | null;
            confidence: 'high' | 'medium' | 'low';
          }> = [];

          for (const msg of messages) {
            const detail = await getMessageBody(input.accessToken, msg.id);
            const extracted = await extractShowFromEmail(
              detail.subject,
              detail.body,
              detail.from,
              detail.date,
            );
            if (extracted) {
              extracted.date = correctExtractedYear(extracted.date, detail.date);
              results.push(extracted);
            }
          }

          return results;
        },
        { userId: ctx.session.user.id, tags: ['enrichment', 'llm', 'gmail'] },
      ),
    ),

  // ---------------------------------------------------------------------------
  // bulkScanGmail — scan all ticket emails with pagination
  // ---------------------------------------------------------------------------
  bulkScanGmail: protectedProcedure
    .input(
      z.object({
        accessToken: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) =>
      withTrace(
        'trpc.enrichment.bulkScanGmail',
        async () => {
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

      log.info({ event: 'gmail.bulk_scan.collected', total: allMessages.length, userId: ctx.session.user.id }, 'Collected Gmail messages');

      // Parse each message with LLM, dedup by show content
      const tickets: Array<{
        gmailMessageId: string;
        headliner: string;
        production_name: string | null;
        venue_name: string | null;
        venue_city: string | null;
        venue_state: string | null;
        date: string | null;
        seat: string | null;
        price: string | null;
        ticket_count: number | null;
        kind_hint: 'concert' | 'theatre' | 'comedy' | 'festival' | null;
        confidence: 'high' | 'medium' | 'low';
      }> = [];

      const BATCH_SIZE = 8;
      type TicketWithId = typeof tickets[number];
      const allExtracted: TicketWithId[] = [];

      for (let i = 0; i < allMessages.length; i += BATCH_SIZE) {
        log.debug(
          {
            event: 'gmail.bulk_scan.batch',
            batchStart: i + 1,
            batchEnd: Math.min(i + BATCH_SIZE, allMessages.length),
            total: allMessages.length,
            extractedSoFar: allExtracted.length,
          },
          'Processing Gmail batch',
        );
        const batch = allMessages.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (msg) => {
            const detail = await getMessageBody(accessToken, msg.id);
            const extracted = await extractShowFromEmail(
              detail.subject,
              detail.body,
              detail.from,
              detail.date,
            );
            if (extracted) {
              extracted.date = correctExtractedYear(extracted.date, detail.date);
            }
            if (extracted && (!extracted.date || !extracted.venue_name)) {
              log.warn(
                {
                  event: 'gmail.extract.incomplete',
                  headliner: extracted.headliner,
                  missingDate: !extracted.date,
                  missingVenue: !extracted.venue_name,
                  gmailMessageId: msg.id,
                },
                'Incomplete Gmail extraction',
              );
            }
            return extracted ? { ...extracted, gmailMessageId: msg.id } : null;
          }),
        );
        for (const result of results) {
          if (result) allExtracted.push(result);
        }
      }

      // Deterministic merge: group by headliner + month-day, combine best fields
      const mergeMap = new Map<string, TicketWithId>();
      const headlinerKey = (t: TicketWithId) => t.headliner.toLowerCase().trim();
      const monthDay = (date: string) => date.slice(5); // "MM-DD" from "YYYY-MM-DD"

      function isDifferentShow(dateA: string, dateB: string): boolean {
        // Same month-day with different year = same show (year was likely wrong)
        // Different month-day = genuinely different show
        return monthDay(dateA) !== monthDay(dateB);
      }

      function mergeInto(target: TicketWithId, source: TicketWithId) {
        if (!target.production_name && source.production_name) target.production_name = source.production_name;
        if (!target.venue_name && source.venue_name) target.venue_name = source.venue_name;
        if (!target.venue_city && source.venue_city) target.venue_city = source.venue_city;
        if (!target.venue_state && source.venue_state) target.venue_state = source.venue_state;
        if (!target.date && source.date) target.date = source.date;
        if (!target.seat && source.seat) target.seat = source.seat;
        if (!target.price && source.price) target.price = source.price;
        if (target.ticket_count == null && source.ticket_count != null) target.ticket_count = source.ticket_count;
        if (!target.kind_hint && source.kind_hint) target.kind_hint = source.kind_hint;
      }

      for (const ticket of allExtracted) {
        const key = headlinerKey(ticket);
        const existing = mergeMap.get(key);
        if (!existing) {
          mergeMap.set(key, { ...ticket });
        } else {
          if (existing.date && ticket.date && isDifferentShow(existing.date, ticket.date)) {
            const datedKey = `${key}|${monthDay(ticket.date)}`;
            const existingDated = mergeMap.get(datedKey);
            if (!existingDated) {
              mergeMap.set(datedKey, { ...ticket });
            } else {
              mergeInto(existingDated, ticket);
            }
            continue;
          }
          mergeInto(existing, ticket);
        }
      }

      const merged = Array.from(mergeMap.values());
      log.info(
        {
          event: 'gmail.bulk_scan.complete',
          extracted: allExtracted.length,
          merged: merged.length,
          userId: ctx.session.user.id,
        },
        'Gmail bulk scan complete',
      );

      return { tickets: merged };
        },
        { userId: ctx.session.user.id, tags: ['enrichment', 'llm', 'gmail', 'bulk'] },
      ),
    ),

  // ---------------------------------------------------------------------------
  // gmailCollectMessages — fetch all ticket email IDs (fast step)
  // ---------------------------------------------------------------------------
  gmailCollectMessages: protectedProcedure
    .input(z.object({ accessToken: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const queries = buildBulkScanQueries();
      const seen = new Set<string>();
      const messageIds: string[] = [];

      for (const query of queries) {
        let pageToken: string | undefined;
        do {
          const result = await searchMessages(input.accessToken, query, 100, pageToken);
          for (const msg of result.messages) {
            if (!seen.has(msg.id)) {
              seen.add(msg.id);
              messageIds.push(msg.id);
            }
          }
          pageToken = result.nextPageToken;
        } while (pageToken);
      }

      return { messageIds, total: messageIds.length };
    }),

  // ---------------------------------------------------------------------------
  // gmailProcessBatch — process a batch of message IDs with LLM (slow step)
  // ---------------------------------------------------------------------------
  gmailProcessBatch: protectedProcedure
    .input(z.object({
      accessToken: z.string().min(1),
      messageIds: z.array(z.string()),
    }))
    .mutation(async ({ input, ctx }) =>
      withTrace(
        'trpc.enrichment.gmailProcessBatch',
        async () => {
          const results = await Promise.all(
            input.messageIds.map(async (msgId) => {
              const detail = await getMessageBody(input.accessToken, msgId);
              const extracted = await extractShowFromEmail(
                detail.subject,
                detail.body,
                detail.from,
                detail.date,
              );
              if (extracted) {
                extracted.date = correctExtractedYear(extracted.date, detail.date);
              }
              return extracted ? { ...extracted, gmailMessageId: msgId } : null;
            }),
          );

          return { tickets: results.filter((r): r is NonNullable<typeof r> => r !== null) };
        },
        { userId: ctx.session.user.id, tags: ['enrichment', 'llm', 'gmail'], metadata: { batchSize: input.messageIds.length } },
      ),
    ),
});
