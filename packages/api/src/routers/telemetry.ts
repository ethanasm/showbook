import { z } from 'zod';
import { child } from '@showbook/observability';
import { router, publicProcedure } from '../trpc';

const log = child({ component: 'mobile.telemetry' });

/**
 * Mobile client-side error sink.
 *
 * The mobile app has no direct path to Axiom — RN can't ship pino logs.
 * Whenever the client catches an error that the user would otherwise see
 * as a toast (tRPC procedure failures, R2 PUT non-2xx, unhandled
 * exceptions in screens), it fires `logClientError` so the failure shows
 * up alongside the server logs under the `mobile.<event>` namespace.
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

function clipContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const serialised = JSON.stringify(context);
  if (serialised.length <= MAX_CONTEXT_BYTES) return context;
  return { _clipped: true, _previewBytes: serialised.length, _preview: serialised.slice(0, MAX_CONTEXT_BYTES) };
}

export const telemetryRouter = router({
  logClientError: publicProcedure
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
      const clipped = clipContext(input.context);
      const payload = {
        event: `mobile.${input.event}`,
        userId,
        ...(clipped ?? {}),
      };
      if (input.level === 'warn') {
        log.warn(payload, input.message);
      } else {
        log.error(payload, input.message);
      }
      return { ok: true };
    }),
});
