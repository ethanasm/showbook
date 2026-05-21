import { auth } from '@/auth';
import {
  searchMessages,
  getMessageBody,
  getAttachment,
  buildBulkScanQueries,
  extractShowFromEmail,
  extractShowFromPdfText,
  scoreEmailLikelyTicket,
  HEURISTIC_THRESHOLD,
  isRateLimited,
  GmailError,
  type GmailAttachmentRef,
  type ExtractedTicketInfo,
} from '@showbook/api';
import { db, shows } from '@showbook/db';
import { sql } from 'drizzle-orm';
import { child } from '@showbook/observability';
import { decodeMobileToken } from '@/lib/mobile-token';

const log = child({ component: 'web.gmail.scan' });

/**
 * Resolve the request session. Tries cookie auth first (web flow), falls
 * back to `Authorization: Bearer <jwt>` (mobile flow). Mobile-bearer
 * support keeps the scan endpoint reachable from the mobile app, which
 * minted its session via `/api/auth/mobile-token` and has no cookie jar.
 */
async function resolveSession(req: Request): Promise<{ userId: string } | null> {
  const cookieSession = await auth();
  if (cookieSession?.user?.id) return { userId: cookieSession.user.id };

  const header = req.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) return null;
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const decoded = await decodeMobileToken({ token: header.slice(7), secret });
  if (!decoded?.id) return null;
  return { userId: decoded.id };
}

const PDF_MAX_BYTES = 200 * 1024;

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

interface ProcessResult {
  ticket: ExtractedTicket | null;
  skippedByHeuristic: boolean;
  usedPdfFallback: boolean;
}

async function tryExtractFromPdf(
  accessToken: string,
  messageId: string,
  attachments: GmailAttachmentRef[],
): Promise<ExtractedTicketInfo | null> {
  const pdf = attachments.find(
    (a) => a.mimeType === 'application/pdf' && a.size > 0 && a.size <= PDF_MAX_BYTES,
  );
  if (!pdf) return null;

  let bytes: Buffer;
  try {
    bytes = await getAttachment(accessToken, messageId, pdf.attachmentId);
  } catch (err) {
    log.warn(
      { err, event: 'gmail.scan.attachment.fetch_failed', messageId },
      'Gmail attachment fetch failed',
    );
    return null;
  }

  let text: string;
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const result = await extractText(pdf, { mergePages: true });
    text = result.text.trim();
  } catch (err) {
    log.warn(
      { err, event: 'gmail.scan.attachment.parse_failed', messageId },
      'Gmail PDF parse failed',
    );
    return null;
  }

  if (!text) return null;

  try {
    return await extractShowFromPdfText(text);
  } catch (err) {
    log.warn(
      { err, event: 'gmail.scan.attachment.llm_failed', messageId },
      'PDF LLM extraction failed',
    );
    return null;
  }
}

