import { auth } from '@/auth';
import {
  searchMessages,
  getMessageBody,
  buildBulkScanQueries,
  extractShowFromEmail,
  isRateLimited,
} from '@showbook/api';
import { child } from '@showbook/observability';

const log = child({ component: 'web.gmail.scan' });

// Hard cap on emails processed per scan to bound Groq cost. A user with
// thousands of confirmation emails should narrow their date range rather
// than have the server burn through them all in one request.
const MAX_MESSAGES_PER_SCAN = 300;

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

  if (extractedYear === emailYear || extractedYear === emailYear + 1) {
    return extractedDate;
  }

  const candidateSame = new Date(`${emailYear}-${month}-${day}T00:00:00`);
  const candidateNext = new Date(`${emailYear + 1}-${month}-${day}T00:00:00`);
  const correctedYear = candidateSame >= emailSent ? emailYear : emailYear + 1;
  if (candidateNext < emailSent) return extractedDate;
  return `${correctedYear}-${month}-${day}`;
}

interface ExtractedTicket {
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
}

function mergeTickets(allExtracted: ExtractedTicket[]): ExtractedTicket[] {
  const mergeMap = new Map<string, ExtractedTicket>();
  const hKey = (t: ExtractedTicket) => t.headliner.toLowerCase().trim();
  const monthDay = (d: string) => d.slice(5);

  function mergeInto(target: ExtractedTicket, source: ExtractedTicket) {
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
    const key = hKey(ticket);
    const existing = mergeMap.get(key);
    if (!existing) {
      mergeMap.set(key, { ...ticket });
    } else if (existing.date && ticket.date && monthDay(existing.date) !== monthDay(ticket.date)) {
      const datedKey = `${key}|${monthDay(ticket.date)}`;
      const existingDated = mergeMap.get(datedKey);
      if (!existingDated) {
        mergeMap.set(datedKey, { ...ticket });
      } else {
        mergeInto(existingDated, ticket);
      }
    } else {
      mergeInto(existing, ticket);
    }
  }

  return Array.from(mergeMap.values());
}

export async function POST(request: Request) {
  // The middleware excludes /api/*; this endpoint drives Groq calls so
  // unauthenticated access would be a direct cost vector.
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (
    isRateLimited(`gmail.scan:${userId}`, {
      max: 5,
      windowMs: 60 * 60 * 1000,
    })
  ) {
    return new Response('Too Many Requests', { status: 429 });
  }

  const { accessToken } = await request.json();
  if (!accessToken) {
    return new Response('Missing accessToken', { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      try {
        // Step 1: collect message IDs
        send('progress', { phase: 'searching', processed: 0, total: 0, found: 0 });

        const queries = buildBulkScanQueries();
        const seen = new Set<string>();
        const allMessages: { id: string }[] = [];
        let truncated = false;

        outer: for (const query of queries) {
          let pageToken: string | undefined;
          do {
            const result = await searchMessages(accessToken, query, 100, pageToken);
            for (const msg of result.messages) {
              if (!seen.has(msg.id)) {
                seen.add(msg.id);
                allMessages.push(msg);
                if (allMessages.length >= MAX_MESSAGES_PER_SCAN) {
                  truncated = true;
                  break outer;
                }
              }
            }
            pageToken = result.nextPageToken;
          } while (pageToken);
        }

        const total = allMessages.length;
        send('progress', { phase: 'processing', processed: 0, total, found: 0 });

        if (truncated) {
          log.info(
            { event: 'gmail.scan.truncated', userId, cap: MAX_MESSAGES_PER_SCAN },
            'Gmail scan hit message cap',
          );
        }

        if (total === 0) {
          send('done', { tickets: [], truncated });
          controller.close();
          return;
        }

        // Step 2: extract in batches
        const BATCH_SIZE = 8;
        const allExtracted: ExtractedTicket[] = [];

        for (let i = 0; i < allMessages.length; i += BATCH_SIZE) {
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
              return extracted ? { ...extracted, gmailMessageId: msg.id } : null;
            }),
          );
          for (const result of results) {
            if (result) allExtracted.push(result);
          }

          send('progress', {
            phase: 'processing',
            processed: Math.min(i + BATCH_SIZE, total),
            total,
            found: allExtracted.length,
          });
        }

        // Step 3: merge
        const merged = mergeTickets(allExtracted);
        send('done', { tickets: merged, truncated });
      } catch (err) {
        send('error', { message: err instanceof Error ? err.message : 'Scan failed' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
