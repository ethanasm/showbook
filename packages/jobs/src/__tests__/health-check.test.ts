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
        const next = EXECUTE.results.shift();
        // Letting tests script per-call throws (e.g. "the claim INSERT
        // fails but the prior 4 checks succeed") by parking an Error
        // instance at the right slot in `results`.
        if (next instanceof Error) throw next;
        return next ?? [];
      },
    },
    // The orchestrator imports `sql` to build its INSERT … ON CONFLICT
    // claim. Tests don't inspect the SQL string itself — they assert on
    // the values shifted out of EXECUTE.results — so a no-op tag that
    // captures the template fragments is enough to satisfy the import.
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
    }),
  },
});

mock.module('@showbook/emails', {
  namedExports: {
    renderHealthSummary: async () => '<html>health</html>',
  },
});

import type { ResendLike, RunHealthCheckOptions } from '../health-check';
import type { ExternalPingFns } from '../health-check/checks';

let runHealthCheck: typeof import('../health-check').runHealthCheck;
let defaultExternalPings: typeof import('../health-check').defaultExternalPings;

before(async () => {
  const mod = await import('../health-check');
  runHealthCheck = mod.runHealthCheck;
  defaultExternalPings = mod.defaultExternalPings;
});

const noopPings: ExternalPingFns = {
  ticketmaster: async () => ({}),
  setlistfm: async () => ({}),
  groq: async () => ({}),
  resend: async () => ({}),
};

// By default tests inject a no-op preamble fn so they don't reach Groq.
const noPreamble = async () => null;

interface FakeResend extends ResendLike {
  sendCalls: Array<{ payload: unknown; options: unknown }>;
}

