// Boot-time environment validation. The prod web container reads its
// secrets from `.env.prod`; before this guard, a missing or malformed
// var only surfaced lazily at first use — `auth.config.ts` reads
// GOOGLE_CLIENT_ID/SECRET with `!`, `crypto.ts` decodes TOKEN_KEY on the
// first Spotify token write, `db/client.ts` reads DATABASE_URL with `!`.
// A typo'd `.env.prod` therefore booted a container that served confusing
// runtime failures (or, for pg-boss, stayed up with no jobs registered).
//
// `validateEnv` is a pure function (no throwing, no process side effects)
// so it's unit-testable; `instrumentation.ts` applies it against
// `process.env` at boot and decides whether to crash (prod) or warn
// (dev/test) via `envValidationOutcome`.

// Mirrors KEY_BYTES in packages/api/src/crypto.ts — TOKEN_KEY must decode
// to a 32-byte AES-256 key.
const TOKEN_KEY_BYTES = 32;

// Required in production. Each is consumed somewhere that null-asserts or
// lazily throws; validating up-front turns a confusing runtime failure
// into a loud boot failure. POSTGRES_PASSWORD is intentionally absent —
// infra/docker-compose.prod.yml already enforces it via
// `${POSTGRES_PASSWORD:?...}` before the container starts.
export const REQUIRED_ENV_VARS = [
  'AUTH_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'DATABASE_URL',
  'NEXTAUTH_URL',
  'TOKEN_KEY',
] as const;

// Reuse the exact hex-or-base64 decode contract from crypto.ts's getKey()
// so the validator rejects a malformed TOKEN_KEY at boot rather than at the
// first encrypt() call.
function tokenKeyDecodesTo32Bytes(raw: string): boolean {
  let key: Buffer;
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === TOKEN_KEY_BYTES * 2) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = Buffer.from(raw, 'base64');
  }
  return key.length === TOKEN_KEY_BYTES;
}

/**
 * Validate the prod-critical environment. Returns the list of problems
 * (empty when the environment is well-formed). Never throws.
 */
export function validateEnv(env: Record<string, string | undefined>): { errors: string[] } {
  const errors: string[] = [];

  for (const name of REQUIRED_ENV_VARS) {
    const value = env[name];
    if (!value || value.trim() === '') {
      errors.push(`${name} is required but not set`);
    }
  }

  // Only format-check TOKEN_KEY when it's present — its absence is already
  // reported by the required-vars loop above.
  const tokenKey = env.TOKEN_KEY;
  if (tokenKey && tokenKey.trim() !== '' && !tokenKeyDecodesTo32Bytes(tokenKey)) {
    errors.push(
      'TOKEN_KEY must decode to 32 bytes — set it to 64 hex chars (openssl rand -hex 32) or base64 of 32 bytes',
    );
  }

  return { errors };
}

export type EnvValidationOutcome = 'ok' | 'warn' | 'fatal';

/**
 * Decide how boot should react to validation problems. Kept separate from
 * `process.exit` so the policy is unit-testable. Only production treats a
 * bad environment as fatal — dev / test / e2e run with stub or partial
 * envs (the session-start hook writes a placeholder .env.local) and must
 * not be crashed by this guard.
 */
export function envValidationOutcome(
  errors: string[],
  nodeEnv: string | undefined,
): EnvValidationOutcome {
  if (errors.length === 0) return 'ok';
  return nodeEnv === 'production' ? 'fatal' : 'warn';
}
