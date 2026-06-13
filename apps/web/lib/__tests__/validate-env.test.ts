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
  it('is ok when there are no errors, regardless of NODE_ENV', () => {
    assert.equal(envValidationOutcome([], 'production'), 'ok');
    assert.equal(envValidationOutcome([], 'development'), 'ok');
    assert.equal(envValidationOutcome([], undefined), 'ok');
  });

  it('is fatal in production when there are errors', () => {
    assert.equal(envValidationOutcome(['AUTH_SECRET is required but not set'], 'production'), 'fatal');
  });

  it('is only a warning outside production', () => {
    assert.equal(envValidationOutcome(['x'], 'development'), 'warn');
    assert.equal(envValidationOutcome(['x'], 'test'), 'warn');
    assert.equal(envValidationOutcome(['x'], undefined), 'warn');
  });
});
