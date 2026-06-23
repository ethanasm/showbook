/**
 * Retry + transient-error classification for the mobile tRPC client.
 *
 * Background: a brief edge/connectivity blip — Cloudflare returning an HTML
 * error page, or the cellular connection dropping mid-request — makes a
 * burst of unrelated tRPC reads fail at the same instant. Before this
 * module those failures both
 *   (a) surfaced to the user (toasts / empty states / "couldn't load"), and
 *   (b) were logged at `level: 'error'`, inflating the `error_volume`
 *       health gauge with non-actionable noise (the 2026-06-22 single-user
 *       burst of 19 `mobile.trpc.error`s was exactly this — one flaky
 *       session across ~13 different procedures, no server-side fault).
 *
 * The fix lives here so retry and telemetry agree on one definition of
 * "transient":
 *   - Queries retry transient failures a few times with capped backoff, so
 *     a sub-few-second blip is invisible to the user (it recovers on its
 *     own instead of showing an error).
 *   - The error reporter demotes transient failures to `warn` — mirroring
 *     the server-side `*.request.retry` convention — and reserves `error`
 *     for genuine, non-recoverable failures.
 *
 * A failure is "transient" when it's a transport/edge failure with no valid
 * tRPC response (no `httpStatus` — connection lost, DNS/TLS reset, or an
 * HTML error page that failed to JSON-parse), or an HTTP 5xx / 408 / 425 /
 * 429. Real client-side rejections (other 4xx: UNAUTHORIZED, FORBIDDEN,
 * NOT_FOUND, BAD_REQUEST, …) are NOT transient — retrying them only burns
 * time, and they're worth an `error`-level log.
 *
 * This mirrors the outbox's `classifyError` (`lib/network.ts`, "status 0 or
 * >= 500") and the server's `transient-fetch.ts`, keeping one consistent
 * notion of a retryable transport failure across the codebase.
 */

/** Retryable HTTP statuses where the server *did* respond but a retry can still clear it. */
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Max retry *attempts* for a transient query failure, on top of the initial
 * try (so up to 4 total). With `trpcRetryDelay` that's ~0.5s + 1s + 2s of
 * backoff before giving up — enough to ride out a multi-second edge blip
 * without making a genuinely-down request feel sluggish.
 */
export const MAX_QUERY_RETRIES = 3;

/** Extract a numeric tRPC `data.httpStatus`, or undefined when none reached the client. */
function httpStatusOf(err: unknown): number | undefined {
  const status = (err as { data?: { httpStatus?: unknown } } | null | undefined)?.data
    ?.httpStatus;
  return typeof status === 'number' ? status : undefined;
}

/**
 * True when a tRPC client error is a transient transport/edge failure or a
 * retryable HTTP status. See the module header for the exact rule.
 */
export function isTransientTrpcError(err: unknown): boolean {
  const status = httpStatusOf(err);
  // No httpStatus → no decodable tRPC response reached the client. That's a
  // transport failure (connection lost, reset) or an HTML error page from
  // the edge — a fresh request can clear it.
  if (status === undefined) return true;
  if (status >= 500) return true;
  return RETRYABLE_HTTP_STATUSES.has(status);
}

/**
 * React Query `retry` predicate for queries. `failureCount` is 0-indexed
 * (query-core checks before incrementing), so `< MAX_QUERY_RETRIES` yields
 * exactly `MAX_QUERY_RETRIES` retries — and only for transient failures.
 */
export function shouldRetryQuery(failureCount: number, err: unknown): boolean {
  return failureCount < MAX_QUERY_RETRIES && isTransientTrpcError(err);
}

/**
 * Capped exponential backoff for query retries: 0.5s, 1s, 2s (then capped
 * at 4s). `failureCount` is 0-indexed, matching query-core's `retryDelay`.
 */
export function trpcRetryDelay(failureCount: number): number {
  return Math.min(500 * 2 ** failureCount, 4000);
}
