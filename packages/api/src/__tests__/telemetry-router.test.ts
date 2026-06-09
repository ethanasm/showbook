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

describe('telemetryRouter.logEvent', () => {
  it('emits a structured error log under the mobile.* namespace', async () => {
    const db = makeFakeDb({ authUserId: 'user-42' });
    await caller(db, 'user-42').logEvent({
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
    await caller(makeFakeDb()).logEvent({
      event: 'spotify.token.refresh',
      message: 'refreshing took longer than expected',
      level: 'warn',
    });

    assert.equal(captured[0]?.level, 'warn');
  });

  it('defaults to error level when level is omitted', async () => {
    await caller(makeFakeDb()).logEvent({
      event: 'screen.render.failed',
      message: 'ShowDetail crashed',
    });

    assert.equal(captured[0]?.level, 'error');
  });

  it('clips oversized context payloads so a chatty client cannot blow up Axiom', async () => {
    const big = 'x'.repeat(12 * 1024);
    await caller(makeFakeDb()).logEvent({
      event: 'upload.put.failed',
      message: 'huge',
      // `key` is allowlisted, so a huge value survives the key filter and
      // exercises the byte-cap path.
      context: { key: big },
    });

    const log = captured[0]!;
    assert.equal(log.payload._clipped, true);
    assert.ok(typeof log.payload._preview === 'string');
    assert.ok(
      (log.payload._preview as string).length <= 8 * 1024,
      'preview should be clipped to 8 KB',
    );
    // The raw `key` value should NOT have leaked through unclipped.
    assert.equal(log.payload.key, undefined);
  });

  it('drops context keys outside the allowlist so a client cannot widen the Axiom schema', async () => {
    await caller(makeFakeDb()).logEvent({
      event: 'upload.put.failed',
      message: 'mixed',
      context: { status: 500, attackerKey1: 'x', attackerKey2: 'y' },
    });

    const log = captured[0]!;
    // Allowlisted key survives...
    assert.equal(log.payload.status, 500);
    // ...arbitrary keys are dropped and only counted.
    assert.equal(log.payload.attackerKey1, undefined);
    assert.equal(log.payload.attackerKey2, undefined);
    assert.equal(log.payload._droppedKeys, 2);
  });

  it('cannot be tricked into forging event or userId via the context bag', async () => {
    const ctx = { db: makeFakeDb(), session: { user: { id: 'real-user' } } };
    const c = telemetryRouter!.createCaller(ctx as never);
    await c.logEvent({
      event: 'upload.put.failed',
      message: 'spoof attempt',
      context: {
        event: 'auth.user_created',
        userId: 'victim-user',
      } as Record<string, unknown>,
    });

    const log = captured[0]!;
    // Server-controlled fields win; the spoofed values are ignored entirely.
    assert.equal(log.payload.event, 'mobile.upload.put.failed');
    assert.equal(log.payload.userId, 'real-user');
  });

  it('returns ok:true so the caller can await + ignore', async () => {
    const res = await caller(makeFakeDb()).logEvent({
      event: 'noop',
      message: 'noop',
    });
    assert.deepEqual(res, { ok: true });
  });

  it('accepts unauthenticated callers and logs userId as null', async () => {
    // publicProcedure: no auth middleware, so a context without a session
    // is valid. This is the entire point of switching off
    // protectedProcedure — pre-sign-in / expired-token reports must still
    // reach Axiom.
    const ctx = { db: makeFakeDb(), session: null };
    const unauthCaller = telemetryRouter!.createCaller(ctx as never);
    await unauthCaller.logEvent({
      event: 'trpc.error',
      message: 'UNAUTHORIZED',
      level: 'error',
      context: { path: 'shows.list', code: 'UNAUTHORIZED', httpStatus: 401 },
    });

    assert.equal(captured.length, 1);
    const log = captured[0]!;
    assert.equal(log.payload.event, 'mobile.trpc.error');
    assert.equal(log.payload.userId, null);
    assert.equal(log.payload.path, 'shows.list');
    assert.equal(log.payload.httpStatus, 401);
  });
});
