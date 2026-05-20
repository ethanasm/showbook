/**
 * Mobile telemetry sink.
 *
 * The mobile app can't ship logs directly to Axiom — RN has no pino
 * transport, no service-account credentials, and the user JWT couldn't
 * write to ingest anyway. Instead we round-trip through the tRPC
 * `telemetry.logEvent` procedure, which logs to Axiom under the
 * `mobile.*` event namespace on the server side.
 *
 * The sink is for events of any kind, not just errors — lifecycle
 * markers (`upload.start`, `upload.success`) flow through the same
 * pipe as failure events (`upload.put.failed`, `trpc.error`) and are
 * distinguished by `level` (`warn` for informational markers, `error`
 * for actual failures).
 *
 * Two things sit on top of this module:
 *   1. The `errorReporterLink` in `lib/trpc.ts` reports every failed
 *      tRPC query/mutation (except telemetry itself — never recurse).
 *   2. Domain code (upload pipeline, auth bridge, etc.) calls
 *      `reportClientEvent` directly for failures and lifecycle markers
 *      that don't go through tRPC.
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

export interface ClientEventPayload {
  event: string;
  message: string;
  level?: 'warn' | 'error';
  context?: Record<string, unknown>;
}

export type ClientEventLogger = (payload: ClientEventPayload) => void;

let logger: ClientEventLogger | null = null;

export function setMobileTelemetryLogger(fn: ClientEventLogger | null): void {
  logger = fn;
}

export function reportClientEvent(payload: ClientEventPayload): void {
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
