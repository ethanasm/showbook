import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@showbook/db';
import { getBossState } from '@showbook/jobs';
import { child } from '@showbook/observability';

const log = child({ component: 'api.health.ready' });

/**
 * Readiness probe. Returns 200 iff the process can serve traffic that
 * touches its dependencies, 503 otherwise.
 *
 * Today we check:
 *   1. Postgres responds to `SELECT 1` within a short window.
 *   2. pg-boss is in `started` state (`startBoss()` resolved and
 *      `stopBoss()` hasn't been called yet — boot finished, shutdown
 *      hasn't started).
 *
 * Distinct from `/api/health/live` — that one is process-only.
 * Container orchestrators (and the docker-compose `healthcheck:`)
 * should poll live during boot/shutdown and ready for traffic routing.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DB_PROBE_TIMEOUT_MS = 2000;

async function probeDatabase(): Promise<{ ok: boolean; error?: string }> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error('db_probe_timeout')),
      DB_PROBE_TIMEOUT_MS,
    ),
  );
  try {
    await Promise.race([db.execute(sql`SELECT 1`), timeout]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(): Promise<NextResponse> {
  const dbResult = await probeDatabase();
  const bossState = getBossState();
  const ready = dbResult.ok && bossState === 'started';
  if (!ready) {
    log.warn(
      {
        event: 'health.ready.failed',
        db: dbResult.ok ? 'ok' : 'fail',
        dbError: dbResult.error,
        boss: bossState,
      },
      'Readiness probe failed',
    );
  }
  return NextResponse.json(
    {
      status: ready ? 'ok' : 'unavailable',
      checks: {
        db: dbResult.ok ? 'ok' : 'fail',
        boss: bossState,
      },
    },
    { status: ready ? 200 : 503 },
  );
}
