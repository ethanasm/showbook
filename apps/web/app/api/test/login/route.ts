import { NextResponse } from 'next/server';
import { encode } from 'next-auth/jwt';
import { db, users, eq } from '@showbook/db';

const TEST_USER = {
  email: 'test@showbook.dev',
  name: 'Test User',
};

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  let user = await db.query.users.findFirst({
    where: eq(users.email, TEST_USER.email),
  });

  if (!user) {
    const [created] = await db.insert(users).values({
      email: TEST_USER.email,
      name: TEST_USER.name,
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
