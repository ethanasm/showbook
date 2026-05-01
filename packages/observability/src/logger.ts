import { PassThrough } from 'node:stream';
import pino, { type Level, type Logger, type LoggerOptions, type StreamEntry } from 'pino';
import buildAxiomTransport from '@axiomhq/pino';
import pretty from 'pino-pretty';

const level: Level = (process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug')) as Level;
const isProd = process.env.NODE_ENV === 'production';

/**
 * Custom err serializer. Pino's stdSerializer flattens an Error into
 * `{ type, message, stack, code? }`, but it does NOT carry `err.cause`.
 * That matters for any thrown wrapped postgres error: Drizzle / postgres-js
 * surface the SQLSTATE code (e.g. `23505` for unique violations) and the
 * server-side `detail` only on `err.cause`. Without this, Axiom shows
 * `Failed query: …` with no way to tell why it failed. Walk the cause chain
 * and surface `code` + `detail` from any level so production errors stay
 * debuggable.
 */
export function serializeErr(err: unknown): unknown {
  if (!(err instanceof Error)) return pino.stdSerializers.err(err as never);
  const base = pino.stdSerializers.err(err) as Record<string, unknown>;
  const e = err as Error & { code?: unknown; detail?: unknown; cause?: unknown };
  if (e.code !== undefined) base.code = e.code;
  if (e.detail !== undefined) base.detail = e.detail;
  if (e.cause !== undefined && e.cause !== null) {
    base.cause = serializeErr(e.cause);
  }
  return base;
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

let _logger: Logger | null = null;

function buildLogger(): Logger {
  const streams = buildStreams();

  // Axiom's transport factory is async, but we need the logger synchronously
  // for module-load-time `child(...)` callers. Insert a PassThrough into the
  // multistream now and pipe it to the axiom stream once the factory resolves.
  // Lines written before the pipe is attached buffer in the PassThrough and
  // flush as soon as it pipes — no log lines are dropped.
  if (process.env.AXIOM_TOKEN && process.env.AXIOM_DATASET) {
    const axiomBuffer = new PassThrough();
    streams.push({ stream: axiomBuffer, level });

    void buildAxiomTransport({
      dataset: process.env.AXIOM_DATASET,
      token: process.env.AXIOM_TOKEN,
    })
      .then((axiomStream) => {
        axiomBuffer.pipe(axiomStream);
      })
      .catch((err) => {
        process.stderr.write(
          `[observability] Axiom transport init failed: ${(err as Error)?.message ?? err}\n`,
        );
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