function makeResend(opts: {
  shouldThrow?: boolean;
  error?: { message: string } | null;
} = {}): FakeResend {
  const sendCalls: Array<{ payload: unknown; options: unknown }> = [];
  const fake: FakeResend = {
    sendCalls,
    emails: {
      send: async (payload, options) => {
        sendCalls.push({ payload, options });
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

// 5th execute call is the daily-send claim: a non-empty array means
// "this run won the dedup race, proceed with the email"; an empty array
// means "another run already claimed today, skip cleanly".
const CLAIM_WON: ReadonlyArray<unknown> = [{ et_date: '2026-05-05' }];
const CLAIM_LOST: ReadonlyArray<unknown> = [];

beforeEach(() => {
  // Default: clean queue, fresh announcements, no stalled scrapes,
  // claim won.
  EXECUTE.results = [
    [], // checkDatabaseConnectivity SELECT 1
    [{ failed: 0, active_stuck: 0, active_total: 0, retry: 0 }], // pgboss queue
    [{ last_discovered: new Date(Date.now() - 60 * 60 * 1000) }], // freshness
    [{ cnt: 0 }], // stalled scrapes
    CLAIM_WON, // claimDailySend → INSERT RETURNING et_date
  ];
  EXECUTE.shouldThrow = null;
  delete process.env.RESEND_API_KEY;
  delete process.env.ADMIN_EMAILS;
  delete process.env.AXIOM_QUERY_TOKEN;
});

describe('runHealthCheck', () => {
  it('runs every check and rolls up status (ok when all clean and Axiom unset)', async () => {
    const result = await runHealthCheck({ pings: noopPings, resend: null, generatePreamble: noPreamble });
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
    const result = await runHealthCheck({ pings: noopPings, resend: null, generatePreamble: noPreamble });
    assert.equal(result.emailSent, false);
  });

  it('skips email when ADMIN_EMAILS is unset even with a Resend client', async () => {
    const fake = makeResend();
    const result = await runHealthCheck({ pings: noopPings, resend: fake, generatePreamble: noPreamble });
    assert.equal(result.emailSent, false);
    assert.equal(fake.sendCalls.length, 0);
  });

  it('sends email to every ADMIN_EMAILS entry when Resend client is set', async () => {
    process.env.ADMIN_EMAILS = 'ops@example.com, oncall@example.com';
    const fake = makeResend();
    const result = await runHealthCheck({ pings: noopPings, resend: fake, generatePreamble: noPreamble });
    assert.equal(result.emailSent, true);
    assert.equal(fake.sendCalls.length, 1);
    const sent = fake.sendCalls[0]!.payload as {
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
    await runHealthCheck({ pings: noopPings, resend: fake, generatePreamble: noPreamble });
    const sent = fake.sendCalls[0]!.payload as { to: string[] };
    assert.deepEqual(sent.to, ['ops@example.com']);
  });

  it('passes a per-day ET idempotency key so re-runs collapse to one delivery', async () => {
    process.env.ADMIN_EMAILS = 'ops@example.com';
    const fake = makeResend();
    // 2026-05-05 11:00 UTC is 2026-05-05 07:00 ET — Tuesday morning.
    const now = new Date('2026-05-05T11:00:00Z');
    await runHealthCheck({
      pings: noopPings,
      resend: fake,
      generatePreamble: noPreamble,
      now,
    });
    const opts = fake.sendCalls[0]!.options as { idempotencyKey?: string };
    assert.equal(opts.idempotencyKey, 'health-summary-2026-05-05');
  });

  it('skips the second send when another run already claimed today (dedup)', async () => {
    // This is the regression that put two health-check emails in the
    // operator's inbox on 2026-05-07: pg-boss ran the cron handler
    // twice ~500ms apart, both reached `resend.emails.send` with the
    // same idempotency key, and Resend shipped both. The DB-backed
    // claim is the new boundary — only one of the two concurrent runs
    // is allowed to send.
    process.env.ADMIN_EMAILS = 'ops@example.com';
    const fake = makeResend();
    const seedExecute = (claim: ReadonlyArray<unknown>) => {
      EXECUTE.results = [
        [],
        [{ failed: 0, active_stuck: 0, active_total: 0, retry: 0 }],
        [{ last_discovered: new Date('2026-05-05T11:00:00Z') }],
        [{ cnt: 0 }],
        claim,
      ];
    };
    // First run wins the claim and sends.
    seedExecute(CLAIM_WON);
    const first = await runHealthCheck({
      pings: noopPings,
      resend: fake,
      generatePreamble: noPreamble,
      now: new Date('2026-05-05T11:00:00Z'),
    });
    assert.equal(first.emailSent, true);
    assert.equal(fake.sendCalls.length, 1);

    // Second run, ~500ms later, loses the claim and must skip.
    seedExecute(CLAIM_LOST);
    const second = await runHealthCheck({
      pings: noopPings,
      resend: fake,
      generatePreamble: noPreamble,
      now: new Date('2026-05-05T11:00:00.5Z'),
    });
    assert.equal(second.emailSent, false);
    assert.equal(
      fake.sendCalls.length,
      1,
      'second run must not call Resend when the daily claim is lost',
    );
  });

  it('skips the send when the claim INSERT throws (fail closed)', async () => {
    // A transient DB error on the claim must not silently degrade to
    // "send anyway" — that's the duplicate this guard exists to
    // prevent. We park an Error in the claim slot so the 5th execute
    // throws while the 4 prior checks succeed.
    process.env.ADMIN_EMAILS = 'ops@example.com';
    const fake = makeResend();
    EXECUTE.results = [
      [],
      [{ failed: 0, active_stuck: 0, active_total: 0, retry: 0 }],
      [{ last_discovered: new Date('2026-05-05T11:00:00Z') }],
      [{ cnt: 0 }],
      new Error('db boom'),
    ];
    const result = await runHealthCheck({
      pings: noopPings,
      resend: fake,
      generatePreamble: noPreamble,
    });
    assert.equal(result.emailSent, false);
    assert.equal(fake.sendCalls.length, 0);
  });

  it('marks emailSent=false when Resend send throws', async () => {
    process.env.ADMIN_EMAILS = 'ops@example.com';
    const fake = makeResend({ shouldThrow: true });
    const result = await runHealthCheck({ pings: noopPings, resend: fake, generatePreamble: noPreamble });
    assert.equal(result.emailSent, false);
    // Run still produced a summary — we don't throw.
    assert.ok(['ok', 'warn', 'fail', 'unknown'].includes(result.status));
  });

  it('marks emailSent=false when Resend returns an error envelope', async () => {
    process.env.ADMIN_EMAILS = 'ops@example.com';
    const fake = makeResend({ error: { message: 'rate limited' } });
    const result = await runHealthCheck({ pings: noopPings, resend: fake, generatePreamble: noPreamble });
    assert.equal(result.emailSent, false);
  });

  it('rolls up to fail when one check fails', async () => {
    EXECUTE.shouldThrow = new Error('connection refused');
    const result = await runHealthCheck({ pings: noopPings, resend: null, generatePreamble: noPreamble });
    assert.equal(result.status, 'fail');
    assert.ok(result.failCount >= 1);
  });

  it('subject reflects rollup status', async () => {
    // Trigger a failure on the first check (DB) only, leaving the
    // claim INSERT intact so the email still ships and we can inspect
    // its subject. Using the per-result Error pattern instead of
    // EXECUTE.shouldThrow keeps the claim slot reachable.
    process.env.ADMIN_EMAILS = 'ops@example.com';
    const fake = makeResend();
    EXECUTE.results = [
      new Error('boom'), // checkDatabaseConnectivity
      [{ failed: 0, active_stuck: 0, active_total: 0, retry: 0 }],
      [{ last_discovered: new Date(Date.now() - 60 * 60 * 1000) }],
      [{ cnt: 0 }],
      CLAIM_WON,
    ];
    await runHealthCheck({ pings: noopPings, resend: fake, generatePreamble: noPreamble });
    const sent = fake.sendCalls[0]!.payload as { subject: string };
    assert.match(sent.subject, /FAIL/);
  });

  it('passes preamble fn the rolled-up status + checks', async () => {
    process.env.ADMIN_EMAILS = 'ops@example.com';
    const fake = makeResend();
    let capturedStatus: string | null = null;
    let capturedCount = 0;
    const generatePreamble: RunHealthCheckOptions['generatePreamble'] = async (
      input,
    ) => {
      capturedStatus = input.status;
      capturedCount = input.checks.length;
      return 'shows/nightly is broken — go look.';
    };
    await runHealthCheck({
      pings: noopPings,
      resend: fake,
      generatePreamble,
    });
    assert.equal(capturedCount, 8);
    assert.ok(['ok', 'warn', 'fail', 'unknown'].includes(capturedStatus ?? ''));
  });

  it('still ships the email when preamble fn throws', async () => {
    process.env.ADMIN_EMAILS = 'ops@example.com';
    const fake = makeResend();
    const generatePreamble: RunHealthCheckOptions['generatePreamble'] = async () => {
      throw new Error('groq down');
    };
    const result = await runHealthCheck({
      pings: noopPings,
      resend: fake,
      generatePreamble,
    });
    assert.equal(result.emailSent, true);
    assert.equal(fake.sendCalls.length, 1);
  });
});

describe('defaultExternalPings.resend', () => {
  it('throws when no Resend client is configured', async () => {
    const pings = defaultExternalPings(null);
    await assert.rejects(pings.resend(), /RESEND_API_KEY unset/);
  });

  it('treats a send-only API key as reachable (Resend rejects domains.list)', async () => {
    const fake: ResendLike = {
      emails: { send: async () => ({ data: null, error: null }) },
      domains: {
        list: async () => ({
          data: null,
          error: { message: 'This API key is restricted to only send emails' },
        }),
      },
    };
    const pings = defaultExternalPings(fake);
    const result = (await pings.resend()) as { sendOnlyKey?: boolean };
    assert.equal(result.sendOnlyKey, true);
  });

  it('still surfaces unrelated Resend errors', async () => {
    const fake: ResendLike = {
      emails: { send: async () => ({ data: null, error: null }) },
      domains: {
        list: async () => ({ data: null, error: { message: 'rate limited' } }),
      },
    };
    const pings = defaultExternalPings(fake);
    await assert.rejects(pings.resend(), /rate limited/);
  });
});
