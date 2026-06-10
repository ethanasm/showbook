import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withTrace, child } from '@showbook/observability';
import { router, protectedProcedure } from '../trpc';
import { enforceRateLimit } from '../rate-limit';
import {
  enforceLLMQuota,
  enforceBulkScanRateLimit,
  bulkScanMessageCap,
} from '../llm-quota';

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
  extractFestivalLineupFromImage,
  extractFestivalLineupFromPdfText,
  summarizeShowSaved,
} from '../groq';
import { eq, and } from 'drizzle-orm';
import { shows } from '@showbook/db';
import { searchAttractions, extractMusicbrainzId } from '../ticketmaster';
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
import { loadVenueNameOverrides } from '../venue-names';

/**
 * Deterministic confirmation copy assembled from show fields, used
 * when Groq isn't available (no API key, transient failure, etc).
 * Voice matches the chat-style summary so reviewers / readers can't
 * tell which path produced it.
 */
export function buildShowSavedFallback(args: {
  kind: 'concert' | 'theatre' | 'comedy' | 'festival';
  title: string;
  venueName: string;
  date: string | null;
}): string {
  const noun =
    args.kind === 'festival'
      ? 'festival'
      : args.kind === 'theatre'
        ? 'production'
        : 'show';
  const dateFragment = args.date ? `on ${formatShowDateForChat(args.date)} ` : '';
  return `Added ${args.title} ${dateFragment}at ${args.venueName} to your ${noun}s. Anything else?`;
}

