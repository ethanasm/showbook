import { NextResponse, type NextRequest } from 'next/server';
import { testRouteGuard } from '../_guard';
import { workerEmail } from '../_worker';
import {
  db,
  eq,
  users,
  shows,
  showPerformers,
  announcements,
  userVenueFollows,
  userRegions,
  userPreferences,
} from '@showbook/db';

export async function GET(req: NextRequest) {
  const guardResponse = testRouteGuard();
  if (guardResponse) return guardResponse;

  const worker = req.nextUrl.searchParams.get('worker');
  const email = workerEmail(worker);

  try {
    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (!user) {
      return NextResponse.json({ ok: true, message: 'No test user found, nothing to clean' });
    }

    // Delete in FK order
    const userShows = await db.query.shows.findMany({
      where: eq(shows.userId, user.id),
    });

    for (const s of userShows) {
      await db.delete(showPerformers).where(eq(showPerformers.showId, s.id));
    }

    await db.delete(userVenueFollows).where(eq(userVenueFollows.userId, user.id));
    await db.delete(userRegions).where(eq(userRegions.userId, user.id));
    await db.delete(userPreferences).where(eq(userPreferences.userId, user.id));
    await db.delete(shows).where(eq(shows.userId, user.id));
    // Only the global / unworked path wipes announcements — they're shared
    // across worker users and are seeded once by globalSetup.
    if (worker == null) {
      await db.delete(announcements);
    }

    return NextResponse.json({ ok: true, message: 'Test data cleaned' });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
