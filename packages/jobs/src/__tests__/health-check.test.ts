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
  /** Every SQL object passed to db.execute, in order. Lets tests assert on
   *  the rendered query rather than only the scripted result. */
  captured: unknown[];
}
const EXECUTE: ScriptedExecute = { results: [], shouldThrow: null, captured: [] };

mock.module('@showbook/db', {
  namedExports: {
    db: {
      execute: async (q: unknown) => {
        EXECUTE.captured.push(q);
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

// Every scheduled queue checked by checkMissedSchedules — used to seed
// the "all schedules ran" DB result without caring which day-of-week the
// test runs on.
const ALL_SCHEDULED_QUEUES = [
  'shows/nightly',
  'enrichment/setlist-retry',
  'backfill/performer-images',
  'backfill/venue-photos',
  'notifications/daily-digest',
  'discover/ingest',
];

function freshSchedulesRows(at: Date = new Date()): Array<{ name: string; latest: Date }> {
  const latest = new Date(at.getTime() - 60 * 60 * 1000); // 1h ago
  return ALL_SCHEDULED_QUEUES.map((name) => ({ name, latest }));
}

beforeEach(() => {
  // Default: clean queue, fresh announcements, no stalled scrapes, every
  // scheduled queue has a recent firing.
  EXECUTE.results = [
    [], // checkDatabaseConnectivity SELECT 1
    [{ failed: 0, active_stuck: 0, active_total: 0, retry: 0 }], // pgboss queue
    [{ last_discovered: new Date(Date.now() - 60 * 60 * 1000) }], // freshness
    [{ cnt: 0 }], // stalled scrapes
    freshSchedulesRows(), // checkMissedSchedules pgboss.job / archive union
  ];
  EXECUTE.shouldThrow = null;
  EXECUTE.captured = [];
  delete process.env.RESEND_API_KEY;
  delete process.env.ADMIN_EMAILS;
  delete process.env.AXIOM_QUERY_TOKEN;
});

describe('runHealthCheck', () => {
  it('runs every check and rolls up status (ok when all clean and Axiom unset)', async () => {
    const result = await runHealthCheck({ pings: noopPings, resend: null, generatePreamble: noPreamble });
    // 6 ok (db, queue, freshness, stalled, missed_schedules, external)
    // + 2 unknown (the remaining axiom-backed checks: failed_jobs, error_volume).
    assert.equal(result.checks.length, 8);
    assert.equal(result.failCount, 0);
    assert.equal(result.unknownCount, 2);
    assert.equal(result.okCount, 6);
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

  it('uses the same idempotency key on a re-run within the same ET day', async () => {
    process.env.ADMIN_EMAILS = 'ops@example.com';
    const fake = makeResend();
    // First call at 07:00 ET.
    const seedExecute = () => {
      EXECUTE.results = [
        [],
        [{ failed: 0, active_stuck: 0, active_total: 0, retry: 0 }],
        [{ last_discovered: new Date('2026-05-05T11:00:00Z') }],
        [{ cnt: 0 }],
        freshSchedulesRows(new Date('2026-05-05T11:00:00Z')),
      ];
    };
    seedExecute();
    await runHealthCheck({
      pings: noopPings,
      resend: fake,
      generatePreamble: noPreamble,
      now: new Date('2026-05-05T11:00:00Z'),
    });
    seedExecute();
    // Hypothetical pg-boss retry one minute later — same ET day.
    await runHealthCheck({
      pings: noopPings,
      resend: fake,
      generatePreamble: noPreamble,
      now: new Date('2026-05-05T11:01:00Z'),
    });
    assert.equal(fake.sendCalls.length, 2);
    const k1 = (fake.sendCalls[0]!.options as { idempotencyKey?: string })
      .idempotencyKey;
    const k2 = (fake.sendCalls[1]!.options as { idempotencyKey?: string })
      .idempotencyKey;
    assert.equal(k1, k2);
    assert.equal(k1, 'health-summary-2026-05-05');
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
    process.env.ADMIN_EMAILS = 'ops@example.com';
    const fake = makeResend();
    EXECUTE.shouldThrow = new Error('boom');
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

describe('checkMissedSchedules SQL', () => {
  it('binds queue names via ARRAY[…], not a parenthesised tuple', async () => {
    // Regression for the prod warn surfaced in the morning health email:
    //   `name = ANY(($1, $2, $3, $4, $5))` — postgres reads the inner
    // tuple as a record literal and the join fails with SQLSTATE 42883
    // ("operator does not exist: text = record"). The fix renders an
    // explicit `ARRAY[$1, $2, …]` so each name is bound as a text param.
    const { PgDialect } = await import('drizzle-orm/pg-core');
    await runHealthCheck({ pings: noopPings, resend: null, generatePreamble: noPreamble });
    const dialect = new PgDialect();
    // The 5th db.execute call is checkMissedSchedules (after db ping,
    // pgboss queue, freshness, stalled).
    const sqlObj = EXECUTE.captured[4] as Parameters<typeof dialect.sqlToQuery>[0];
    const compiled = dialect.sqlToQuery(sqlObj);
    assert.match(compiled.sql, /ARRAY\[\$\d+(, \$\d+)+\]/);
    assert.doesNotMatch(compiled.sql, /ANY\(\(\$/);
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
