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
 * Keys that stay top-level columns in the Axiom dataset. Everything else a
 * call-site logs is folded into the single `fields` map field (see
 * `reshapeForAxiom`), which Axiom stores as key-value pairs in ONE column
 * that does not count against the per-dataset field cap. Together with the
 * bounded `err.*` sub-fields (see `ALLOWED_ERROR_FIELDS`) this list IS the
 * dataset's permanent column schema, so keep it small: only add a key when it
 * genuinely needs to be a real column — i.e. it's filtered / grouped /
 * aggregated in APL (the health-check queries, dashboards) where folding it
 * into the map would cost extra query-hours or lose its numeric type.
 *
 *   - `_time` / `time`      pino emits `time`; Axiom renames it to `_time` on
 *                           ingest. Keep both so whichever appears survives.
 *   - `level` / `msg` / `event`  core APL filter / group dimensions.
 *   - `component`           grouped by in the error-volume health check; also
 *                           marks mobile telemetry (`mobile.telemetry`).
 *   - `job` / `jobId`       per-run filtering for pg-boss jobs.
 *   - `userId`              high-value triage dimension.
 *   - `err`                 already bounded by serializeErr; kept flat so
 *                           `err.code` / `err.detail` stay directly queryable.
 *   - `env` / `service` / `pid` / `hostname`  pino base bindings.
 *   - `reason` / `status`   common triage disambiguators.
 *   - `durationMs` / `elapsedMs`  numeric dims aggregated with summarize avg().
 *
 * NEVER add `fields` here: a call-site that logs a literal top-level `fields`
 * key folds to `fields.fields`, which is exactly the bounding we want.
 */
const CORE_FIELDS = new Set<string>([
  '_time',
  'time',
  'level',
  'msg',
  'event',
  'component',
  'job',
  'jobId',
  'userId',
  'err',
  'env',
  'service',
  'pid',
  'hostname',
  'reason',
  'status',
  'durationMs',
  'elapsedMs',
]);

/**
 * Reshape a serialized pino line for Axiom: keep `CORE_FIELDS` at the top
 * level and fold every other key into a single `fields` map field, so the
 * dataset's column count is bounded no matter what keys call-sites log. Pure
 * string→string so it drops straight into the Axiom-bound Transform; stdout is
 * left untouched (stays flat for `docker logs` / pino-pretty).
 *
 * Defensive by design — a line that isn't a JSON object (malformed, primitive,
 * array) is returned untouched so we never drop a log line.
 */
function reshapeForAxiom(line: string): string {
  const hasNewline = line.endsWith('\n');
  const body = hasNewline ? line.slice(0, -1) : line;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return line;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return line;
  }

  const out: Record<string, unknown> = {};
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (CORE_FIELDS.has(key)) out[key] = value;
    else fields[key] = value;
  }
  if (Object.keys(fields).length > 0) out.fields = fields;

  return JSON.stringify(out) + (hasNewline ? '\n' : '');
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
 * async Axiom transport for `dataset` resolves, reshapes each line
 * (`reshapeForAxiom` — folds non-core keys into the `fields` map) and forwards
 * it. Lines written before the pipe attaches buffer in the PassThrough and
 * flush as soon as it's wired — no log lines dropped.
 */
function buildAxiomStream(dataset: string, token: string): PassThrough {
  const buffer = new PassThrough();

  void buildAxiomTransport({ dataset, token })
    .then((axiomStream) => {
      const reshape = new Transform({
        transform(chunk, _enc, cb) {
          // pino writes one full JSON line per chunk; bound the dataset's
          // column count by folding non-core fields into the `fields` map.
          this.push(reshapeForAxiom(chunk.toString()));
          cb();
        },
      });
      buffer.pipe(reshape).pipe(axiomStream);
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

  // Axiom shipping. Every record is reshaped by `reshapeForAxiom` so only
  // `CORE_FIELDS` stay top-level columns and all other keys fold into the
  // single `fields` map field — that keeps the dataset under its column cap no
  // matter what call-sites log. Mobile telemetry has no direct Axiom path; it
  // arrives server-side via the `telemetry.logEvent` tRPC router under the
  // `mobile.telemetry` component and ships to this same dataset.
  const token = process.env.AXIOM_TOKEN;
  const dataset = process.env.AXIOM_DATASET;

  if (token && dataset) {
    streams.push({ stream: buildAxiomStream(dataset, token), level });
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

export const _testing = { reshapeForAxiom, CORE_FIELDS };
