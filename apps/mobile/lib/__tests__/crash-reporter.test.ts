/**
 * Unit tests for the pure crash-reporter core.
 *
 * Imports `crash-reporter-core.ts` directly (no RN deps) so the test
 * runs cleanly under `node:test` + `tsx`. The thin RN wrapper in
 * `crash-reporter.ts` is exercised in development against an actual
 * device; the install logic itself lives in the core and is fully
 * tested here.
 */

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPayload,
  installCrashReporterAgainst,
  reportCrash,
  type CrashEnv,
  type GlobalLike,
} from '../crash-reporter-core.js';

interface ErrorUtilsRecord {
  installed?: (err: unknown, isFatal?: boolean) => void;
  previous?: (err: unknown, isFatal?: boolean) => void;
}

function makeMockErrorUtils(rec: ErrorUtilsRecord) {
  return {
    getGlobalHandler: () => rec.previous,
    setGlobalHandler: (fn: (err: unknown, isFatal?: boolean) => void) => {
      rec.installed = fn;
    },
  };
}

function captureFetchCalls(): {
  calls: Array<{ url: string; init?: RequestInit }>;
  fn: typeof fetch;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response('', { status: 200 }));
  }) as unknown as typeof fetch;
  return { calls, fn };
}

const ENV: CrashEnv = {
  apiUrl: 'https://example.test',
  platform: 'android',
  version: '0.1.1',
  buildNumber: '12',
};

let installedRef: { current: boolean };

beforeEach(() => {
  installedRef = { current: false };
});

afterEach(() => {
  // nothing — each test owns its own GlobalLike
});

describe('buildPayload', () => {
  it('preserves Error message + stack + name', () => {
    const err = new TypeError('cannot read property foo');
    const p = buildPayload(err, 'uncaught', true, ENV);
    assert.equal(p.message, 'cannot read property foo');
    assert.equal(p.errorName, 'TypeError');
    assert.ok(p.stack && p.stack.length > 0, 'stack should be populated');
    assert.equal(p.isFatal, true);
    assert.equal(p.source, 'uncaught');
    assert.equal(p.platform, 'android');
    assert.equal(p.version, '0.1.1');
    assert.equal(p.buildNumber, '12');
  });

  it('coerces non-Error values', () => {
    const p = buildPayload('boom-as-string', 'unhandled_rejection', false, ENV);
    assert.equal(p.message, 'boom-as-string');
    assert.equal(p.source, 'unhandled_rejection');
  });

  it('falls back to a placeholder message when the error has none', () => {
    const err = new Error('');
    const p = buildPayload(err, 'uncaught', false, ENV);
    assert.equal(p.message, 'Error');
  });

  it('clips very long messages and stacks', () => {
    const huge = 'x'.repeat(5000);
    const err = new Error(huge);
    err.stack = 'y'.repeat(20000);
    const p = buildPayload(err, 'uncaught', false, ENV);
    assert.ok(p.message.length <= 2050, 'message should be clipped near 2k');
    assert.ok(p.message.includes('[clipped'), 'clip marker should be present');
    assert.ok(p.stack && p.stack.length <= 8050, 'stack should be clipped near 8k');
  });
});

