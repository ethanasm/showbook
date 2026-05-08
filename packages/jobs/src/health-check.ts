import { Resend } from 'resend';
import {
  searchAttractions,
  searchArtist,
  pingGroq,
  parseAdminEmails,
  generateHealthSummaryPreamble,
} from '@showbook/api';
import { renderHealthSummary } from '@showbook/emails';
import { db, sql } from '@showbook/db';
import { child } from '@showbook/observability';
import {
  checkFailedJobs,
  checkMissedSchedules,
  checkErrorVolume,
  checkDatabaseConnectivity,
  checkPgBossQueue,
  checkDataFreshness,
  checkStalledScrapes,
  checkExternalApis,
  type CheckResult,
  type CheckStatus,
  type ExternalPingFns,
} from './health-check/checks';

const log = child({ component: 'health-check' });

export interface HealthCheckSummary {
  status: CheckStatus;
  checks: CheckResult[];
  okCount: number;
  warnCount: number;
  failCount: number;
  unknownCount: number;
  /** True when the rendered email was successfully delivered. False
   *  when delivery was skipped (no recipient/key configured) or the
   *  Resend call threw — Axiom logs are the source of truth either way. */
  emailSent: boolean;
}

/**
 * Default external-API ping wiring. Exposed as the orchestrator's
 * default; tests inject their own `ExternalPingFns` to avoid network
 * calls. The real pings hit the cheapest read endpoint each provider
 * offers so this stays well under any reasonable rate limit.
 */
export function defaultExternalPings(resend: ResendLike | null): ExternalPingFns {
  return {
    ticketmaster: async () => {
      // Cheap keyword lookup; the function returns [] when the API key
      // is missing, so guard explicitly so an unset key is reported
      // rather than silently passing.
      if (!process.env.TICKETMASTER_API_KEY) {
        throw new Error('TICKETMASTER_API_KEY unset');
      }
      const results = await searchAttractions('madison square garden');
      return { hits: results.length };
    },
    setlistfm: async () => {
      if (!process.env.SETLISTFM_API_KEY) {
        throw new Error('SETLISTFM_API_KEY unset');
      }
      const results = await searchArtist('radiohead');
      return { hits: results.length };
    },
    groq: async () => {
      if (!process.env.GROQ_API_KEY) {
        throw new Error('GROQ_API_KEY unset');
      }
      return pingGroq();
    },
    resend: async () => {
      if (!resend) throw new Error('RESEND_API_KEY unset');
      const res = await resend.domains.list();
      // A send-only API key (the recommended least-privilege configuration)
      // can authenticate but cannot list domains. Treat that specific
      // response as a successful reachability probe — the credential is
      // valid for the operation we actually depend on (sending email).
      if (res.error) {
        if (/restricted to only send emails/i.test(res.error.message)) {
          return { sendOnlyKey: true };
        }
        throw new Error(res.error.message);
      }
      const data = res.data as unknown;
      const count = Array.isArray(data)
        ? data.length
        : data && typeof data === 'object' && 'data' in data && Array.isArray((data as { data: unknown[] }).data)
          ? (data as { data: unknown[] }).data.length
          : 0;
      return { domains: count };
    },
  };
}

function rollupStatus(checks: readonly CheckResult[]): CheckStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail';
  if (checks.some((c) => c.status === 'warn')) return 'warn';
  if (checks.every((c) => c.status === 'unknown')) return 'unknown';
  return 'ok';
}

function logCheckOutcome(check: CheckResult): void {
  const event = `health.check.${check.name}.${check.status}`;
  const payload = { event, summary: check.summary, ...check.detail };
  if (check.status === 'fail') log.error(payload, check.summary);
  else if (check.status === 'warn') log.warn(payload, check.summary);
  else log.info(payload, check.summary);
}

/** Minimal subset of the Resend SDK we use for the health summary
 *  email and the resend ping. Defined as an interface so tests can
 *  inject a fake without mocking the SDK module. The optional second
 *  arg mirrors `Resend.emails.send`'s `IdempotentRequest` shape so the
 *  orchestrator can pass an idempotency key without dragging the full
 *  SDK type into this module. */
