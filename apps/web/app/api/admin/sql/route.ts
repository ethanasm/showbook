/**
 * POST /api/admin/sql
 *
 * Read-only diagnostic SQL endpoint for the operator (and Claude Code on
 * the web). Lets a holder of `ADMIN_QUERY_TOKEN` run arbitrary SELECT
 * queries against the prod database without exposing Postgres on the LAN
 * or shipping a separate `psql` tunnel.
 *
 * Request:
 *   Authorization: Bearer <ADMIN_QUERY_TOKEN>
 *   Content-Type: application/json
 *   { "query": "SELECT count(*) FROM shows" }
 *
 * Response 200:
 *   {
 *     "rows":     [...],            // up to MAX_ROWS, then truncated
 *     "rowCount": <int>,            // rows.length
 *     "truncated": <bool>,
 *     "elapsedMs": <int>
 *   }
 *
 * Errors:
 *   401 { error: 'unauthorized' }   missing/bad bearer token, or token unset on server
 *   400 { error: 'bad_request', details }
 *   422 { error: 'query_rejected', details }   prefix guard refused the SQL
 *   500 { error: 'server_error', details? }
 *   504 { error: 'timeout' }        statement_timeout fired
 *
 * Defense in depth (deepest-first):
 *   1. Bearer token (timing-safe compare against `ADMIN_QUERY_TOKEN`).
 *   2. Postgres `BEGIN READ ONLY` transaction wrapping every query —
 *      the engine itself rejects writes with `cannot execute <op> in
 *      a read-only transaction`. This is the security boundary.
 *   3. Per-statement `statement_timeout` so a runaway query can't pin
 *      a backend forever.
 *   4. Prefix allowlist (lib/admin-query.ts) for friendly early
 *      rejection of non-SELECT verbs — courtesy, not security.
 *   5. Row cap (MAX_ROWS) so a `SELECT *` from a huge table doesn't
 *      exhaust web-process memory.
 *   6. Per-IP rate limit so a leaked token can't be used to DoS the
 *      database with cheap-but-numerous queries.
 */

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import postgres from 'postgres';
import { child } from '@showbook/observability';
import { isRateLimited } from '@showbook/api';
import { validateAdminQuery } from '@/lib/admin-query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = child({ component: 'web.admin.sql' });

const MAX_ROWS = 1000;
const STATEMENT_TIMEOUT_MS = 5000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

/**
 * Lazily create (and cache) a small dedicated postgres-js pool for the
 * admin SQL endpoint.
 *
 * Why a separate pool instead of reusing `db` from `@showbook/db`:
 *   - Drizzle's `db` is for ORM-shaped queries; we need `sql.unsafe(text)`
 *     and `sql.begin('READ ONLY', ...)` which want a raw client.
 *   - A cap of 2 connections caps the blast radius of a leaked token;
 *     even with cheap queries you can't open more than 2 backends.
 *   - We can wire a different connection string later
 *     (e.g. a `showbook_readonly` Postgres role) without touching the
 *     ORM client.
 */
let _client: ReturnType<typeof postgres> | null = null;
function getClient(): ReturnType<typeof postgres> {
  if (_client) return _client;
  const connectionString =
    process.env.ADMIN_QUERY_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'ADMIN_QUERY_DATABASE_URL (or DATABASE_URL) must be set to use /api/admin/sql',
    );
  }
  _client = postgres(connectionString, { max: 2, idle_timeout: 20 });
  return _client;
}

