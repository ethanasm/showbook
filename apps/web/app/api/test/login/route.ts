import { NextResponse, type NextRequest } from 'next/server';
import { encode } from 'next-auth/jwt';
import { db, users, eq } from '@showbook/db';
import { testRouteGuard } from '../_guard';
import { workerEmail, workerName } from '../_worker';

export async function GET(req: NextRequest) {
  const guardResponse = testRouteGuard();
  if (guardResponse) return guardResponse;

  const worker = req.nextUrl.searchParams.get('worker');
  const email =
    req.nextUrl.searchParams.get('email') ?? workerEmail(worker);
  const name =
    req.nextUrl.searchParams.get('name') ?? workerName(worker);

  let user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (!user) {
    const [created] = await db.insert(users).values({
      email,
      name,
    }).returning();
    user = created!;
  }

  const baseUrl = process.env.NEXTAUTH_URL || 'https://localhost:3001';
  const isSecure = baseUrl.startsWith('https');
  const cookieName = isSecure ? '__Secure-authjs.session-token' : 'authjs.session-token';

  const token = await encode({
    token: {
      sub: user.id,
      id: user.id,
      name: user.name,
      email: user.email,
    },
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? '',
    salt: cookieName,
  });

  const response = NextResponse.redirect(new URL('/home', baseUrl));

  response.cookies.set(cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: isSecure,
  });

  return response;
}