function formatShowDateForChat(iso: string): string {
  // Local-midnight parsing avoids the "off by one day" timezone bug
  // bare `new Date('YYYY-MM-DD')` causes (UTC midnight) when the
  // server runs west of UTC.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
  );
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function correctExtractedYear(
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

export function mapEventToResult(event: TMEvent) {
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
    .query(async ({ input, ctx }) => {
      enforceRateLimit(`searchTM:${ctx.session.user.id}`, {
        max: 60,
        windowMs: 60_000,
      });
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
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(`fetchTMEventByUrl:${ctx.session.user.id}`, {
        max: 60,
        windowMs: 60_000,
      });
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
    .query(async ({ input, ctx }) => {
      enforceRateLimit(`fetchSetlist:${ctx.session.user.id}`, {
        max: 30,
        windowMs: 60_000,
      });
      let mbid = input.performerMbid;

      if (!mbid) {
        const artists = await searchArtist(input.performerName);
        if (artists.length === 0) {
          return null;
        }
        mbid = artists[0]!.mbid;
      }

      const result = await searchSetlist(mbid, input.date);
      if (!result) {
        // Artist match succeeded — hand the resolved MBID back so the
        // caller (Add page) can persist it on the performer row even when
        // setlist.fm has no setlist for this date. Without this, the Add
        // flow loses every MBID setlist.fm couldn't find a setlist for.
        return { setlist: null, tourName: null, mbid };
      }

      return {
        setlist: result.setlist,
        tourName: result.tourName ?? null,
        mbid,
      };
    }),

  // ---------------------------------------------------------------------------
  // parseChat — LLM free-text parsing
  // ---------------------------------------------------------------------------
  //
  // Accepts an optional `recentShows` array — shows the user has
  // already discussed in this conversation. The Groq prompt uses it
  // to resolve pronouns and shorthand references ("him", "her",
  // "also", "again", "that one") to a previously named headliner,
  // so multi-turn flows like:
  //
  //   user: "Bon Iver at the Hollywood Bowl August 5, 2018"
  //   [...saved...]
  //   user: "I also saw him October 23, 2016"
  //
  // resolve "him" → "Bon Iver" instead of returning an empty headliner.
  parseChat: protectedProcedure
    .input(
      z.object({
        freeText: z.string().min(1),
        // Cap at 5 — anything older than that has very low signal for
        // pronoun resolution and burns tokens.
        recentShows: z
          .array(
            z.object({
              headliner: z.string().min(1).max(200),
              date: z.string().max(40).nullable().optional(),
              venue: z.string().max(200).nullable().optional(),
              kind: z
                .enum(['concert', 'theatre', 'comedy', 'festival'])
                .nullable()
                .optional(),
            }),
          )
          .max(5)
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      enforceLLMQuota(ctx.session.user.id);
      return withTrace(
        'trpc.enrichment.parseChat',
        () =>
          parseShowInput(input.freeText, {
            recentShows: input.recentShows,
          }),
        { userId: ctx.session.user.id, tags: ['enrichment', 'llm'] },
      );
    }),

  // ---------------------------------------------------------------------------
  // summarizeShowSaved — short chat-style confirmation after a save
  // ---------------------------------------------------------------------------
  //
  // The mobile add-form routes back to the chat screen with a saved
  // show id; the chat surface calls this to render a one-line
  // confirmation ("Got it — Bon Iver at the Hollywood Bowl is in the
  // books. Anything else?") so the user can keep going without
  // navigating to the detail page.
  //
  // The Groq round-trip is best-effort. If `GROQ_API_KEY` is missing
  // or the call fails, the procedure returns a deterministic fallback
  // assembled from the show fields. The client never has to know
  // which path was taken.
  summarizeShowSaved: protectedProcedure
    .input(z.object({ showId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
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
      // Use the user's venue alias (if any) in the confirmation message.
      const venueNameOverrides = await loadVenueNameOverrides(
        ctx.db,
        userId,
        [show.venue.id],
      );
      const venueName = venueNameOverrides.get(show.venue.id) ?? show.venue.name;
      const sorted = [...show.showPerformers].sort((a, b) => a.sortOrder - b.sortOrder);
      const headlinerRow = sorted.find((p) => p.role === 'headliner');
      const supportingActs = sorted
        .filter((p) => p.role !== 'headliner')
        .map((p) => p.performer.name);
      const titleFromHeadliner = headlinerRow?.performer.name ?? '';
      const title =
        show.kind === 'theatre' || show.kind === 'festival'
          ? show.productionName ?? titleFromHeadliner
          : titleFromHeadliner;

      const fallback = buildShowSavedFallback({
        kind: show.kind as 'concert' | 'theatre' | 'comedy' | 'festival',
        title,
        venueName,
        date: show.date ?? null,
      });

      const message = await withTrace(
        'trpc.enrichment.summarizeShowSaved',
        () =>
          summarizeShowSaved({
            kind: show.kind as 'concert' | 'theatre' | 'comedy' | 'festival',
            title,
            venueName,
            venueCity: show.venue.city,
            date: show.date ?? null,
            endDate: show.endDate ?? null,
            state: show.state as 'past' | 'ticketed' | 'watching',
            supportingActs: supportingActs.slice(0, 6),
          }),
        { userId, tags: ['enrichment', 'llm'] },
      );

      return { message: message ?? fallback, fallback };
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
    .mutation(async ({ input, ctx }) => {
      enforceLLMQuota(ctx.session.user.id);
      return withTrace(
        'trpc.enrichment.extractCast',
        async () => {
          const cast = await groqExtractCast(input.imageBase64);
          return { cast };
        },
        { userId: ctx.session.user.id, tags: ['enrichment', 'llm', 'playbill'] },
      );
    }),

  searchPlaces: protectedProcedure
    .input(z.object({
      query: z.string().min(2),
      types: z.enum(['venue', 'city']).default('venue'),
    }))
    .query(async ({ input, ctx }) => {
      enforceRateLimit(`searchPlaces:${ctx.session.user.id}`, {
        max: 30,
        windowMs: 60_000,
      });
      // 'venue' sends no type filter — Places API (New) treats `establishment`
      // as an umbrella, so filtering on it excludes leaf types like
      // `performing_arts_theater` / `concert_hall`. Letting Google rank
      // unrestricted matches surfaces Broadway theatres + lets the user
      // search by street address (e.g. "149 W 45").
      const types =
        input.types === 'city'
          ? ['locality', 'administrative_area_level_1']
          : undefined;
      return placesAutocomplete(input.query, types);
    }),

  placeDetails: protectedProcedure
    .input(z.object({ placeId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      enforceRateLimit(`placeDetails:${ctx.session.user.id}`, {
        max: 30,
        windowMs: 60_000,
      });
      const details = await getPlaceDetails(input.placeId);
      if (!details) throw new TRPCError({ code: 'NOT_FOUND', message: 'Place not found' });
      return details;
    }),

  // ---------------------------------------------------------------------------
  // extractFromPdf — PDF ticket image(s) → structured show data
  // ---------------------------------------------------------------------------
  extractFromPdf: protectedProcedure
    .input(z.object({ fileBase64: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      enforceLLMQuota(ctx.session.user.id);
      return withTrace(
        'trpc.enrichment.extractFromPdf',
        async () => {
          const { extractText, getDocumentProxy } = await import('unpdf');
          const buffer = Buffer.from(input.fileBase64, 'base64');
          const pdf = await getDocumentProxy(new Uint8Array(buffer));
          const { text } = await extractText(pdf, { mergePages: true });
          if (!text.trim()) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Could not extract text from PDF' });
          }
          return extractShowFromPdfText(text);
        },
        { userId: ctx.session.user.id, tags: ['enrichment', 'llm', 'pdf'] },
      );
    }),

  // ---------------------------------------------------------------------------
  // extractFestivalLineup — festival poster image OR schedule PDF → lineup
  // with per-artist headliner/support tiers + festival metadata
  // ---------------------------------------------------------------------------
  extractFestivalLineup: protectedProcedure
    .input(
      z
        .object({
          imageBase64: z.string().min(1).optional(),
          pdfBase64: z.string().min(1).optional(),
        })
        .refine((v) => Boolean(v.imageBase64) || Boolean(v.pdfBase64), {
          message: 'imageBase64 or pdfBase64 required',
        }),
    )
    .mutation(async ({ input, ctx }) => {
      enforceLLMQuota(ctx.session.user.id);
      return withTrace(
        'trpc.enrichment.extractFestivalLineup',
        async () => {
          log.info(
            {
              event: 'festival.lineup.extract.started',
              source: input.imageBase64 ? 'image' : 'pdf',
            },
            'Festival lineup extraction started',
          );
          try {
            let lineup;
            if (input.imageBase64) {
              lineup = await extractFestivalLineupFromImage(input.imageBase64);
            } else {
              const { extractText, getDocumentProxy } = await import('unpdf');
              const buffer = Buffer.from(input.pdfBase64!, 'base64');
              const pdf = await getDocumentProxy(new Uint8Array(buffer));
              const { text } = await extractText(pdf, { mergePages: true });
              if (!text.trim()) {
                throw new TRPCError({
                  code: 'BAD_REQUEST',
                  message: 'Could not extract text from PDF',
                });
              }
              lineup = await extractFestivalLineupFromPdfText(text);
            }
            log.info(
              {
                event: 'festival.lineup.extract.parsed',
                artistCount: lineup.artists.length,
                hasFestivalName: Boolean(lineup.festivalName),
                hasDates: Boolean(lineup.startDate),
              },
              'Festival lineup extracted',
            );
            return lineup;
          } catch (err) {
            log.error(
              { err, event: 'festival.lineup.extract.failed' },
              'Festival lineup extraction failed',
            );
            throw err;
          }
        },
        { userId: ctx.session.user.id, tags: ['enrichment', 'llm', 'festival'] },
      );
    }),

  // ---------------------------------------------------------------------------
  // matchFestivalArtists — batch-match extracted artist names to TM attractions
  // so the lineup picker can show artist images + capture tmAttractionId for
  // downstream follow/ingest. One TM search per name, capped at 50.
  // ---------------------------------------------------------------------------
  matchFestivalArtists: protectedProcedure
    .input(z.object({ names: z.array(z.string().min(1).max(120)).min(1).max(50) }))
    .mutation(async ({ input, ctx }) => {
      enforceRateLimit(`matchFestivalArtists:${ctx.session.user.id}`, {
        max: 10,
        windowMs: 60_000,
      });
      const results = await Promise.all(
        input.names.map(async (name) => {
          try {
            const attractions = await searchAttractions(name);
            const top = attractions[0];
            if (!top) {
              log.info(
                { event: 'festival.lineup.tm_match.miss', name },
                'TM artist match miss',
              );
              return {
                name,
                tmAttractionId: null as string | null,
                tmName: null as string | null,
                imageUrl: null as string | null,
                musicbrainzId: null as string | null,
              };
            }
            log.info(
              { event: 'festival.lineup.tm_match.hit', name, tmAttractionId: top.id },
              'TM artist match hit',
            );
            return {
              name,
              tmAttractionId: top.id,
              tmName: top.name,
              imageUrl: selectBestImage(top.images),
              musicbrainzId: extractMusicbrainzId(top) ?? null,
            };
          } catch (err) {
            log.warn(
              { err, event: 'festival.lineup.tm_match.failed', name },
              'TM artist match call failed',
            );
            return {
              name,
              tmAttractionId: null,
              tmName: null,
              imageUrl: null,
              musicbrainzId: null,
            };
          }
        }),
      );
      return { matches: results };
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
    .mutation(async ({ input, ctx }) => {
      enforceLLMQuota(ctx.session.user.id);
      return withTrace(
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
      );
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
    .mutation(async ({ input, ctx }) => {
      enforceBulkScanRateLimit(ctx.session.user.id);
      enforceLLMQuota(ctx.session.user.id);
      return withTrace(
        'trpc.enrichment.bulkScanGmail',
        async () => {
      const { accessToken } = input;
      const queries = buildBulkScanQueries();
      const messageCap = bulkScanMessageCap();

      // Fetch up to `messageCap` messages across queries to bound LLM cost
      const seen = new Set<string>();
      const allMessages: Array<{ id: string }> = [];

      outer: for (const query of queries) {
        let pageToken: string | undefined;
        do {
          const result = await searchMessages(accessToken, query, 100, pageToken);
          for (const msg of result.messages) {
            if (!seen.has(msg.id)) {
              seen.add(msg.id);
              allMessages.push(msg);
              if (allMessages.length >= messageCap) {
                log.info(
                  { event: 'gmail.bulk_scan.truncated', cap: messageCap, userId: ctx.session.user.id },
                  'Bulk scan truncated at message cap',
                );
                break outer;
              }
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
      );
    }),

  // ---------------------------------------------------------------------------
  // gmailCollectMessages — fetch all ticket email IDs (fast step)
  // ---------------------------------------------------------------------------
  gmailCollectMessages: protectedProcedure
    .input(z.object({ accessToken: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      enforceBulkScanRateLimit(ctx.session.user.id);
      const queries = buildBulkScanQueries();
      const messageCap = bulkScanMessageCap();
      const seen = new Set<string>();
      const messageIds: string[] = [];

      outer: for (const query of queries) {
        let pageToken: string | undefined;
        do {
          const result = await searchMessages(input.accessToken, query, 100, pageToken);
          for (const msg of result.messages) {
            if (!seen.has(msg.id)) {
              seen.add(msg.id);
              messageIds.push(msg.id);
              if (messageIds.length >= messageCap) break outer;
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
      messageIds: z.array(z.string()).max(50),
    }))
    .mutation(async ({ input, ctx }) => {
      enforceLLMQuota(ctx.session.user.id);
      return withTrace(
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
      );
    }),
});
