import { NextResponse } from 'next/server';

export async function GET() {
  // In development, create a test session
  // This will be properly implemented when we have the full auth flow
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  // For now, redirect to home - actual test auth will be set up later
  return NextResponse.redirect(new URL('/home', process.env.NEXTAUTH_URL || 'https://localhost:3001'));
}
