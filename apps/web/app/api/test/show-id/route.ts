/**
 * Test-only helper: look up a show id by (productionName, state) for the
 * test user, so Playwright tests can navigate to /shows/<id> deterministically.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, shows, showPerformers, performers, venues, users, eq, and } from '@showbook/db';

const TEST_EMAIL = 'test@showbook.dev';

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }
  const productionName = req.nextUrl.searchParams.get('productionName');
  const state = req.nextUrl.searchParams.get('state');
  const headliner = req.nextUrl.searchParams.get('headliner');
  const venueName = req.nextUrl.searchParams.get('venueName');

  const user = await db.query.users.findFirst({ where: eq(users.email, TEST_EMAIL) });
  if (!user) return NextResponse.json({ error: 'No test user' }, { status: 404 });

  // Lookup by productionName + state (theatre / festival).
  if (productionName && state) {
    const [row] = await db
      .select({ id: shows.id })
      .from(shows)
      .where(
        and(
          eq(shows.userId, user.id),
          eq(shows.productionName, productionName),
          eq(shows.state, state as 'past' | 'ticketed' | 'watching'),
        ),
      )
      .limit(1);
    return NextResponse.json({ id: row?.id ?? null });
  }

  // Lookup by headliner + venueName (+ optional state) — for concerts/comedy
  // where productionName is null. Picks any matching show if multiple exist.
  if (headliner && venueName) {
    const conditions = [eq(shows.userId, user.id), eq(venues.name, venueName), eq(performers.name, headliner)];
    if (state) conditions.push(eq(shows.state, state as 'past' | 'ticketed' | 'watching'));
    const [row] = await db
      .select({ id: shows.id })
      .from(shows)
      .innerJoin(venues, eq(shows.venueId, venues.id))
      .innerJoin(showPerformers, eq(showPerformers.showId, shows.id))
      .innerJoin(performers, eq(performers.id, showPerformers.performerId))
      .where(and(...conditions))
      .limit(1);
    return NextResponse.json({ id: row?.id ?? null });
  }

  return NextResponse.json(
    { error: 'Provide productionName+state OR headliner+venueName' },
    { status: 400 },
  );
}
