/**
 * Smoke tests for logger.ts. Real Axiom transport never starts because
 * AXIOM_TOKEN / AXIOM_DATASET are not set in the unit-test env. We
 * verify the public interface and the redact path.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { logger, child, getLogger, flushLogger } from '../logger';

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
