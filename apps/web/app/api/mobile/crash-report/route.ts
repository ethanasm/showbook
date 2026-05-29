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
 * no DB write, no rate-limit (showbook is single-tenant — we'll add one
 * if abuse becomes a problem). Drops empty / malformed payloads with
 * 400 silently.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { child } from '@showbook/observability';

const log = child({ component: 'web.api.mobile.crash-report' });

const MAX_MESSAGE_LEN = 2000;
const MAX_STACK_LEN = 8000;

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
