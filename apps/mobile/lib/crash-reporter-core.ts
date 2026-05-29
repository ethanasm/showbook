/**
 * Pure, RN-free core of the crash reporter — extracted so unit tests
 * can exercise the handler logic without dragging in `react-native`
 * (its Flow-typed `index.js` doesn't go through `tsx`). The thin RN
 * wrapper lives in `crash-reporter.ts` and just injects `Platform.OS`
 * + `Constants.expoConfig.version` / buildNumber into the env bag.
 */

const ENDPOINT_PATH = '/api/mobile/crash-report';
const MAX_STACK_LEN = 8000;
const MAX_MESSAGE_LEN = 2000;

export interface CrashEnv {
  apiUrl: string;
  platform: 'ios' | 'android' | 'web';
  version?: string;
  buildNumber?: string;
}

export interface CrashPayload {
  message: string;
  stack?: string;
  isFatal?: boolean;
  platform: 'ios' | 'android' | 'web';
  version?: string;
  buildNumber?: string;
  errorName?: string;
  source: 'uncaught' | 'unhandled_rejection';
}

export interface ErrorUtilsLike {
  getGlobalHandler?: () => ((err: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (fn: (err: unknown, isFatal?: boolean) => void) => void;
}

export interface GlobalLike {
  ErrorUtils?: ErrorUtilsLike;
  addEventListener?: (
    type: string,
    listener: (event: { reason?: unknown }) => void,
  ) => void;
  fetch?: typeof fetch;
}

function clip(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…[clipped ${value.length - max} chars]`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function buildPayload(
  err: unknown,
  source: CrashPayload['source'],
  isFatal: boolean,
  env: CrashEnv,
): CrashPayload {
  const e =
    err instanceof Error
      ? err
      : new Error(typeof err === 'string' ? err : safeStringify(err));
  return {
    message: clip(e.message || e.name || 'Unknown error', MAX_MESSAGE_LEN) ?? 'Unknown error',
    stack: clip(e.stack, MAX_STACK_LEN),
    isFatal,
    platform: env.platform,
    version: env.version,
    buildNumber: env.buildNumber,
    errorName: e.name,
    source,
  };
}

export function reportCrash(
  payload: CrashPayload,
  env: CrashEnv,
  fetchImpl?: typeof fetch,
): void {
  if (!env.apiUrl) return;
  const f = fetchImpl ?? (globalThis as GlobalLike).fetch;
  if (!f) return;
  try {
    const controller =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (controller) {
      setTimeout(() => controller.abort(), 5000);
    }
    void f(`${env.apiUrl}${ENDPOINT_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller?.signal,
    }).catch(() => undefined);
  } catch {
    // never throw from the crash handler — see crash-reporter.ts header.
  }
}

/**
 * Install the global JS-error handler and unhandled-rejection listener
 * against the provided global. Idempotent: the `installedRef.current`
 * guard ensures repeated calls (e.g. from module re-import in tests)
 * don't stack handlers.
 */
export function installCrashReporterAgainst(
  g: GlobalLike,
  env: CrashEnv,
  installedRef: { current: boolean },
  fetchImpl?: typeof fetch,
): void {
  if (installedRef.current) return;
  installedRef.current = true;

  const errorUtils = g.ErrorUtils;
  if (errorUtils?.setGlobalHandler && errorUtils.getGlobalHandler) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((err, isFatal) => {
      try {
        reportCrash(buildPayload(err, 'uncaught', !!isFatal, env), env, fetchImpl);
      } catch {
        // never throw from the handler
      } finally {
        if (previous) {
          try {
            previous(err, isFatal);
          } catch {
            // swallow — original error already logged
          }
        }
      }
    });
  }

  if (typeof g.addEventListener === 'function') {
    g.addEventListener('unhandledrejection', (event) => {
      try {
        reportCrash(
          buildPayload(event?.reason, 'unhandled_rejection', false, env),
          env,
          fetchImpl,
        );
      } catch {
        // swallow
      }
    });
  }
}
