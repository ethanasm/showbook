import { Resend } from 'resend';
import {
  searchAttractions,
  searchArtist,
  pingGroq,
  parseAdminEmails,
} from '@showbook/api';
import { renderHealthSummary } from '@showbook/emails';
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
      if (res.error) throw new Error(res.error.message);
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
 *  inject a fake without mocking the SDK module. */
export interface ResendLike {
  emails: {
    send(payload: {
      from: string;
      to: string | string[];
      subject: string;
      html: string;
    }): Promise<{ data?: unknown; error?: { message: string } | null }>;
  };
  domains: {
    list(): Promise<{ data?: unknown; error?: { message: string } | null }>;
  };
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
    try {
      const html = await renderHealthSummary({
        status,
        checks,
        runAt: now,
        appUrl: getAppUrl(),
      });
      const subject = formatSubject(status, failCount, warnCount);
      const sendResult = await resend.emails.send({
        from: getFromAddress(),
        to: recipients,
        subject,
        html,
      });
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

export const _testing = { rollupStatus, formatSubject };
