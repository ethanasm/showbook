/**
 * Unit tests for the mobile telemetry tRPC router. The router has no DB
 * dependencies — its only side effect is calling the pino logger — so we
 * mock `@showbook/observability`'s `child()` factory with `node:test`'s
 * `mock.module` and assert the structured fields it received.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mock as nodeMock } from 'node:test';
import { makeFakeDb, fakeCtx, type FakeDb } from './_fake-db';

interface CapturedLog {
  level: 'warn' | 'error';
  payload: Record<string, unknown>;
  message: string;
}

const captured: CapturedLog[] = [];
const fakeChild = {
  warn: (payload: Record<string, unknown>, message: string) =>
    captured.push({ level: 'warn', payload, message }),
  error: (payload: Record<string, unknown>, message: string) =>
    captured.push({ level: 'error', payload, message }),
  info: () => undefined,
  debug: () => undefined,
};

let observabilityMock: { restore: () => void } | null = null;
let telemetryRouter: typeof import('../routers/telemetry').telemetryRouter | null = null;

before(async () => {
  observabilityMock = nodeMock.module('@showbook/observability', {
    namedExports: {
      child: () => fakeChild,
      logger: fakeChild,
    },
  });
  ({ telemetryRouter } = await import('../routers/telemetry'));
});

after(() => {
  observabilityMock?.restore();
});

beforeEach(() => {
  captured.length = 0;
});

function caller(db: FakeDb, userId = 'user-1') {
  return telemetryRouter!.createCaller(fakeCtx(db, userId) as never);
}

describe('telemetryRouter.logClientError', () => {
  it('emits a structured error log under the mobile.* namespace', async () => {
    const db = makeFakeDb({ authUserId: 'user-42' });
    await caller(db, 'user-42').logClientError({
      event: 'upload.put.failed',
      message: 'R2 PUT 403',
      level: 'error',
      context: { status: 403, key: 'showbook/x' },
    });

    assert.equal(captured.length, 1);
    const log = captured[0]!;
    assert.equal(log.level, 'error');
    assert.equal(log.message, 'R2 PUT 403');
    assert.equal(log.payload.event, 'mobile.upload.put.failed');
    assert.equal(log.payload.userId, 'user-42');
    assert.equal(log.payload.status, 403);
    assert.equal(log.payload.key, 'showbook/x');
  });

  it('emits at warn level when the caller asks for it', async () => {
    await caller(makeFakeDb()).logClientError({
      event: 'spotify.token.refresh',
      message: 'refreshing took longer than expected',
      level: 'warn',
    });

    assert.equal(captured[0]?.level, 'warn');
  });

  it('defaults to error level when level is omitted', async () => {
    await caller(makeFakeDb()).logClientError({
      event: 'screen.render.failed',
      message: 'ShowDetail crashed',
    });

    assert.equal(captured[0]?.level, 'error');
  });

  it('clips oversized context payloads so a chatty client cannot blow up Axiom', async () => {
    const big = 'x'.repeat(12 * 1024);
    await caller(makeFakeDb()).logClientError({
      event: 'upload.put.failed',
      message: 'huge',
      context: { bigBlob: big },
    });

    const log = captured[0]!;
    assert.equal(log.payload._clipped, true);
    assert.ok(typeof log.payload._preview === 'string');
    assert.ok(
      (log.payload._preview as string).length <= 8 * 1024,
      'preview should be clipped to 8 KB',
    );
    // The raw `bigBlob` key should NOT have leaked through.
    assert.equal(log.payload.bigBlob, undefined);
  });

  it('returns ok:true so the caller can await + ignore', async () => {
    const res = await caller(makeFakeDb()).logClientError({
      event: 'noop',
      message: 'noop',
    });
    assert.deepEqual(res, { ok: true });
  });
});
