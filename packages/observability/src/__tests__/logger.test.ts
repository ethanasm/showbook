/**
 * Smoke tests for logger.ts. Real Axiom transport never starts because
 * AXIOM_TOKEN / AXIOM_DATASET are not set in the unit-test env. We
 * verify the public interface and the redact path.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { logger, child, getLogger, flushLogger, serializeErr } from '../logger';

describe('logger', () => {
  it('getLogger returns a singleton', () => {
    const a = getLogger();
    const b = getLogger();
    assert.equal(a, b);
  });

  it('logger proxy exposes pino methods', () => {
    assert.equal(typeof logger.info, 'function');
    assert.equal(typeof logger.debug, 'function');
    assert.equal(typeof logger.warn, 'function');
    assert.equal(typeof logger.error, 'function');
    assert.equal(typeof logger.fatal, 'function');
  });

  it('child() returns a logger with bound fields', () => {
    const c = child({ component: 'test', requestId: 'abc' });
    assert.equal(typeof c.info, 'function');
    // Pino exposes bindings; assert our binding shows up.
    const bindings = c.bindings();
    assert.equal(bindings.component, 'test');
    assert.equal(bindings.requestId, 'abc');
  });

  it('child(...) does not throw when called multiple times', () => {
    const a = child({ a: 1 });
    const b = child({ b: 2 });
    assert.notEqual(a, b);
  });

  it('flushLogger resolves without throwing', async () => {
    await flushLogger();
  });

  it('logger.info accepts structured payload + message', () => {
    // Just verifying the call doesn't throw — we don't intercept stdout.
    logger.info({ event: 'test.ping', n: 1 }, 'ping');
  });
});

// Plan §F: pino's default err serializer drops `err.cause`. That matters
// because Drizzle / postgres-js wrap the actual `PostgresError` (with
// SQLSTATE `code` + `detail`) in `err.cause` — which is exactly what was
// missing from the 2026-04-30 `shows.create` Axiom record. Verify the
// custom serializer walks the cause chain.
describe('serializeErr', () => {
  it('flattens a plain Error like stdSerializers (type, message, stack)', () => {
    const err = new TypeError('boom');
    const serialized = serializeErr(err) as Record<string, unknown>;
    assert.equal(serialized.type, 'TypeError');
    assert.equal(serialized.message, 'boom');
    assert.equal(typeof serialized.stack, 'string');
  });

  it('captures err.code (e.g. PG SQLSTATE)', () => {
    const err = Object.assign(new Error('failed query'), { code: '23505' });
    const serialized = serializeErr(err) as Record<string, unknown>;
    assert.equal(serialized.code, '23505');
  });

  it('captures err.detail (PG server-side detail)', () => {
    const err = Object.assign(new Error('unique violation'), {
      code: '23505',
      detail: 'Key (ticketmaster_venue_id)=(KovZpZAFadlA) already exists.',
    });
    const serialized = serializeErr(err) as Record<string, unknown>;
    assert.equal(serialized.code, '23505');
    assert.match(String(serialized.detail), /KovZpZAFadlA/);
  });

  it('walks err.cause one level (Drizzle wrapping postgres-js)', () => {
    const pgErr = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      detail: 'already exists',
    });
    const drizzleErr = new Error('Failed query: insert into venues …');
    (drizzleErr as Error & { cause?: unknown }).cause = pgErr;

    const serialized = serializeErr(drizzleErr) as Record<string, unknown>;
    // pino's stdSerializer concatenates the cause message into `message`;
    // we don't fight that. The important data is the structured `cause`.
    assert.match(String(serialized.message), /Failed query/);
    const cause = serialized.cause as Record<string, unknown>;
    assert.match(String(cause.message), /duplicate key value/);
    assert.equal(cause.code, '23505');
    assert.equal(cause.detail, 'already exists');
  });

  it('walks nested err.cause recursively', () => {
    const inner = new Error('innermost');
    const middle = Object.assign(new Error('middle'), { cause: inner });
    const outer = Object.assign(new Error('outer'), { cause: middle });

    const serialized = serializeErr(outer) as Record<string, unknown>;
    const c1 = serialized.cause as Record<string, unknown>;
    assert.match(String(c1.message), /middle/);
    const c2 = c1.cause as Record<string, unknown>;
    assert.match(String(c2.message), /innermost/);
  });

  it('passes through non-Error values unchanged via stdSerializers.err', () => {
    // pino.stdSerializers.err returns the value as-is for non-Error inputs.
    assert.equal(serializeErr('plain string'), 'plain string');
    assert.equal(serializeErr(42), 42);
    assert.equal(serializeErr(null), null);
  });
});
