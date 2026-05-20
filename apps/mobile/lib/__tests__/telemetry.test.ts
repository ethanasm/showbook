import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  reportClientEvent,
  setMobileTelemetryLogger,
  describeError,
  __resetTelemetryForTests,
  type ClientEventPayload,
} from '../telemetry';

beforeEach(() => __resetTelemetryForTests());

describe('telemetry — describeError', () => {
  it('extracts message from an Error', () => {
    assert.equal(describeError(new Error('boom')), 'boom');
  });

  it('falls back to the error name when message is empty', () => {
    const err = new Error('');
    assert.equal(describeError(err), 'Error');
  });

  it('passes strings through unchanged', () => {
    assert.equal(describeError('oops'), 'oops');
  });

  it('stringifies objects so we never lose a non-Error throw', () => {
    assert.equal(describeError({ kind: 'weird', n: 1 }), '{"kind":"weird","n":1}');
  });

  it('falls back to String() when JSON.stringify throws (circular ref)', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    const out = describeError(a);
    // Just assert it produced *some* string and didn't throw.
    assert.equal(typeof out, 'string');
    assert.ok(out.length > 0);
  });
});

describe('telemetry — reportClientEvent', () => {
  it('is a no-op before the logger is wired up (no throw, no crash)', () => {
    // Logger is null after the beforeEach reset.
    assert.doesNotThrow(() =>
      reportClientEvent({ event: 'x', message: 'y' }),
    );
  });

  it('forwards the payload to the registered logger', () => {
    const received: ClientEventPayload[] = [];
    setMobileTelemetryLogger((p) => received.push(p));

    reportClientEvent({
      event: 'upload.put.failed',
      message: 'R2 PUT 403',
      level: 'error',
      context: { status: 403, key: 'showbook/x' },
    });

    assert.equal(received.length, 1);
    assert.deepEqual(received[0], {
      event: 'upload.put.failed',
      message: 'R2 PUT 403',
      level: 'error',
      context: { status: 403, key: 'showbook/x' },
    });
  });

  it('swallows logger throws — telemetry must never derail the caller', () => {
    setMobileTelemetryLogger(() => {
      throw new Error('logger blew up');
    });
    assert.doesNotThrow(() =>
      reportClientEvent({ event: 'x', message: 'y' }),
    );
  });

  it('unregistering with null drops subsequent reports silently', () => {
    const received: ClientEventPayload[] = [];
    setMobileTelemetryLogger((p) => received.push(p));
    reportClientEvent({ event: 'a', message: 'b' });
    setMobileTelemetryLogger(null);
    reportClientEvent({ event: 'c', message: 'd' });
    assert.equal(received.length, 1);
    assert.equal(received[0]?.event, 'a');
  });
});
