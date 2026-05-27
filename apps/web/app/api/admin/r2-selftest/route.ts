/**
 * POST /api/admin/r2-selftest
 *
 * Server-side R2 diagnostic. Same bearer-auth shape as /api/admin/sql:
 *
 *   Authorization: Bearer <ADMIN_QUERY_TOKEN>
 *
 * Why this exists: mobile uploads have been stuck at the `put` step
 * with HTTP 403 from R2 for weeks, and the mobile-side telemetry that
 * was supposed to capture R2's XML error body never reached prod
 * (no `mobile.*` events in Axiom for 30+ days, so each "fix" has been
 * guessing without ever seeing what R2 actually said). This route
 * reproduces the failure from the server itself and returns R2's
 * response body verbatim so the next fix is informed.
 *
 * It runs three checks against the live R2 bucket:
 *   1. SDK round-trip — PUT a 10-byte object via the AWS SDK
 *      (`uploadToR2`), HEAD it, GET-read it, then DELETE. Isolates
 *      whether credentials + bucket + perms work at all.
 *   2. Presigned PUT — generate an upload URL via the exact same
 *      `getMediaUploadUrl` the `media.createUploadIntent` mutation
 *      uses, then `fetch` PUT a 10-byte body to that URL. Captures
 *      status + the first ~1 KB of R2's response. This is the
 *      step that's been silently failing.
 *   3. URL shape — returns the host, path, query keys, and signed
 *      headers from the generated URL (signature redacted) so the
 *      operator can spot a config drift (wrong bucket, wrong account)
 *      without leaking the signed credential.
 *
 * The route is `force-dynamic` + `nodejs` so the bearer check and the
 * AWS SDK both run on a real Node runtime. Nothing here is cached.
 *
 * The route deliberately does NOT use a real `media_assets` row — it
 * writes under `showbook/__selftest__/...` with a random UUID so a
 * stuck/aborted run never leaves orphan asset rows or competes with
 * real uploads.
 */

import { NextResponse } from 'next/server';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  deleteFromR2,
  getMediaConfig,
  getPresignedUploadUrl,
  headFromR2,
  isRateLimited,
  uploadToR2,
} from '@showbook/api';
import { child } from '@showbook/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = child({ component: 'web.admin.r2-selftest' });

const PUT_BODY = Buffer.from('selftest-x\n', 'utf8'); // 11 bytes
const PUT_CONTENT_TYPE = 'application/octet-stream';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
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

interface StepResult {
  ok: boolean;
  /** Optional short error string (Error.message or status text). */
  error?: string;
  /** Free-form result payload — varies by step. */
  data?: Record<string, unknown>;
  /** Wallclock milliseconds for the step. */
  elapsedMs: number;
}

