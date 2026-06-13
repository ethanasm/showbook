import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  REQUIRED_ENV_VARS,
  validateEnv,
  envValidationOutcome,
} from '../validate-env';

// A well-formed environment used as the baseline for each case.
function validEnv(): Record<string, string | undefined> {
  return {
    AUTH_SECRET: 'a-long-random-auth-secret',
    GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    DATABASE_URL: 'postgresql://showbook_prod:pw@db:5432/showbook_prod',
    NEXTAUTH_URL: 'https://showbook.example.com',
    TOKEN_KEY: randomBytes(32).toString('hex'), // 64 hex chars
  };
}

describe('validateEnv', () => {
  it('returns no errors when every required var is present and well-formed', () => {
    assert.deepEqual(validateEnv(validEnv()).errors, []);
  });

  it('reports each required var that is missing', () => {
    for (const name of REQUIRED_ENV_VARS) {
      const env = validEnv();
      delete env[name];
      const { errors } = validateEnv(env);
      assert.ok(
        errors.some((e) => e.startsWith(`${name} `)),
        `expected an error mentioning ${name}, got: ${errors.join('; ')}`,
      );
    }
  });

  it('treats an empty / whitespace-only value as missing', () => {
    const env = validEnv();
    env.AUTH_SECRET = '   ';
    const { errors } = validateEnv(env);
    assert.ok(errors.some((e) => e.startsWith('AUTH_SECRET ')));
  });

  it('accepts a base64-encoded 32-byte TOKEN_KEY', () => {
    const env = validEnv();
    env.TOKEN_KEY = randomBytes(32).toString('base64');
    assert.deepEqual(validateEnv(env).errors, []);
  });

  it('rejects a TOKEN_KEY that does not decode to 32 bytes', () => {
    const env = validEnv();
    env.TOKEN_KEY = 'deadbeef'; // valid hex but only 4 bytes
    const { errors } = validateEnv(env);
    assert.ok(errors.some((e) => e.startsWith('TOKEN_KEY ')));
  });

  it('rejects a non-hex, non-32-byte-base64 TOKEN_KEY', () => {
    const env = validEnv();
    env.TOKEN_KEY = 'not-a-real-key';
    const { errors } = validateEnv(env);
    assert.ok(errors.some((e) => e.startsWith('TOKEN_KEY ')));
  });

  it('does not double-report TOKEN_KEY format when it is simply absent', () => {
    const env = validEnv();
    delete env.TOKEN_KEY;
    const { errors } = validateEnv(env);
    const tokenKeyErrors = errors.filter((e) => e.startsWith('TOKEN_KEY '));
    assert.equal(tokenKeyErrors.length, 1);
  });
});

describe('envValidationOutcome', () => {
  it('is ok when there are no errors, regardless of environment', () => {
    assert.equal(envValidationOutcome([], { NODE_ENV: 'production' }), 'ok');
    assert.equal(envValidationOutcome([], { NODE_ENV: 'development' }), 'ok');
    assert.equal(envValidationOutcome([], {}), 'ok');
  });

  it('is fatal in real production when there are errors', () => {
    assert.equal(
      envValidationOutcome(['AUTH_SECRET is required but not set'], { NODE_ENV: 'production' }),
      'fatal',
    );
  });

  it('is only a warning in a prod-like test deployment (ENABLE_TEST_ROUTES=1)', () => {
    // The Playwright / Maestro server runs `next start` (NODE_ENV=production)
    // with test routes enabled and without Google OAuth / TOKEN_KEY — it must
    // not be crashed by the guard.
    assert.equal(
      envValidationOutcome(['x'], { NODE_ENV: 'production', ENABLE_TEST_ROUTES: '1' }),
      'warn',
    );
  });

  it('is only a warning outside production', () => {
    assert.equal(envValidationOutcome(['x'], { NODE_ENV: 'development' }), 'warn');
    assert.equal(envValidationOutcome(['x'], { NODE_ENV: 'test' }), 'warn');
    assert.equal(envValidationOutcome(['x'], {}), 'warn');
  });
});
