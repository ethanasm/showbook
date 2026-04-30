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
  // Test routes require BOTH the explicit opt-in flag AND the e2e database
  // — the DB-name check is what makes it safe to allow even when
  // NODE_ENV=production (E2E in CI runs against `next start`, which
  // forces NODE_ENV=production). A real production deploy would never
  // be pointed at showbook_e2e, so these two checks together prevent
  // accidental exposure of seed/login routes.
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