async function sdkRoundTrip(key: string): Promise<StepResult> {
  const started = Date.now();
  try {
    await uploadToR2(key, PUT_BODY, PUT_CONTENT_TYPE);
    const head = await headFromR2(key);
    await deleteFromR2(key);
    return {
      ok: true,
      data: {
        head: { bytes: head.bytes, contentType: head.contentType },
      },
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    // The AWS SDK throws S3ServiceException with a useful Code/$metadata
    // shape — surface those fields so the operator can tell credentials
    // (AccessDenied) from missing bucket (NoSuchBucket) from clock skew
    // (RequestTimeTooSkewed) at a glance.
    const code =
      err && typeof err === 'object' && 'name' in err
        ? (err as { name?: string }).name
        : undefined;
    const httpStatus =
      err && typeof err === 'object' && '$metadata' in err
        ? (err as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode
        : undefined;
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      data: { code, httpStatus },
      elapsedMs: Date.now() - started,
    };
  }
}

async function presignedPut(key: string): Promise<StepResult> {
  const started = Date.now();
  let uploadUrl: string;
  try {
    // Probe the raw R2 presigning path — i.e. the one we just moved
    // production uploads OFF, but which we still want a live signal
    // for so we know whether direct-to-R2 starts working again.
    const config = getMediaConfig();
    uploadUrl = await getPresignedUploadUrl(
      key,
      PUT_CONTENT_TYPE,
      config.uploadUrlTtlSeconds,
    );
  } catch (err) {
    return {
      ok: false,
      error: `presign generate failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      elapsedMs: Date.now() - started,
    };
  }

  // Parse + redact for the response. The signature itself stays on the
  // server only; the operator gets the structural metadata they need to
  // spot a misconfig.
  const parsed = (() => {
    try {
      const u = new URL(uploadUrl);
      const queryKeys = [...u.searchParams.keys()].sort();
      const signedHeaders = u.searchParams.get('X-Amz-SignedHeaders');
      const expires = u.searchParams.get('X-Amz-Expires');
      const credential = u.searchParams.get('X-Amz-Credential');
      // Drop the access-key portion of credential (the part before the
      // first `/`). Scope (date/region/service) is safe to expose.
      const scope = credential ? credential.split('/').slice(1).join('/') : null;
      return {
        host: u.host,
        path: u.pathname,
        queryKeys,
        signedHeaders,
        expires,
        scope,
      };
    } catch {
      return { parse_failed: true };
    }
  })();

  let status: number;
  let bodyPreview: string;
  let respHeaders: Record<string, string>;
  try {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': PUT_CONTENT_TYPE },
      body: PUT_BODY,
    });
    status = res.status;
    respHeaders = Object.fromEntries(res.headers.entries());
    const text = await res.text();
    bodyPreview = text.length > 1024 ? `${text.slice(0, 1024)}…` : text;
  } catch (err) {
    return {
      ok: false,
      error: `fetch PUT failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      data: { url: parsed },
      elapsedMs: Date.now() - started,
    };
  }

  // Best-effort cleanup if the PUT succeeded.
  if (status >= 200 && status < 300) {
    try {
      await deleteFromR2(key);
    } catch (err) {
      log.warn(
        { event: 'admin.r2.selftest.cleanup_failed', err },
        'selftest cleanup failed',
      );
    }
  }

  return {
    ok: status >= 200 && status < 300,
    error: status >= 200 && status < 300 ? undefined : `HTTP ${status}`,
    data: {
      url: parsed,
      status,
      responseHeaders: respHeaders,
      bodyPreview,
    },
    elapsedMs: Date.now() - started,
  };
}

export async function POST(req: Request) {
  const expected = process.env.ADMIN_QUERY_TOKEN;
  if (!expected || expected.length < 32) {
    log.error(
      { event: 'admin.r2.selftest.config_error' },
      'ADMIN_QUERY_TOKEN unset or too short — endpoint disabled',
    );
    return unauthorized();
  }
  const authHeader = req.headers.get('authorization') ?? '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return unauthorized();
  if (!compareTokens(match[1].trim(), expected)) return unauthorized();

  // Cheap per-IP cap so a token leak can't burn through R2 ops or our
  // own outbound bandwidth.
  const ipKey = clientIpKey(req);
  if (
    isRateLimited(`admin.r2.selftest:${ipKey}`, {
      max: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_MS,
    })
  ) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'retry-after': '60' } },
    );
  }

  const config = getMediaConfig();
  if (config.storageMode !== 'r2') {
    return NextResponse.json(
      {
        error: 'not_applicable',
        details: `MEDIA_STORAGE_MODE=${config.storageMode} (only 'r2' has a remote to test)`,
      },
      { status: 422 },
    );
  }

  const runId = randomUUID();
  const sdkKey = `showbook/__selftest__/${runId}/sdk.bin`;
  const presignKey = `showbook/__selftest__/${runId}/presign.bin`;

  log.info(
    { event: 'admin.r2.selftest.start', runId, ipKey },
    'R2 selftest started',
  );

  // Run the two checks in sequence so a credentials failure in the SDK
  // path is obvious before we try to interpret a presign failure.
  const sdk = await sdkRoundTrip(sdkKey);
  const presign = await presignedPut(presignKey);

  const env = {
    accountIdSet: Boolean(process.env.R2_ACCOUNT_ID),
    accessKeyIdSet: Boolean(process.env.R2_ACCESS_KEY_ID),
    secretAccessKeySet: Boolean(process.env.R2_SECRET_ACCESS_KEY),
    bucketName: process.env.R2_BUCKET_NAME ?? '(unset → defaults to "showbook")',
    publicUrlSet: Boolean(process.env.R2_PUBLIC_URL),
    storageMode: config.storageMode,
  };

  log.info(
    {
      event: 'admin.r2.selftest.complete',
      runId,
      sdkOk: sdk.ok,
      presignOk: presign.ok,
      presignStatus:
        presign.data && 'status' in presign.data ? presign.data.status : null,
    },
    'R2 selftest complete',
  );

  return NextResponse.json({
    runId,
    env,
    sdk,
    presign,
  });
}
