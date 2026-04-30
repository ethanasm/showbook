import { NextResponse } from 'next/server';

const expectedDatabaseName = process.env.TEST_DATABASE_NAME ?? 'showbook_e2e';

function currentDatabaseName() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;

  try {
    const parsed = new URL(databaseUrl);
    return parsed.pathname.replace(/^\//, '') || null;
  } catch {
    return null;
  }
}

export function testRouteGuard() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  if (process.env.ENABLE_TEST_ROUTES !== '1') {
    return NextResponse.json({ error: 'Test routes are disabled' }, { status: 403 });
  }

  const dbName = currentDatabaseName();
  if (dbName !== expectedDatabaseName) {
    return NextResponse.json(
      { error: `Test routes require ${expectedDatabaseName}` },
      { status: 403 },
    );
  }

  return null;
}
