import pino, { type Logger, type LoggerOptions, type TransportTargetOptions } from 'pino';

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const isProd = process.env.NODE_ENV === 'production';

function buildTargets(): TransportTargetOptions[] {
  const targets: TransportTargetOptions[] = [];

  if (isProd) {
    targets.push({
      target: 'pino/file',
      level,
      options: { destination: 1 },
    });
  } else {
    targets.push({
      target: 'pino-pretty',
      level,
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
        singleLine: false,
      },
    });
  }

  if (process.env.AXIOM_TOKEN && process.env.AXIOM_DATASET) {
    targets.push({
      target: '@axiomhq/pino',
      level,
      options: {
        dataset: process.env.AXIOM_DATASET,
        token: process.env.AXIOM_TOKEN,
      },
    });
  }

  return targets;
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
};

let _logger: Logger | null = null;

function buildLogger(): Logger {
  try {
    return pino(baseOptions, pino.transport({ targets: buildTargets() }));
  } catch {
    // If transport setup fails (e.g. workers unavailable), fall back to plain stdout JSON.
    return pino(baseOptions);
  }
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
      // Swallow flush errors — we never want logging to break the caller.
      void err;
      resolve();
    }) ?? resolve();
  });
}
