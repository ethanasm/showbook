/**
 * Test-only helper: look up a show id by (productionName, state) for the
 * test user, so Playwright tests can navigate to /shows/<id> deterministically.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, shows, users, eq, and } from '@showbook/db';

const TEST_EMAIL = 'test@showbook.dev';

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }
  const productionName = req.nextUrl.searchParams.get('productionName');
  const state = req.nextUrl.searchParams.get('state');
  if (!productionName || !state) {
    return NextResponse.json({ error: 'productionName and state required' }, { status: 400 });
  }
  const user = await db.query.users.findFirst({ where: eq(users.email, TEST_EMAIL) });
  if (!user) return NextResponse.json({ error: 'No test user' }, { status: 404 });

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