export interface ResendLike {
  emails: {
    send(
      payload: {
        from: string;
        to: string | string[];
        subject: string;
        html: string;
      },
      options?: { idempotencyKey?: string },
    ): Promise<{ data?: unknown; error?: { message: string } | null }>;
  };
  domains: {
    list(): Promise<{ data?: unknown; error?: { message: string } | null }>;
  };
}

/**
 * Calendar date `d` falls on in America/New_York, formatted YYYY-MM-DD.
 * Used as the dedup key for the morning email so any accidental re-run
 * within the same ET day (pg-boss retry, duplicate cron firing, two
 * boss instances racing) collapses into a single delivery.
 */
function etDateString(d: Date): string {
  const local = new Date(
    d.toLocaleString('en-US', { timeZone: 'America/New_York' }),
  );
  return local.toISOString().split('T')[0]!;
}

/**
 * Atomically claim the right to send today's morning summary. Inserts
 * a row into `health_summary_log` keyed on the ET calendar date; the PK
 * + ON CONFLICT DO NOTHING serialises concurrent runs through Postgres.
 *
 * Returns true when this caller won the race and should send the email,
 * false when another run already claimed today (in which case the
 * caller must skip the send — the winning run is already on the way).
 *
 * Why this exists despite the Resend idempotency key on `emails.send`:
 * the prior fix (PR #103) relied on Resend collapsing concurrent
 * idempotent requests, but in prod we observed two cron firings ~500ms
 * apart both succeeding with the same key and Resend shipping both
 * messages. Deduping at the DB before we ever call Resend is the
 * correct boundary; the idempotency key stays as belt-and-braces.
 */
async function claimDailySend(etDate: string): Promise<boolean> {
  const result = await db.execute(sql`
    INSERT INTO health_summary_log (et_date)
    VALUES (${etDate})
    ON CONFLICT (et_date) DO NOTHING
    RETURNING et_date
  `);
  // postgres-js returns the rows array directly; node-postgres wraps in
  // { rows }. Existing checks.ts handles both shapes the same way.
  const rows =
    (result as unknown as { rows?: unknown[] }).rows ??
    (result as unknown as unknown[]);
  return Array.isArray(rows) && rows.length > 0;
}

function getResend(): ResendLike | null {
  const key = process.env.RESEND_API_KEY;
  return key ? (new Resend(key) as unknown as ResendLike) : null;
}

/**
 * Recipients for the morning summary. Reuses the existing
 * `ADMIN_EMAILS` allowlist (the same list that gates the in-app Admin
 * tab + tRPC `adminProcedure`) so operators don't have to maintain a
 * second env var. Empty/unset → no recipients → email is skipped.
 */
function getRecipients(): string[] {
  return parseAdminEmails(process.env.ADMIN_EMAILS);
}

function getFromAddress(): string {
  return process.env.EMAIL_FROM ?? 'Showbook <digest@example.com>';
}

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://showbook.local';
}

export interface RunHealthCheckOptions {
  /** Override external-api pings for tests. */
  pings?: ExternalPingFns;
  /** Override "now" so day-of-week-sensitive checks (discover ingest)
   *  are deterministic in tests. */
  now?: Date;
  /** Override the Resend client for tests. When unset the orchestrator
   *  constructs one from `RESEND_API_KEY`; when null is supplied, email
   *  sending is skipped explicitly. */
  resend?: ResendLike | null;
  /** Override the LLM preamble generator for tests. Defaults to the
   *  Groq-backed `generateHealthSummaryPreamble`. Returns null on any
   *  error so the email still ships with the deterministic check list. */
  generatePreamble?: typeof generateHealthSummaryPreamble;
}

/**
 * Run every health check, log structured outcomes, and email a summary
 * to every address in `ADMIN_EMAILS`. Never throws — issues are
 * reported through the returned summary and through Axiom.
 */
