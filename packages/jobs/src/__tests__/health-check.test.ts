/**
 * Unit tests for the health-check orchestrator. The orchestrator
 * accepts the Resend client and external-API pings as options, so
 * tests don't have to mock the SDK or network — `mock.module` is
 * reserved for the DB and the email-render side-effect.
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

interface ScriptedExecute {
  results: unknown[];
  shouldThrow: Error | null;
}
const EXECUTE: ScriptedExecute = { results: [], shouldThrow: null };

mock.module('@showbook/db', {
  namedExports: {
    db: {
      execute: async () => {
        if (EXECUTE.shouldThrow) throw EXECUTE.shouldThrow;
        return EXECUTE.results.shift() ?? [];
      },
    },
  },
});

mock.module('@showbook/emails', {
  namedExports: {
    renderHealthSummary: async () => '<html>health</html>',
  },
});

import type { ResendLike } from '../health-check';
import type { ExternalPingFns } from '../health-check/checks';

let runHealthCheck: typeof import('../health-check').runHealthCheck;

before(async () => {
  runHealthCheck = (await import('../health-check')).runHealthCheck;
});

const noopPings: ExternalPingFns = {
  ticketmaster: async () => ({}),
  setlistfm: async () => ({}),
  groq: async () => ({}),
  resend: async () => ({}),
};

interface FakeResend extends ResendLike {
  sendCalls: Array<unknown>;
}

function makeResend(opts: {
  shouldThrow?: boolean;
  error?: { message: string } | null;
} = {}): FakeResend {
  const sendCalls: Array<unknown> = [];
  const fake: FakeResend = {
    sendCalls,
    emails: {
      send: async (payload) => {
        sendCalls.push(payload);
        if (opts.shouldThrow) throw new Error('resend network');
        if (opts.error) return { error: opts.error, data: null };
        return { data: { id: 'email-1' }, error: null };
      },
    },
    domains: {
      list: async () => ({ data: [], error: null }),
    },
  };
  return fake;
}

beforeEach(() => {
  // Default: clean queue, fresh announcements, no stalled scrapes.
  EXECUTE.results = [
    [], // checkDatabaseConnectivity SELECT 1
    [{ failed: 0, active_stuck: 0, active_total: 0, retry: 0 }], // pgboss queue
    [{ last_discovered: new Date(Date.now() - 60 * 60 * 1000) }], // freshness
    [{ cnt: 0 }], // stalled scrapes
  ];
  EXECUTE.shouldThrow = null;
  delete process.env.RESEND_API_KEY;
  delete process.env.ADMIN_EMAILS;
  delete process.env.AXIOM_QUERY_TOKEN;
});

describe('runHealthCheck', () => {
  it('runs every check and rolls up status (ok when all clean and Axiom unset)', async () => {
    const result = await runHealthCheck({ pings: noopPings, resend: null });
    // 5 ok (db, queue, freshness, stalled, external) + 3 unknown (axiom checks).
    assert.equal(result.checks.length, 8);
    assert.equal(result.failCount, 0);
    assert.equal(result.unknownCount, 3);
    assert.equal(result.okCount, 5);
    assert.equal(result.status, 'ok');
    assert.equal(result.emailSent, false); // no recipient configured
  });

  it('skips email when Resend is null', async () => {
    process.env.ADMIN_EMAILS = 'ops@example.com';
    const result = await runHealthCheck({ pings: noopPings, resend: null });
    assert.equal(result.emailSent, false);
  });

  it('skips email when ADMIN_EMAILS is unset even with a Resend client', async () => {
    const fake = makeResend();
    const result = await runHealthCheck({ pings: noopPings, resend: fake });
    assert.equal(result.emailSent, false);
    assert.equal(fake.sendCalls.length, 0);
  });

  it('sends email to every ADMIN_EMAILS entry when Resend client is set', async () => {
    process.env.ADMIN_EMAILS = 'ops@example.com, oncall@example.com';
    const fake = makeResend();
    const result = await runHealthCheck({ pings: noopPings, resend: fake });
    assert.equal(result.emailSent, true);
    assert.equal(fake.sendCalls.length, 1);
    const sent = fake.sendCalls[0] as {
      to: string | string[];
      subject: string;
      html: string;
    };
    assert.deepEqual(sent.to, ['ops@example.com', 'oncall@example.com']);
    assert.match(sent.subject, /\[Showbook health\]/);
    assert.match(sent.html, /health/);
  });

  it('lower-cases ADMIN_EMAILS entries (matches parseAdminEmails behaviour)', async () => {
    process.env.ADMIN_EMAILS = 'OPS@Example.com';
    const fake = makeResend();
    await runHealthCheck({ pings: noopPings, resend: fake });
    const sent = fake.sendCalls[0] as { to: string[] };
    assert.deepEqual(sent.to, ['ops@example.com']);
  });

  it('marks emailSent=false when Resend send throws', async () => {
    process.env.ADMIN_EMAILS = 'ops@example.com';
    const fake = makeResend({ shouldThrow: true });
    const result = await runHealthCheck({ pings: noopPings, resend: fake });
    assert.equal(result.emailSent, false);
    // Run still produced a summary — we don't throw.
    assert.ok(['ok', 'warn', 'fail', 'unknown'].includes(result.status));
  });

  it('marks emailSent=false when Resend returns an error envelope', async () => {
    process.env.ADMIN_EMAILS = 'ops@example.com';
    const fake = makeResend({ error: { message: 'rate limited' } });
    const result = await runHealthCheck({ pings: noopPings, resend: fake });
    assert.equal(result.emailSent, false);
  });

  it('rolls up to fail when one check fails', async () => {
    EXECUTE.shouldThrow = new Error('connection refused');
    const result = await runHealthCheck({ pings: noopPings, resend: null });
    assert.equal(result.status, 'fail');
    assert.ok(result.failCount >= 1);
  });

  it('subject reflects rollup status', async () => {
    process.env.ADMIN_EMAILS = 'ops@example.com';
    const fake = makeResend();
    EXECUTE.shouldThrow = new Error('boom');
    await runHealthCheck({ pings: noopPings, resend: fake });
    const sent = fake.sendCalls[0] as { subject: string };
    assert.match(sent.subject, /FAIL/);
  });
});
