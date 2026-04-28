import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db, announcements, eq } from '@showbook/db';
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
  const { id } = await params;

  const announcement = await db.query.announcements.findFirst({
    where: eq(announcements.id, id),
    with: { venue: true },
  });

  if (!announcement) return new NextResponse('Not Found', { status: 404 });

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
