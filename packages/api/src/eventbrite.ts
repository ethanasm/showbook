// Eventbrite v3 API client. Used by the import flow to pull a user's past
// orders. Auth is OAuth2 (token managed by /api/eventbrite/* routes); we
// only consume the bearer token here.
//
// Docs: https://www.eventbrite.com/platform/api

import { child } from '@showbook/observability';

const log = child({ component: 'api.eventbrite', provider: 'eventbrite' });

const BASE_URL = 'https://www.eventbriteapi.com/v3';

export class EventbriteError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = 'EventbriteError';
  }
}

interface EventbriteOrder {
  id: string;
  status: string;
  created: string;
  changed: string;
  costs?: {
    gross?: { display?: string; major_value?: string };
  };
  event_id: string;
  event?: EventbriteEvent;
  attendees?: Array<{ ticket_class_name?: string }>;
}

interface EventbriteEvent {
  id: string;
  name?: { text?: string };
  start?: { local?: string; utc?: string; timezone?: string };
  end?: { local?: string; utc?: string };
  url?: string;
  venue?: EventbriteVenue;
  category?: { name?: string; short_name?: string };
}

interface EventbriteVenue {
  id?: string;
  name?: string;
  address?: {
    city?: string;
    region?: string;
    country?: string;
    localized_area_display?: string;
  };
  latitude?: string;
  longitude?: string;
}

interface OrdersResponse {
  pagination?: {
    object_count: number;
    page_number: number;
    page_size: number;
    page_count: number;
    has_more_items?: boolean;
    continuation?: string;
  };
  orders: EventbriteOrder[];
}

export interface EventbriteTicket {
  orderId: string;
  eventId: string;
  date: string | null;
  eventName: string | null;
  venueName: string | null;
  venueCity: string | null;
  venueState: string | null;
  price: string | null;
  ticketCount: number;
  /**
   * Eventbrite category names are free text ("Music", "Performing Arts",
   * "Comedy"…). We map a small subset to Showbook's `kind_hint` enum and
   * leave everything else null so the user picks in the review list.
   */
  kindHint: 'concert' | 'theatre' | 'comedy' | 'festival' | null;
}

function inferKindFromCategory(name?: string | null): EventbriteTicket['kindHint'] {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.includes('music')) return 'concert';
  if (n.includes('comedy')) return 'comedy';
  if (n.includes('theatre') || n.includes('theater') || n.includes('performing')) return 'theatre';
  if (n.includes('festival')) return 'festival';
  return null;
}

function mapOrder(order: EventbriteOrder): EventbriteTicket | null {
  // We require `event` to be expanded in the request — without it we can't
  // populate any of the show fields. Skip silently rather than emit a
  // malformed ticket the user can't act on.
  const event = order.event;
  if (!event) return null;

  const localStart = event.start?.local ?? event.start?.utc ?? null;
  const date = localStart ? localStart.slice(0, 10) : null;

  return {
    orderId: order.id,
    eventId: event.id,
    date,
    eventName: event.name?.text ?? null,
    venueName: event.venue?.name ?? null,
    venueCity: event.venue?.address?.city ?? null,
    venueState: event.venue?.address?.region ?? null,
    price: order.costs?.gross?.display ?? order.costs?.gross?.major_value ?? null,
    ticketCount: order.attendees?.length ?? 1,
    kindHint: inferKindFromCategory(event.category?.name),
  };
}

async function apiFetch<T>(accessToken: string, path: string): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const startedAt = Date.now();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const durationMs = Date.now() - startedAt;
  if (res.status === 429) {
    log.warn({ event: 'eventbrite.request.rate_limited', path, durationMs }, 'Eventbrite 429, retrying once');
    await new Promise((r) => setTimeout(r, 2000));
    const retry = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!retry.ok) {
      throw new EventbriteError(
        `Eventbrite ${retry.status}: ${retry.statusText}`,
        retry.status,
        path,
      );
    }
    return (await retry.json()) as T;
  }
  if (!res.ok) {
    log.warn({ event: 'eventbrite.request.error', path, status: res.status, durationMs }, 'Eventbrite non-OK');
    throw new EventbriteError(
      `Eventbrite ${res.status}: ${res.statusText}`,
      res.status,
      path,
    );
  }
  log.debug({ event: 'eventbrite.request.ok', path, status: res.status, durationMs }, 'Eventbrite request');
  return (await res.json()) as T;
}

/**
 * Fetch all of the authenticated user's past orders, paging through Eventbrite's
 * cursor-based pagination. The `event` and `event.venue` expansions are required
 * because we don't make a second round-trip per order.
 */
export async function getMyPastOrders(
  accessToken: string,
  opts: { maxPages?: number } = {},
): Promise<EventbriteTicket[]> {
  const maxPages = opts.maxPages ?? 20;
  const tickets: EventbriteTicket[] = [];
  let continuation: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      time_filter: 'past',
      expand: 'event,event.venue,event.category,attendees',
    });
    if (continuation) params.set('continuation', continuation);
    const data = await apiFetch<OrdersResponse>(
      accessToken,
      `/users/me/orders/?${params.toString()}`,
    );
    for (const o of data.orders ?? []) {
      const mapped = mapOrder(o);
      if (mapped) tickets.push(mapped);
    }
    if (!data.pagination?.has_more_items || !data.pagination.continuation) break;
    continuation = data.pagination.continuation;
  }
  return tickets;
}