async function processMessage(
  accessToken: string,
  messageId: string,
): Promise<ProcessResult> {
  const detail = await getMessageBody(accessToken, messageId);

  const score = scoreEmailLikelyTicket({
    subject: detail.subject,
    body: detail.body,
    from: detail.from,
  });
  if (score < HEURISTIC_THRESHOLD) {
    return { ticket: null, skippedByHeuristic: true, usedPdfFallback: false };
  }

  let extracted = await extractShowFromEmail(
    detail.subject,
    detail.body,
    detail.from,
    detail.date,
  );

  let usedPdfFallback = false;
  if (!extracted && detail.attachments.length > 0) {
    extracted = await tryExtractFromPdf(accessToken, messageId, detail.attachments);
    if (extracted) {
      usedPdfFallback = true;
      log.info(
        { event: 'gmail.scan.attachment.used', messageId },
        'Used PDF fallback for extraction',
      );
    }
  }

  if (!extracted) {
    return { ticket: null, skippedByHeuristic: false, usedPdfFallback };
  }

  extracted.date = correctExtractedYear(extracted.date, detail.date);
  return {
    ticket: { ...extracted, gmailMessageId: messageId },
    skippedByHeuristic: false,
    usedPdfFallback,
  };
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
  // unauthenticated access would be a direct cost vector. Accepts either
  // a NextAuth cookie session (web) or a mobile Bearer JWT.
  const session = await resolveSession(request);
  const userId = session?.userId;
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

        if (truncated) {
          log.info(
            { event: 'gmail.scan.truncated', userId, cap: MAX_MESSAGES_PER_SCAN },
            'Gmail scan hit message cap',
          );
        }

        // P4: cross-scan dedup. Pull every gmailMessageId already
        // referenced by one of this user's saved Shows, drop those before
        // we even fetch the body. The sourceRefs jsonb is queried with a
        // text-extraction operator so we don't need a new column or
        // migration.
        let dedupSkipped = 0;
        let messagesToProcess = allMessages;
        const seenRows = await db
          .select({ id: sql<string>`source_refs ->> 'gmailMessageId'` })
          .from(shows)
          .where(
            sql`${shows.userId} = ${userId} AND source_refs ? 'gmailMessageId'`,
          );
        const seenIds = new Set(seenRows.map((r) => r.id).filter(Boolean));
        if (seenIds.size > 0) {
          const before = allMessages.length;
          messagesToProcess = allMessages.filter((m) => !seenIds.has(m.id));
          dedupSkipped = before - messagesToProcess.length;
          if (dedupSkipped > 0) {
            log.info(
              { event: 'gmail.scan.dedup.skipped', userId, count: dedupSkipped },
              'Gmail scan skipped previously-saved messages',
            );
          }
        }

        const total = messagesToProcess.length;
        send('progress', { phase: 'processing', processed: 0, total, found: 0 });

        if (total === 0) {
          send('done', { tickets: [], truncated });
          controller.close();
          return;
        }

        // Step 2: extract in batches
        const BATCH_SIZE = 8;
        const allExtracted: ExtractedTicket[] = [];
        let heuristicSkipped = 0;
        let pdfFallbackUsed = 0;

        for (let i = 0; i < messagesToProcess.length; i += BATCH_SIZE) {
          const batch = messagesToProcess.slice(i, i + BATCH_SIZE);
          const results = await Promise.all(
            batch.map((msg) => processMessage(accessToken, msg.id)),
          );
          for (const result of results) {
            if (!result) continue;
            if (result.skippedByHeuristic) heuristicSkipped += 1;
            if (result.usedPdfFallback) pdfFallbackUsed += 1;
            if (result.ticket) allExtracted.push(result.ticket);
          }

          send('progress', {
            phase: 'processing',
            processed: Math.min(i + BATCH_SIZE, total),
            total,
            found: allExtracted.length,
          });
        }

        if (heuristicSkipped > 0 || pdfFallbackUsed > 0 || dedupSkipped > 0) {
          log.info(
            {
              event: 'gmail.scan.summary',
              userId,
              total,
              heuristicSkipped,
              pdfFallbackUsed,
              dedupSkipped,
              extracted: allExtracted.length,
            },
            'Gmail scan summary',
          );
        }

        // Step 3: merge
        const merged = mergeTickets(allExtracted);
        send('done', { tickets: merged, truncated });
      } catch (err) {
        // Tag GmailError separately so we can surface a status-aware
        // hint to the client and so Axiom queries can pivot on the
        // upstream Gmail HTTP status. Without this branch the only
        // server-side signal for a failed scan is the api.gmail
        // `gmail.request.error` warn — which lacks userId attribution
        // and the response body Google returned.
        const gmailStatus =
          err instanceof GmailError ? err.status : undefined;
        const message =
          err instanceof Error ? err.message : 'Scan failed';
        log.error(
          {
            event: 'gmail.scan.failed',
            err,
            userId,
            gmailStatus,
            gmailDetail:
              err instanceof GmailError
                ? err.detail?.slice(0, 500)
                : undefined,
          },
          'Gmail scan failed',
        );
        send('error', { message, status: gmailStatus });
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
