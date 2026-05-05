import { auth } from '@/auth';
import { db, shows, venues } from '@showbook/db';
import { and, eq } from 'drizzle-orm';
import {
  getMyPastOrders,
  EventbriteError,
  isRateLimited,
  type EventbriteTicket,
} from '@showbook/api';
import { child } from '@showbook/observability';

const log = child({ component: 'web.eventbrite.scan' });

export interface EventbriteReviewTicket extends EventbriteTicket {
  duplicate: boolean;
}

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (
    isRateLimited(`eventbrite.scan:${userId}`, {
      max: 5,
      windowMs: 60 * 60 * 1000,
    })
  ) {
    return new Response('Too Many Requests', { status: 429 });
  }

  const { accessToken } = (await request.json()) as { accessToken?: string };
  if (!accessToken) {
    return new Response('Missing accessToken', { status: 400 });
  }

  let tickets: EventbriteTicket[];
  try {
    tickets = await getMyPastOrders(accessToken);
  } catch (err) {
    if (err instanceof EventbriteError && err.status === 401) {
      return new Response('Eventbrite token rejected', { status: 401 });
    }
    log.warn({ err, event: 'eventbrite.scan.failed', userId }, 'Eventbrite scan failed');
    return new Response('Eventbrite scan failed', { status: 502 });
  }

  // Cheap dedupe: compare against the user's existing show dates. The Gmail
  // import follows the same pattern (the modal also surfaces a per-row "Already
  // added" badge so the user has the final say).
  const existing = await db
    .select({ date: shows.date, venueName: venues.name })
    .from(shows)
    .leftJoin(venues, eq(venues.id, shows.venueId))
    .where(eq(shows.userId, userId));
  const existingDates = new Set(
    existing
      .map((r) => (r.date ? r.date.slice(0, 10) : null))
      .filter((d): d is string => d != null),
  );

  const result: EventbriteReviewTicket[] = tickets.map((t) => ({
    ...t,
    duplicate: t.date != null && existingDates.has(t.date),
  }));

  log.info(
    {
      event: 'eventbrite.scan.complete',
      userId,
      tickets: result.length,
    },
    'Eventbrite scan complete',
  );

  return Response.json({ tickets: result });
}
