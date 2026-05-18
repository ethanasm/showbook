import { NextResponse } from 'next/server';

/**
 * Liveness probe. Returns 200 unconditionally once the Next.js process
 * is accepting requests — by definition any successful HTTP response
 * means the process is alive.
 *
 * Distinct from `/api/health/ready` (which gates on dependencies). Use
 * this in container orchestration to detect "process is hung / has
 * crashed" — never wire it to dependency checks, or a transient DB
 * blip will trigger a container restart that doesn't help.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(): NextResponse {
  return NextResponse.json({ status: 'ok' }, { status: 200 });
}