export async function runHealthCheck(
  opts: RunHealthCheckOptions = {},
): Promise<HealthCheckSummary> {
  log.info({ event: 'health.check.start' }, 'Health check starting');

  const resend = opts.resend !== undefined ? opts.resend : getResend();
  const pings = opts.pings ?? defaultExternalPings(resend);
  const now = opts.now ?? new Date();

  // Run independent checks in parallel. Each check captures its own
  // errors and returns a CheckResult so a single hang in (say) Axiom
  // doesn't block the DB checks.
  const checks = await Promise.all([
    checkDatabaseConnectivity(),
    checkPgBossQueue(),
    checkDataFreshness(),
    checkStalledScrapes(),
    checkFailedJobs(),
    checkMissedSchedules(now),
    checkErrorVolume(),
    checkExternalApis(pings),
  ]);

  for (const c of checks) logCheckOutcome(c);

  const okCount = checks.filter((c) => c.status === 'ok').length;
  const warnCount = checks.filter((c) => c.status === 'warn').length;
  const failCount = checks.filter((c) => c.status === 'fail').length;
  const unknownCount = checks.filter((c) => c.status === 'unknown').length;
  const status = rollupStatus(checks);

  const recipients = getRecipients();
  let emailSent = false;

  if (!resend || recipients.length === 0) {
    log.warn(
      {
        event: 'health.check.email.skipped',
        hasResend: Boolean(resend),
        recipientCount: recipients.length,
      },
      'Health summary email skipped (RESEND_API_KEY or ADMIN_EMAILS unset)',
    );
  } else {
    const etDate = etDateString(now);
    let claimed = false;
    try {
      claimed = await claimDailySend(etDate);
    } catch (err) {
      // A failed claim attempt should not silently send anyway — that's
      // the duplicate this guard exists to prevent. Log and skip; the
      // operator will see `health.check.email.failed` and can re-run
      // manually if needed.
      log.error(
        { err, event: 'health.check.email.failed', etDate, reason: 'claim_failed' },
        'Failed to claim daily send slot; skipping email',
      );
    }

    if (!claimed) {
      // Another run already owns today's send. This is the path the
      // duplicate cron firings now take instead of double-sending.
      log.info(
        {
          event: 'health.check.email.skipped_duplicate',
          etDate,
          recipientCount: recipients.length,
        },
        'Health summary email skipped (already claimed for this ET day)',
      );
    } else {
      try {
        // Generate the LLM preamble before render. Catches its own errors
        // and returns null, so a Groq blip never blocks the email.
        const preambleFn = opts.generatePreamble ?? generateHealthSummaryPreamble;
        let preamble: string | null = null;
        try {
          preamble = await preambleFn({ status, checks });
        } catch (err) {
          log.warn(
            { err, event: 'health.check.preamble.failed' },
            'Preamble generation failed; falling back to deterministic email',
          );
        }

        const html = await renderHealthSummary({
          status,
          checks,
          runAt: now,
          appUrl: getAppUrl(),
          preamble,
        });
        const subject = formatSubject(status, failCount, warnCount);
        // Idempotency key derived from the same ET calendar date as the
        // claim above. The DB row is the primary dedup boundary; the
        // Resend key is defence in depth in case a future bug ever
        // manages to issue the send twice without a fresh DB claim
        // (e.g. a retry after the first response was lost).
        const idempotencyKey = `health-summary-${etDate}`;
        const sendResult = await resend.emails.send(
          {
            from: getFromAddress(),
            to: recipients,
            subject,
            html,
          },
          { idempotencyKey },
        );
        if (sendResult.error) {
          throw new Error(sendResult.error.message);
        }
        emailSent = true;
      } catch (err) {
        log.error(
          { err, event: 'health.check.email.failed' },
          'Failed to send health summary email',
        );
      }
    }
  }

  log.info(
    {
      event: 'health.check.summary',
      status,
      okCount,
      warnCount,
      failCount,
      unknownCount,
      emailSent,
    },
    `Health check complete (${status})`,
  );

  return { status, checks, okCount, warnCount, failCount, unknownCount, emailSent };
}

function formatSubject(
  status: CheckStatus,
  failCount: number,
  warnCount: number,
): string {
  const base = '[Showbook health]';
  if (status === 'fail') return `${base} FAIL — ${failCount} failing check${failCount === 1 ? '' : 's'}`;
  if (status === 'warn') return `${base} WARN — ${warnCount} warning${warnCount === 1 ? '' : 's'}`;
  if (status === 'unknown') return `${base} UNKNOWN — Axiom unreachable`;
  return `${base} OK`;
}

export const _testing = { rollupStatus, formatSubject, etDateString };
