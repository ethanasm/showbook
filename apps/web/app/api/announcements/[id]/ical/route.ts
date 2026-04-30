import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  db,
  announcements,
  userVenueFollows,
  userPerformerFollows,
  eq,
  and,
} from '@showbook/db';
import {
  buildIcs,
  defaultShowTime,
  slugifyForFilename,
  type IcsEvent,
} from '@showbook/shared';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  const announcement = await db.query.announcements.findFirst({
    where: eq(announcements.id, id),
    with: { venue: true },
  });

  if (!announcement) return new NextResponse('Not Found', { status: 404 });

  // Authorize: user must follow the venue or the headlining performer.
  const [venueFollow] = await db
    .select({ venueId: userVenueFollows.venueId })
    .from(userVenueFollows)
    .where(
      and(
        eq(userVenueFollows.userId, userId),
        eq(userVenueFollows.venueId, announcement.venueId),
      ),
    )
    .limit(1);

  let allowed = Boolean(venueFollow);
  if (!allowed && announcement.headlinerPerformerId) {
    const [performerFollow] = await db
      .select({ performerId: userPerformerFollows.performerId })
      .from(userPerformerFollows)
      .where(
        and(
          eq(userPerformerFollows.userId, userId),
          eq(userPerformerFollows.performerId, announcement.headlinerPerformerId),
        ),
      )
      .limit(1);
    allowed = Boolean(performerFollow);
  }

  if (!allowed) return new NextResponse('Not Found', { status: 404 });

  const venueLine = [
    announcement.venue.name,
    announcement.venue.city,
    announcement.venue.stateRegion ?? announcement.venue.country,
  ]
    .filter(Boolean)
    .join(', ');

  const support = announcement.support ?? [];
  const descLines: string[] = [];
  if (support.length) descLines.push(`With: ${support.join(', ')}`);
  if (announcement.onSaleDate) {
    descLines.push(`On sale: ${announcement.onSaleDate.toISOString()}`);
  }

  const { start, end } = defaultShowTime(announcement.showDate);

  const events: IcsEvent[] = [
    {
      uid: `announcement-${announcement.id}@showbook`,
      summary: `${announcement.headliner} @ ${announcement.venue.name}`,
      dtstart: start,
      dtend: end,
      location: venueLine,
      description: descLines.join('\n'),
    },
  ];

  if (announcement.onSaleDate) {
    const saleStart = new Date(announcement.onSaleDate);
    const saleEnd = new Date(saleStart.getTime() + 30 * 60 * 1000);
    events.push({
      uid: `announcement-onsale-${announcement.id}@showbook`,
      summary: `On sale: ${announcement.headliner} @ ${announcement.venue.name}`,
      dtstart: saleStart,
      dtend: saleEnd,
      description: `Tickets go on sale for ${announcement.headliner} at ${announcement.venue.name} on ${announcement.showDate}.`,
    });
  }

  const ics = buildIcs(events);
  const filename = `${slugifyForFilename(announcement.headliner)}-${announcement.showDate}.ics`;

  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
