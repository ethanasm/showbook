import { child } from '@showbook/observability';

const log = child({ component: 'api.gmail', provider: 'gmail' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GmailMessage {
  id: string;
  threadId: string;
}

export interface GmailSearchResult {
  messages: GmailMessage[];
  nextPageToken?: string;
  resultSizeEstimate: number;
}

export interface GmailMessageDetail {
  subject: string;
  from: string;
  date: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class GmailError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: string,
  ) {
    super(message);
    this.name = 'GmailError';
  }
}

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

let lastRequestTime = 0;
const MIN_INTERVAL_MS = 200;

async function rateLimitedFetch(
  url: string,
  headers: Record<string, string>,
): Promise<Response> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_INTERVAL_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_INTERVAL_MS - timeSinceLastRequest),
    );
  }
  lastRequestTime = Date.now();

  const startedAt = Date.now();
  const response = await fetch(url, { headers });
  const durationMs = Date.now() - startedAt;
  if (response.status === 429) {
    log.warn({ event: 'gmail.request.rate_limited', durationMs }, 'Gmail 429, retrying');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return rateLimitedFetch(url, headers);
  }
  if (!response.ok) {
    log.warn({ event: 'gmail.request.error', status: response.status, durationMs }, 'Gmail non-OK response');
  } else {
    log.debug({ event: 'gmail.request.ok', status: response.status, durationMs }, 'Gmail request');
  }
  return response;
}

// ---------------------------------------------------------------------------
// Gmail API functions
// ---------------------------------------------------------------------------

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export async function searchMessages(
  accessToken: string,
  query: string,
  maxResults = 20,
  pageToken?: string,
): Promise<GmailSearchResult> {
  const params = new URLSearchParams({
    q: query,
    maxResults: String(maxResults),
  });
  if (pageToken) params.set('pageToken', pageToken);

  const url = `${GMAIL_BASE}/messages?${params}`;
  const response = await rateLimitedFetch(url, {
    Authorization: `Bearer ${accessToken}`,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new GmailError('Gmail search failed', response.status, detail);
  }

  const data = (await response.json()) as {
    messages?: GmailMessage[];
    nextPageToken?: string;
    resultSizeEstimate?: number;
  };

  return {
    messages: data.messages ?? [],
    nextPageToken: data.nextPageToken,
    resultSizeEstimate: data.resultSizeEstimate ?? 0,
  };
}

export async function getMessageBody(
  accessToken: string,
  messageId: string,
): Promise<GmailMessageDetail> {
  const url = `${GMAIL_BASE}/messages/${messageId}?format=full`;
  const response = await rateLimitedFetch(url, {
    Authorization: `Bearer ${accessToken}`,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new GmailError('Gmail message fetch failed', response.status, detail);
  }

  const data = (await response.json()) as {
    payload: {
      headers: Array<{ name: string; value: string }>;
      mimeType: string;
      body?: { data?: string };
      parts?: Array<{
        mimeType: string;
        body?: { data?: string };
        parts?: Array<{
          mimeType: string;
          body?: { data?: string };
        }>;
      }>;
    };
  };

  const headers = data.payload.headers;
  const subject =
    headers.find((h) => h.name.toLowerCase() === 'subject')?.value ?? '';
  const from =
    headers.find((h) => h.name.toLowerCase() === 'from')?.value ?? '';
  const date =
    headers.find((h) => h.name.toLowerCase() === 'date')?.value ?? '';

  const body = extractBody(data.payload);

  return { subject, from, date, body };
}

// ---------------------------------------------------------------------------
// Query builders
// ---------------------------------------------------------------------------

export function buildTicketSearchQuery(options: {
  headliner?: string;
  venue?: string;
}): string {
  const parts: string[] = [];
  if (options.headliner) parts.push(`"${options.headliner}"`);
  if (options.venue) parts.push(`"${options.venue}"`);
  parts.push('(ticket OR confirmation OR order)');
  return parts.join(' ');
}

const BULK_EXCLUSIONS =
  '-subject:(museum OR shipping OR shipped OR tracking OR poster OR merch OR ' +
  'merchandise OR "bus pass" OR shuttle OR parking OR camping OR flight OR hotel) ' +
  '-from:(museum OR gallery OR ups OR fedex OR usps OR airbnb OR hotels OR airline OR events@mail.stubhub.com OR livemusic@frontgatetickets.com)';

export function buildBulkScanQueries(): string[] {
  return [
    // High-priority: known purchase confirmation senders
    'from:(customer_support@email.ticketmaster.com OR guestservices@axs.com OR order-support@frontgatetickets.com OR no-reply@e.todaytix.com)',
    // Known ticket platforms by sender
    'subject:(ticket OR tickets OR confirmation OR order) ' +
    'from:(ticketmaster OR axs OR eventbrite OR stubhub OR seatgeek OR ' +
    '"live nation" OR vividseats OR telecharge OR dice OR aeg OR msg OR ' +
    '"see tickets" OR seetickets OR fever OR universe OR ' +
    'tixr OR seated OR lyte OR "front gate" OR frontgate OR etix OR ' +
    'tock OR songkick OR todaytix) ' +
    BULK_EXCLUSIONS,
    // Broader: ticket/order confirmations from any sender
    'subject:(tickets OR "order confirmation" OR "e-ticket" OR "booking confirmation") ' +
    '-category:promotions ' + BULK_EXCLUSIONS,
  ];
}

// ---------------------------------------------------------------------------
// Body decoding helpers
// ---------------------------------------------------------------------------

function decodeBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|td)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n /g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface MimePart {
  mimeType: string;
  body?: { data?: string };
  parts?: MimePart[];
}

function extractBody(payload: MimePart): string {
  // Collect all text content recursively
  const texts: string[] = [];
  const htmls: string[] = [];

  function walk(part: MimePart) {
    if (part.body?.data) {
      const decoded = decodeBase64Url(part.body.data);
      if (part.mimeType === 'text/plain') {
        texts.push(decoded);
      } else if (part.mimeType === 'text/html') {
        htmls.push(stripHtml(decoded));
      }
    }
    if (part.parts) {
      for (const child of part.parts) {
        walk(child);
      }
    }
  }

  walk(payload);

  // Pick the longest plain text if it's substantial, otherwise longest HTML
  const bestPlain = texts.sort((a, b) => b.length - a.length)[0] ?? '';
  const bestHtml = htmls.sort((a, b) => b.length - a.length)[0] ?? '';

  if (bestPlain.length >= bestHtml.length && bestPlain.length > 100) {
    return bestPlain;
  }
  if (bestHtml.length > 0) {
    return bestHtml;
  }
  return bestPlain;
}
