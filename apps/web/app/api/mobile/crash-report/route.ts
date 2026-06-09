/**
 * Mobile crash-report endpoint.
 *
 * Public (no auth) by design: the whole point of this endpoint is to
 * capture crashes that fire BEFORE the app gets far enough to mint a
 * bearer token. The existing tRPC `telemetry.logEvent` procedure would
 * be ideal except that it needs the tRPC client to be wired up — which
 * happens inside the React tree, after the providers mount. A
 * top-of-file uncaught error at boot never makes it that far. So this
 * is a flat HTTP POST instead, callable via raw `fetch()` before any
 * provider chain renders.
 *
 * Logs to Axiom under `mobile.crash.uncaught` via the shared
 * observability package. Mirrors the input shape the mobile-side
 * `crash-reporter.ts` posts.
 *
 * Anti-abuse: hard cap on each field (rejection rather than truncation,
 * so a runaway client doesn't push us toward the 257-column Axiom cap),
 * a per-IP rate limit so an unauthenticated flood can't spam the log
 * pipeline, no DB write. Drops empty / malformed payloads with 400
 * silently and over-limit callers with 429.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { child } from '@showbook/observability';
import { isRateLimited } from '@showbook/api';

const log = child({ component: 'web.api.mobile.crash-report' });

const MAX_MESSAGE_LEN = 2000;
const MAX_STACK_LEN = 8000;
const RATE_LIMIT = { max: 60, windowMs: 60_000 };

/** Best-effort client IP for rate-limiting this unauthenticated endpoint. */
function clientIp(req: Request): string {
  const h = req.headers;
  const direct = h.get('cf-connecting-ip') ?? h.get('x-real-ip');
  if (direct) return direct;
  const first = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return first || 'anonymous';
}

const schema = z.object({
  message: z.string().min(1).max(MAX_MESSAGE_LEN),
  stack: z.string().max(MAX_STACK_LEN).optional(),
  isFatal: z.boolean().optional(),
  platform: z.enum(['ios', 'android', 'web']).optional(),
  version: z.string().max(40).optional(),
  buildNumber: z.string().max(40).optional(),
  errorName: z.string().max(120).optional(),
  source: z.enum(['uncaught', 'unhandled_rejection']).optional(),
});

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (isRateLimited(`crash-report:${clientIp(req)}`, RATE_LIMIT)) {
    return NextResponse.json(
      { ok: false },
      { status: 429, headers: { 'retry-after': '60' } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const { message, stack, isFatal, platform, version, buildNumber, errorName, source } =
    parsed.data;
  log.error(
    {
      event: 'mobile.crash.uncaught',
      errorName,
      isFatal,
      platform,
      version,
      buildNumber,
      source,
      stack,
    },
    message,
  );
  return NextResponse.json({ ok: true }, { status: 200 });
}
