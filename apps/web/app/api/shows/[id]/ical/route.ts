import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db, shows, eq, and } from '@showbook/db';
import { buildIcs, defaultShowTime, slugifyForFilename } from '@showbook/shared';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  const { id } = await params;

  const show = await db.query.shows.findFirst({
    where: and(eq(shows.id, id), eq(shows.userId, session.user.id)),
    with: {
      venue: true,
      showPerformers: { with: { performer: true } },
    },
  });

  if (!show) return new NextResponse('Not Found', { status: 404 });

  // Watching shows from a multi-night run can have no committed date yet —
  // there's nothing to put on the calendar until the user picks one.
  if (!show.date) {
    return new NextResponse(
      'No calendar export available — pick a date for this show first.',
      { status: 409 },
    );
  }

  const headlinerSP =
    show.showPerformers.find(
      (sp) => sp.role === 'headliner' && sp.sortOrder === 0,
    ) ?? show.showPerformers.find((sp) => sp.role === 'headliner');
  const isTheatreLike = show.kind === 'theatre' || show.kind === 'festival';
  const title =
    (isTheatreLike && show.productionName) ||
    headlinerSP?.performer.name ||
    'Show';

  const venueLine = [
    show.venue.name,
    show.venue.city,
    show.venue.stateRegion ?? show.venue.country,
  ]
    .filter(Boolean)
    .join(', ');

  const supportNames = show.showPerformers
    .filter((sp) => sp.role === 'support')
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((sp) => sp.performer.name);

  const descLines: string[] = [];
  if (show.tourName) descLines.push(`Tour: ${show.tourName}`);
  if (supportNames.length) descLines.push(`With: ${supportNames.join(', ')}`);
  if (show.seat) descLines.push(`Seat: ${show.seat}`);

  const { start, end } = defaultShowTime(show.date);

  const ics = buildIcs([
    {
      uid: `show-${show.id}@showbook`,
      summary: `${title} @ ${show.venue.name}`,
      dtstart: start,
      dtend: end,
      location: venueLine,
      description: descLines.join('\n'),
    },
  ]);

  const filename = `${slugifyForFilename(title)}-${show.date}.ics`;

  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
