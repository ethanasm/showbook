import { PassThrough, Transform } from 'node:stream';
import pino, { type Level, type Logger, type LoggerOptions, type StreamEntry } from 'pino';
import buildAxiomTransport from '@axiomhq/pino';
import pretty from 'pino-pretty';

const level: Level = (process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug')) as Level;
const isProd = process.env.NODE_ENV === 'production';

/**
 * Custom err serializer.
 *
 * Pino's `stdSerializers.err` walks every enumerable property on the
 * Error object via `for (const key in err)`. That's a problem for two
 * categories of error our code actually sees:
 *
 *   1. DOMException-like errors (RN / Web Crypto / fetch on Node 22)
 *      ship with ~24 inherited constant properties — `ABORT_ERR`,
 *      `DATA_CLONE_ERR`, `HIERARCHY_REQUEST_ERR`, `INDEX_SIZE_ERR`, …
 *      Pino flattens each one into its own log field, and Axiom
 *      promotes each unique field to a dataset column. We hit the
 *      257-column cap on the `showbook-prod` dataset that way, after
 *      which Axiom started rejecting every event that introduced a new
 *      field with `adding 'mediaType' and 2 other fields to dataset
 *      fields would exceed the column limit of 257`. The mobile
 *      `mobile.upload.*` events were the casualties and that's the
 *      reason every "fix" for mobile media upload over the past two
 *      months flew blind in Axiom — only docker stdout retained the
 *      lifecycle events.
 *
 *   2. Anything wrapping a `PostgresError`: Drizzle / postgres-js
 *      surface the SQLSTATE `code` + server-side `detail` only on
 *      `err.cause`, so we must walk the cause chain (pino's
 *      stdSerializer does not).
 *
 * Solution: allowlist the fields we actually want — the standard Error
 * tuple plus the postgres-js / AWS SDK / HTTP shapes that surface in
 * production — and ignore everything else. Cause chain is walked
 * recursively the same way as before.
 *
 * Add fields below as needed when a new error source appears.
 */
const ALLOWED_ERROR_FIELDS = [
  // Standard Error shape (matches pino's stdSerializer output).
  'name',
  'message',
  'stack',
  'type',
  // postgres-js / Drizzle structured fields.
  'code',
  'detail',
  'hint',
  'position',
  'severity',
  'severity_local',
  'file',
  'line',
  'routine',
  'schema_name',
  'table_name',
  'column_name',
  'constraint_name',
  'data_type_name',
  'query',
  // AWS SDK / HTTP client.
  'status',
  '$metadata',
] as const;

export function serializeErr(err: unknown): unknown {
  if (err === null || err === undefined) return err;
  if (!(err instanceof Error)) {
    // Defer to pino for non-Error inputs (handles primitives + plain
    // objects without surprises).
    return pino.stdSerializers.err(err as never);
  }
  const out: Record<string, unknown> = {
    type: err.constructor?.name ?? err.name ?? 'Error',
    name: err.name,
    message: err.message,
    stack: err.stack,
  };
  const anyErr = err as unknown as Record<string, unknown>;
  for (const key of ALLOWED_ERROR_FIELDS) {
    const value = anyErr[key];
    if (value !== undefined && out[key] === undefined) {
      out[key] = value;
    }
  }
  const cause = (err as Error & { cause?: unknown }).cause;
  if (cause !== undefined && cause !== null) {
    out.cause = serializeErr(cause);
  }
  return out;
}

const baseOptions: LoggerOptions = {
  level,
  base: {
    env: process.env.NODE_ENV ?? 'development',
    service: 'showbook',
  },
  redact: {
    paths: [
      '*.apiKey',
      '*.api_key',
      '*.authorization',
      '*.password',
      '*.token',
      '*.secret',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },
  serializers: {
    err: serializeErr,
  },
};

// We don't use pino.transport() (worker-based) because pino's worker resolves
// targets by bare name from a stack-derived caller path that becomes a
// webpack-internal:// URL after Next bundling, which createRequire rejects.
// Instead we statically import each sink as a stream factory and wire them
// into pino.multistream — no workers, no resolution gymnastics.

/**
 * The `component` bound on the mobile-telemetry child logger (see
 * `packages/api/src/routers/telemetry.ts`). Every `mobile.*` event carries
 * this marker, which is how we split mobile telemetry into its own Axiom
 * dataset — see `isMobileRecord`. Keep in sync with the router.
 */
const MOBILE_COMPONENT = 'mobile.telemetry';

/**
 * Is this serialized pino line a mobile-telemetry record? pino flattens the
 * child's bound `component` field onto the top level of every line, so we
 * route on that.
 *
 * We parse and check the **top-level** `component` rather than substring-
 * matching the raw line: server logs can legitimately *embed* a mobile row
 * inside their payload (e.g. the `error_volume` health check lists
 * `{event:"mobile.trpc.error", component:"mobile.telemetry"}` among its top
 * offenders), and a loose `line.includes('"component":"mobile.telemetry"')`
 * misroutes those server rollups into the mobile dataset. The line is
 * already JSON we're about to ship over the network, so the parse cost is
 * negligible. A malformed line (shouldn't happen from pino) is treated as
 * non-mobile so it still lands in the server dataset rather than vanishing.
 */
function isMobileRecord(line: string): boolean {
  try {
    const parsed = JSON.parse(line) as { component?: unknown };
    return parsed.component === MOBILE_COMPONENT;
  } catch {
    return false;
  }
}

function buildStreams(): StreamEntry[] {
  const streams: StreamEntry[] = [];

  streams.push({
    level,
    stream: isProd
      ? process.stdout
      : pretty({
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
          singleLine: false,
        }),
  });

  return streams;
}

/**
 * Build a PassThrough that pino can write to synchronously and, once the
 * async Axiom transport for `dataset` resolves, forwards only the lines
 * matching `keep` to it. Lines written before the pipe attaches buffer in
 * the PassThrough and flush as soon as it's wired — no log lines dropped.
 * `keep` defaults to forwarding everything (single-dataset mode).
 */
function buildAxiomStream(
  dataset: string,
  token: string,
  keep: (line: string) => boolean = () => true,
): PassThrough {
  const buffer = new PassThrough();

  void buildAxiomTransport({ dataset, token })
    .then((axiomStream) => {
      const filter = new Transform({
        transform(chunk, _enc, cb) {
          // pino writes one full JSON line per chunk; `keep` parses it.
          if (keep(chunk.toString())) this.push(chunk);
          cb();
        },
      });
      buffer.pipe(filter).pipe(axiomStream);
    })
    .catch((err) => {
      process.stderr.write(
        `[observability] Axiom transport init failed (${dataset}): ${(err as Error)?.message ?? err}\n`,
      );
    });

  return buffer;
}

let _logger: Logger | null = null;

function buildLogger(): Logger {
  const streams = buildStreams();

  // Axiom shipping. The mobile app has no direct Axiom path — its telemetry
  // arrives server-side via the `telemetry.logEvent` tRPC router under the
  // `mobile.telemetry` component. We ship that to its own dataset
  // (`AXIOM_MOBILE_DATASET`) so the high-cardinality, fast-growing mobile
  // field surface doesn't share the server dataset's 257-column budget.
  // When `AXIOM_MOBILE_DATASET` is unset we fall back to single-dataset
  // mode: everything (mobile included) goes to `AXIOM_DATASET`.
  const token = process.env.AXIOM_TOKEN;
  const serverDataset = process.env.AXIOM_DATASET;
  const mobileDataset = process.env.AXIOM_MOBILE_DATASET;

  if (token && serverDataset) {
    const keepServer = mobileDataset
      ? (line: string) => !isMobileRecord(line)
      : undefined;
    streams.push({ stream: buildAxiomStream(serverDataset, token, keepServer), level });
  }

  if (token && mobileDataset) {
    streams.push({
      stream: buildAxiomStream(mobileDataset, token, isMobileRecord),
      level,
    });
  }

  return pino(baseOptions, pino.multistream(streams));
}

export function getLogger(): Logger {
  if (!_logger) _logger = buildLogger();
  return _logger;
}

export const logger: Logger = new Proxy({} as Logger, {
  get(_target, prop, receiver) {
    return Reflect.get(getLogger(), prop, receiver);
  },
});

export function child(bindings: Record<string, unknown>): Logger {
  return getLogger().child(bindings);
}

export async function flushLogger(): Promise<void> {
  const lg = getLogger();
  await new Promise<void>((resolve) => {
    lg.flush?.((err?: Error | null) => {
      void err;
      resolve();
    }) ?? resolve();
  });
}

export const _testing = { isMobileRecord, MOBILE_COMPONENT };