function compareTokens(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function clientIpKey(req: Request): string {
  const headers = req.headers;
  const cf =
    headers.get('cf-connecting-ip') ?? headers.get('x-real-ip') ?? '';
  if (cf) return cf;
  const fwd = headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'anonymous';
}

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export async function POST(req: Request) {
  // 1. Bearer-token gate.
  const expected = process.env.ADMIN_QUERY_TOKEN;
  if (!expected || expected.length < 32) {
    log.error(
      { event: 'admin.sql.config_error' },
      'ADMIN_QUERY_TOKEN unset or too short — endpoint disabled',
    );
    return unauthorized();
  }
  const authHeader = req.headers.get('authorization') ?? '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return unauthorized();
  if (!compareTokens(match[1].trim(), expected)) return unauthorized();

  // 2. Per-IP rate limit (after auth so we don't waste cycles before
  // checking the token, but before query parsing/execution).
  const ipKey = clientIpKey(req);
  if (
    isRateLimited(`admin.sql:${ipKey}`, {
      max: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_MS,
    })
  ) {
    log.warn(
      { event: 'admin.sql.rate_limited', ipKey },
      'admin SQL endpoint rate-limited',
    );
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'retry-after': '60' } },
    );
  }

  // 3. Parse + validate request body.
  let rawQuery: unknown;
  try {
    const body = (await req.json()) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'bad_request', details: 'body must be a JSON object' },
        { status: 400 },
      );
    }
    rawQuery = body.query;
  } catch {
    return NextResponse.json(
      { error: 'bad_request', details: 'invalid JSON body' },
      { status: 400 },
    );
  }

  const validation = validateAdminQuery(rawQuery);
  if (!validation.ok) {
    return NextResponse.json(
      { error: 'query_rejected', details: validation.reason },
      { status: 422 },
    );
  }

  // 4. Run the query inside a READ ONLY transaction with a statement
  //    timeout. postgres-js's `.begin('READ ONLY', cb)` opens a
  //    transaction with that mode flag; any write attempt errors with
  //    SQLSTATE 25006 ("read_only_sql_transaction").
  const started = Date.now();
  let rows: unknown[];
  try {
    const sql = getClient();
    rows = (await sql.begin('READ ONLY', async (tx) => {
      await tx.unsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      // postgres-js returns row arrays from .unsafe; cast to a plain array.
      const result = await tx.unsafe(validation.query);
      return result as unknown as unknown[];
    })) as unknown as unknown[];
  } catch (err) {
    const elapsedMs = Date.now() - started;
    // postgres-js's PostgresError carries `.code` (SQLSTATE). It's not
    // exported as a class type, so detect by shape rather than instanceof.
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code?: string }).code
        : undefined;
    // 25006 = read_only_sql_transaction, 42501 = insufficient_privilege —
    // either way the client tried to write. 57014 = query_canceled (timeout).
    if (code === '57014') {
      log.warn(
        { event: 'admin.sql.timeout', elapsedMs },
        'admin SQL query exceeded statement_timeout',
      );
      return NextResponse.json({ error: 'timeout' }, { status: 504 });
    }
    if (code === '25006' || code === '42501') {
      log.warn(
        { event: 'admin.sql.write_attempted', code, elapsedMs },
        'admin SQL endpoint blocked a write attempt',
      );
      return NextResponse.json(
        {
          error: 'query_rejected',
          details: 'write operations are not allowed (read-only endpoint)',
        },
        { status: 422 },
      );
    }
    log.error(
      { event: 'admin.sql.error', code, elapsedMs, err },
      'admin SQL query failed',
    );
    const details =
      err instanceof Error ? err.message : 'unknown postgres error';
    return NextResponse.json(
      { error: 'server_error', details },
      { status: 500 },
    );
  }

  const elapsedMs = Date.now() - started;
  const truncated = rows.length > MAX_ROWS;
  const out = truncated ? rows.slice(0, MAX_ROWS) : rows;

  // Log query *length*, not the SQL itself — diagnostic queries are not
  // PII, but they may reference user identifiers in WHERE clauses, and
  // CLAUDE.md's "never log raw user PII" rule applies even for operator
  // tooling. Length + elapsedMs is enough to spot-check abuse in Axiom.
  log.info(
    {
      event: 'admin.sql.query',
      ipKey,
      queryLength: validation.query.length,
      rowCount: out.length,
      truncated,
      elapsedMs,
    },
    'admin SQL query executed',
  );

  return NextResponse.json({
    rows: out,
    rowCount: out.length,
    truncated,
    elapsedMs,
  });
}
