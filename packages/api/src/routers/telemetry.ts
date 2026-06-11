import { z } from 'zod';
import { child } from '@showbook/observability';
import { router, publicProcedure } from '../trpc';
import { isRateLimited } from '../rate-limit';

const log = child({ component: 'mobile.telemetry' });

/**
 * Mobile client-side telemetry sink.
 *
 * The mobile app has no direct path to Axiom — RN can't ship pino logs.
 * Whenever the client catches an event worth recording — lifecycle
 * markers (`upload.start`, `upload.success`), failures (`upload.put.failed`,
 * `trpc.error`), unhandled screen exceptions, etc. — it fires `logEvent`
 * so the entry shows up alongside the server logs under the
 * `mobile.<event>` namespace. `level` (`warn`/`error`) distinguishes
 * informational markers from actual failures.
 *
 * `publicProcedure`, **not** protected — the original PR #301 gated this
 * on auth, which silently dropped the most useful class of failure:
 * anything that happens before the bearer token is valid (sign-in
 * failures, expired tokens, the very 401s we'd most want to know about).
 * Without auth here, telemetry works in those windows too. We log the
 * caller's session if one exists, so authed reports still carry a userId.
 *
 * Keep the input narrow: a short event name, a short message, and a
 * bounded context bag. Big payloads (raw response bodies, stack traces)
 * are clipped so a chatty client can't blow up our Axiom budget — the
 * caller is responsible for trimming before sending, but we cap on the
 * server too.
 */
const MAX_MESSAGE_LEN = 2000;
const MAX_CONTEXT_BYTES = 8 * 1024;

// Per-IP rate limit. This endpoint is `publicProcedure` (unauthenticated by
// design — pre-sign-in failures must still reach Axiom), so without a cap a
// scripted client could flood the log pipeline. Generous enough that real
// device telemetry never trips it.
const RATE_LIMIT = { max: 120, windowMs: 60_000 };

/**
 * Allowlist of context keys that may be promoted to top-level log fields.
 *
 * The context bag is spread into the structured log payload. Any key that
 * isn't in `CORE_FIELDS` (see `packages/observability/src/logger.ts`) folds
 * into the Axiom `fields` map field before ingest, so an unauthenticated
 * caller sending arbitrary keys can no longer exhaust the dataset's column
 * cap. We still drop any key not on this curated list, for query ergonomics
 * (a stable, documented field surface) and to limit the unauthenticated abuse
 * surface — keep it in sync with the keys the mobile client actually emits
 * (`apps/mobile/lib/**`) plus the canonical shared keys. NEVER add `event` or
 * `userId` here — those are set server-side and must not be spoofable from
 * the client.
 */
const ALLOWED_CONTEXT_KEYS = new Set<string>([
  'status',
  'httpStatus',
  'code',
  'errCode',
  'key',
  'stage',
  'showId',
  'assetId',
  'spotifyTrackId',
  'path',
  'type',
  'targetIndex',
  'elapsedMs',
  'bytes',
  'host',
  'jobId',
  // clip markers emitted below
  '_clipped',
  '_previewBytes',
  '_preview',
  '_droppedKeys',
]);

function sanitizeContext(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!context) return undefined;

  // Drop unknown keys so the Axiom field surface stays bounded and stable.
  const picked: Record<string, unknown> = {};
  let droppedKeys = 0;
  for (const [k, v] of Object.entries(context)) {
    if (ALLOWED_CONTEXT_KEYS.has(k)) picked[k] = v;
    else droppedKeys += 1;
  }
  if (droppedKeys > 0) picked._droppedKeys = droppedKeys;

  // Byte-cap the surviving payload so a single huge allowlisted value can't
  // bloat a log line.
  const serialised = JSON.stringify(picked);
  if (serialised.length > MAX_CONTEXT_BYTES) {
    return {
      _clipped: true,
      _previewBytes: serialised.length,
      _preview: serialised.slice(0, MAX_CONTEXT_BYTES),
    };
  }
  return picked;
}

export const telemetryRouter = router({
  logEvent: publicProcedure
    .input(
      z.object({
        event: z.string().min(1).max(80),
        message: z.string().min(1).max(MAX_MESSAGE_LEN),
        level: z.enum(['warn', 'error']).default('error'),
        context: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const userId = ctx.session?.user.id ?? null;

      // Silently drop over-limit reports — telemetry is fire-and-forget, so
      // throwing TOO_MANY_REQUESTS would only generate more error noise.
      const rateKey = userId ?? ctx.ip ?? 'anonymous';
      if (isRateLimited(`telemetry:${rateKey}`, RATE_LIMIT)) {
        return { ok: true };
      }

      const safe = sanitizeContext(input.context);
      // Spread caller context FIRST so the server-controlled `event`/`userId`
      // win — a malicious client must not be able to forge either via the
      // context bag (they're also excluded from ALLOWED_CONTEXT_KEYS).
      const payload = {
        ...(safe ?? {}),
        event: `mobile.${input.event}`,
        userId,
      };
      if (input.level === 'warn') {
        log.warn(payload, input.message);
      } else {
        log.error(payload, input.message);
      }
      return { ok: true };
    }),
});
