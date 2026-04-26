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

  const response = await fetch(url, { headers });
  if (response.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return rateLimitedFetch(url, headers);
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

export function buildBulkScanQueries(): string[] {
  return [
    // High-precision: known ticket platforms by sender
    'subject:(ticket OR tickets OR confirmation OR order) ' +
    'from:(ticketmaster OR axs OR eventbrite OR stubhub OR seatgeek OR ' +
    '"live nation" OR vividseats OR telecharge OR "seat geek" OR dice OR ' +
    'aeg OR msg)',
    // High-recall: broader subject search, exclude promotions
    'subject:(ticket OR tickets OR "order confirmation" OR "your order" OR ' +
    '"event confirmation" OR "your tickets" OR "booking confirmation") ' +
    '-category:promotions',
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
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBody(payload: {
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
}): string {
  // Direct body (non-multipart)
  if (payload.body?.data && !payload.parts) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === 'text/html') return stripHtml(decoded);
    return decoded;
  }

  if (!payload.parts) return '';

  // Prefer text/plain
  const plainPart = payload.parts.find((p) => p.mimeType === 'text/plain');
  if (plainPart?.body?.data) {
    return decodeBase64Url(plainPart.body.data);
  }

  // Fall back to text/html
  const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html');
  if (htmlPart?.body?.data) {
    return stripHtml(decodeBase64Url(htmlPart.body.data));
  }

  // Check nested parts (multipart/alternative inside multipart/mixed)
  for (const part of payload.parts) {
    if (part.parts) {
      const nestedPlain = part.parts.find((p) => p.mimeType === 'text/plain');
      if (nestedPlain?.body?.data) {
        return decodeBase64Url(nestedPlain.body.data);
      }
      const nestedHtml = part.parts.find((p) => p.mimeType === 'text/html');
      if (nestedHtml?.body?.data) {
        return stripHtml(decodeBase64Url(nestedHtml.body.data));
      }
    }
  }

  return '';
}