describe('reportCrash', () => {
  it('POSTs the payload to /api/mobile/crash-report', () => {
    const { calls, fn } = captureFetchCalls();
    reportCrash(
      {
        message: 'TypeError: foo',
        stack: 'at App (apps/mobile/app/_layout.tsx:42:7)',
        isFatal: true,
        platform: 'android',
        version: '0.1.1',
        buildNumber: '12',
        errorName: 'TypeError',
        source: 'uncaught',
      },
      ENV,
      fn,
    );
    assert.equal(calls.length, 1, 'one fetch call');
    assert.equal(
      calls[0].url,
      'https://example.test/api/mobile/crash-report',
      'POSTs to the crash-report endpoint',
    );
    assert.equal(calls[0].init?.method, 'POST');
    const body = JSON.parse(calls[0].init?.body as string);
    assert.equal(body.message, 'TypeError: foo');
    assert.equal(body.platform, 'android');
    assert.equal(body.isFatal, true);
    assert.equal(body.source, 'uncaught');
  });

  it('no-ops when apiUrl is empty (build env without EXPO_PUBLIC_API_URL set)', () => {
    const { calls, fn } = captureFetchCalls();
    reportCrash(
      { message: 'x', platform: 'ios', source: 'uncaught' },
      { ...ENV, apiUrl: '' },
      fn,
    );
    assert.equal(calls.length, 0, 'no fetch when apiUrl is empty');
  });

  it('swallows fetch failures — must not throw from inside a crash handler', () => {
    const throwingFetch = (() => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    assert.doesNotThrow(() =>
      reportCrash(
        { message: 'second crash', platform: 'ios', source: 'uncaught' },
        ENV,
        throwingFetch,
      ),
    );
  });
});

describe('installCrashReporterAgainst', () => {
  it('is idempotent — the second call against a fresh global is a no-op', () => {
    const rec1: ErrorUtilsRecord = {};
    const g1: GlobalLike = { ErrorUtils: makeMockErrorUtils(rec1) };
    installCrashReporterAgainst(g1, ENV, installedRef);
    assert.ok(rec1.installed, 'first install registers the handler');

    const rec2: ErrorUtilsRecord = {};
    const g2: GlobalLike = { ErrorUtils: makeMockErrorUtils(rec2) };
    installCrashReporterAgainst(g2, ENV, installedRef);
    assert.equal(rec2.installed, undefined, 'second install short-circuits on the guard');
  });

  it('chains to the previous global handler so the red-box / native logger still fires', () => {
    const calls: Array<[unknown, boolean | undefined]> = [];
    const rec: ErrorUtilsRecord = {
      previous: (err, isFatal) => {
        calls.push([err, isFatal]);
      },
    };
    const g: GlobalLike = { ErrorUtils: makeMockErrorUtils(rec) };
    installCrashReporterAgainst(g, ENV, installedRef);

    const err = new Error('boom');
    rec.installed!(err, true);

    assert.equal(calls.length, 1, 'previous handler called exactly once');
    assert.equal(calls[0][0], err);
    assert.equal(calls[0][1], true);
  });

  it('survives if there is no previous handler', () => {
    const rec: ErrorUtilsRecord = {};
    const g: GlobalLike = { ErrorUtils: makeMockErrorUtils(rec) };
    installCrashReporterAgainst(g, ENV, installedRef);
    assert.doesNotThrow(() => rec.installed!(new Error('no-prev'), false));
  });

  it('no-ops cleanly when ErrorUtils is not present (web bundle)', () => {
    const g: GlobalLike = {}; // no ErrorUtils, no addEventListener
    assert.doesNotThrow(() => installCrashReporterAgainst(g, ENV, installedRef));
  });

  it('reports the wrapped error when the installed handler fires', () => {
    const { calls, fn } = captureFetchCalls();
    const rec: ErrorUtilsRecord = {};
    const g: GlobalLike = { ErrorUtils: makeMockErrorUtils(rec) };
    installCrashReporterAgainst(g, ENV, installedRef, fn);

    rec.installed!(new Error('handler-fired-error'), true);
    assert.equal(calls.length, 1, 'fetch called once');
    const body = JSON.parse(calls[0].init?.body as string);
    assert.equal(body.message, 'handler-fired-error');
    assert.equal(body.source, 'uncaught');
    assert.equal(body.isFatal, true);
  });

  it('reports unhandled rejections via the global event listener', () => {
    const { calls, fn } = captureFetchCalls();
    type RejectionListener = (event: { reason?: unknown }) => void;
    const captured: { listener: RejectionListener | null } = { listener: null };
    const g: GlobalLike = {
      addEventListener: (type, listener) => {
        if (type === 'unhandledrejection') captured.listener = listener;
      },
    };
    installCrashReporterAgainst(g, ENV, installedRef, fn);

    assert.ok(captured.listener, 'unhandledrejection listener was registered');
    captured.listener!({ reason: new Error('unhandled-rej-error') });

    assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0].init?.body as string);
    assert.equal(body.message, 'unhandled-rej-error');
    assert.equal(body.source, 'unhandled_rejection');
  });
});
