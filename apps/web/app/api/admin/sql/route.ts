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
 *   { "query": "SELECT * FROM shows WHERE id = $1", "params": ["abc"] }
 *
 * `params` is optional and binds `$1`-style placeholders. It exists so
 * programmatic clients (mcp-queue-doctor talks to this endpoint instead of
 * requiring a Postgres route into the box) don't have to inline their own
 * literals to use it. Accepted values are JSON scalars and one-level arrays
 * of strings/numbers/nulls (for `= any($1)`) — see `validateAdminParams` in
 * lib/admin-query.ts for why booleans inside arrays are refused.
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
 *   413 { error: 'bad_request', details }     body over MAX_BODY_BYTES
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
 *   7. Body-size cap, drained rather than buffered, so a large upload
 *      can't be forced into process memory before any check runs.
 *   8. Extended query protocol pinned, so the wire format itself cannot
 *      carry a second command.
 */

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import postgres from 'postgres';
import { child } from '@showbook/observability';
import { isRateLimited } from '@showbook/api';
import {
  EXTENDED_PROTOCOL_ONLY,
  MAX_BODY_BYTES,
  validateAdminParams,
  validateAdminQuery,
} from '@/lib/admin-query';
import { drainCapped } from '@/lib/drain-capped';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = child({ component: 'web.admin.sql' });

const MAX_ROWS = 1000;
// Kept tight so a single expensive query (e.g. a heavy aggregate) can't pin
// a backend for long; diagnostic SELECTs return well under this.
const STATEMENT_TIMEOUT_MS = 3000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

/**
 * Lazily create (and cache) a small dedicated postgres-js pool for the
 * admin SQL endpoint.
 *
 * Connection string resolution:
 *   - Prefer `ADMIN_QUERY_DATABASE_URL` so prod can point this endpoint at a
 *     dedicated read-only role (`showbook_query`, created by migration 0027).
 *     That role has SELECT on public tables only, with explicit REVOKE on
 *     `accounts`, `sessions`, `verification_tokens` — so a leaked
 *     `ADMIN_QUERY_TOKEN` cannot exfiltrate OAuth refresh tokens or session
 *     material even within the BEGIN READ ONLY transaction.
 *   - Fall back to `DATABASE_URL` so dev / CI / pre-rollout prod keeps
 *     working without the dedicated role.
 *
 * Why a separate pool instead of reusing `db` from `@showbook/db`:
 *   - Drizzle's `db` is for ORM-shaped queries; we need `sql.unsafe(text)`
 *     and `sql.begin('READ ONLY', ...)` which want a raw client.
 *   - A cap of 2 connections caps the blast radius of a leaked token;
 *     even with cheap queries you can't open more than 2 backends.
 */
let _client: ReturnType<typeof postgres> | null = null;
function getClient(): ReturnType<typeof postgres> {
  if (_client) return _client;
  const connectionString =
    process.env.ADMIN_QUERY_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'ADMIN_QUERY_DATABASE_URL or DATABASE_URL must be set to use /api/admin/sql',
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
  // Read the body with a hard ceiling rather than `req.json()`, which buffers
  // the whole stream before any check can run. Content-Length is not a
  // defence (absent when chunked, and a client can understate it) and App
  // Router applies no limit of its own, so without this an authenticated
  // caller could force an arbitrarily large body into process memory. The
  // per-field caps below bound what Postgres sees; this bounds what Node holds.
  const drained = await drainCapped(req.body, MAX_BODY_BYTES);
  if (drained.overflowed) {
    log.warn(
      { event: 'admin.sql.body_too_large', ipKey },
      'admin SQL body exceeded the size cap',
    );
    return NextResponse.json(
      { error: 'bad_request', details: `body exceeds ${MAX_BODY_BYTES} bytes` },
      { status: 413 },
    );
  }
  if (drained.readFailed !== null) {
    return NextResponse.json(
      { error: 'bad_request', details: 'could not read request body' },
      { status: 400 },
    );
  }

  let rawQuery: unknown;
  let rawParams: unknown;
  try {
    const body = JSON.parse(drained.body.toString('utf8')) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { error: 'bad_request', details: 'body must be a JSON object' },
        { status: 400 },
      );
    }
    rawQuery = body.query;
    rawParams = body.params;
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

  const paramsValidation = validateAdminParams(rawParams);
  if (!paramsValidation.ok) {
    return NextResponse.json(
      { error: 'query_rejected', details: paramsValidation.reason },
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
      // Passing params here (rather than letting a caller inline literals)
      // means bound values are never parsed as part of the statement.
      // EXTENDED_PROTOCOL_ONLY makes multi-command impossible at the
      // protocol level; see its definition for why that is not redundant
      // with the multi-statement text check.
      const result = await tx.unsafe(
        validation.query,
        paramsValidation.params,
        EXTENDED_PROTOCOL_ONLY,
      );
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
    const details =
      err instanceof Error ? err.message : 'unknown postgres error';
    // A malformed statement or an un-bindable parameter is the caller's
    // mistake, not ours, so it belongs with the other 422s rather than looking
    // like the server fell over. 42601 syntax_error, 42P18 indeterminate
    // datatype, 42804 datatype_mismatch, 22P02 invalid_text_representation,
    // 08P01 protocol_violation (too few/many bind values).
    if (
      code === '42601' ||
      code === '42P18' ||
      code === '42804' ||
      code === '22P02' ||
      code === '08P01'
    ) {
      log.warn(
        { event: 'admin.sql.query_rejected', code, elapsedMs },
        'admin SQL endpoint rejected a malformed query or parameter',
      );
      return NextResponse.json(
        { error: 'query_rejected', details },
        { status: 422 },
      );
    }
    // Deliberately not logging `err`: a Postgres error message can quote the
    // offending bind value, and CLAUDE.md's "never log raw user PII" rule
    // applies to operator tooling too — the same reason this route logs query
    // *length* and never the SQL. SQLSTATE is the triage field that matters;
    // the full message still reaches the authenticated caller in the response,
    // which is not the same channel as the log. The message is safe to log
    // only when no parameters were supplied.
    log.error(
      {
        event: 'admin.sql.error',
        code,
        elapsedMs,
        errName: err instanceof Error ? err.name : 'unknown',
        paramCount: paramsValidation.params.length,
        ...(paramsValidation.params.length === 0 ? { detail: details } : {}),
      },
      'admin SQL query failed',
    );
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
