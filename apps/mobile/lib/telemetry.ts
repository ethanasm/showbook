/**
 * Mobile error sink.
 *
 * The mobile app can't ship logs directly to Axiom — RN has no pino
 * transport, no service-account credentials, and the user JWT couldn't
 * write to ingest anyway. Instead we round-trip through the existing
 * tRPC `telemetry.logClientError` procedure, which logs to Axiom under
 * the `mobile.*` event namespace on the server side.
 *
 * Two things sit on top of this module:
 *   1. The `OnError` link in `lib/trpc.ts` reports every failed tRPC
 *      query/mutation (except telemetry itself — never recurse).
 *   2. Domain code (upload pipeline, auth bridge, etc.) calls
 *      `reportClientError` directly when it catches a non-tRPC error
 *      (R2 PUT 403, file-read failure, etc.). These need explicit
 *      hook-points because they don't go through tRPC.
 *
 * Design notes:
 *   - The logger is injected at app boot via `setMobileTelemetryLogger`
 *     so this module doesn't import the tRPC client (would form a
 *     dependency cycle with `lib/trpc.ts`).
 *   - Logging is fire-and-forget. We swallow every failure mode —
 *     telemetry must never become the reason a user sees an error.
 *   - Before the logger is wired up (cold start, sign-out), calls are
 *     dropped. The wiring happens in `_layout.tsx`'s `TrpcProviders`
 *     once the tRPC client is constructed.
 */

export interface ClientErrorPayload {
  event: string;
  message: string;
  level?: 'warn' | 'error';
  context?: Record<string, unknown>;
}

export type ClientErrorLogger = (payload: ClientErrorPayload) => void;

let logger: ClientErrorLogger | null = null;

export function setMobileTelemetryLogger(fn: ClientErrorLogger | null): void {
  logger = fn;
}

export function reportClientError(payload: ClientErrorPayload): void {
  try {
    logger?.(payload);
  } catch {
    // never throw from logging — telemetry must not be in the failure
    // path of the thing it's trying to observe.
  }
}

/**
 * Coerce an arbitrary thrown value into a short, readable message
 * suitable for the `message` field (clipped at 2000 chars on the
 * server). Non-Error values are stringified with a fallback.
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name || 'Error';
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Test-only — reset module state between tests. */
export function __resetTelemetryForTests(): void {
  logger = null;
}
