import { sql } from 'drizzle-orm';
import { db } from '@showbook/db';
import { child } from '@showbook/observability';
import { queryAxiom as defaultQueryAxiom } from './axiom';

const log = child({ component: 'health-check.checks' });

/**
 * Subset of `queryAxiom` that the axiom-backed checks need. Accepted as
 * a parameter so tests can inject a scripted implementation without
 * mocking module resolution.
 */
export type QueryAxiomFn = typeof defaultQueryAxiom;

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'unknown';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  /** One-line summary suitable for the email subject line. */
  summary: string;
  /** Optional structured detail for the email body / Axiom log payload. */
  detail?: Record<string, unknown>;
}

// ── Axiom-backed checks ────────────────────────────────────────────────

interface FailedJobRow {
  _time: string | null;
  job: string | null;
  jobId: string | null;
  msg: string | null;
}

export async function checkFailedJobs(
  queryAxiom: QueryAxiomFn = defaultQueryAxiom,
): Promise<CheckResult> {
  const apl = `["showbook-prod"]
    | where _time > ago(24h) and event == "job.failed"
    | project _time, job, jobId, msg
    | order by _time desc
    | limit 50`;

  const res = await queryAxiom<FailedJobRow>(apl);
  if (res.skipped) {
    return {
      name: 'failed_jobs',
      status: 'unknown',
      summary: 'Axiom query token unset — skipped',
    };
  }
  if (!res.ok || res.rows === null) {
    return {
      name: 'failed_jobs',
      status: 'warn',
      summary: `Axiom query failed: ${res.error ?? 'unknown error'}`,
    };
  }

  const failures = res.rows;
  return {
    name: 'failed_jobs',
    status: failures.length === 0 ? 'ok' : 'fail',
    summary:
      failures.length === 0
        ? 'No failed jobs in last 24h'
        : `${failures.length} job failure${failures.length === 1 ? '' : 's'} in last 24h`,
    detail: { failures },
  };
}

interface ScheduledExpectation {
  /** Human-readable label for the scheduled run. */
  label: string;
  /** APL filter clause that uniquely identifies the run summary. Should
   *  match a single event (or event-prefix) the cron emits on success. */
  matchClause: string;
  /** Predicate run against the day-of-week (0=Sun..6=Sat) for the
   *  configured timezone. Returns true when the job is expected to have
   *  run in the prior 24h. Defaults to "every day". */
  expectedOnDay?: (dow: number) => boolean;
}

const SCHEDULED_EXPECTATIONS: readonly ScheduledExpectation[] = [
  { label: 'shows-nightly', matchClause: 'event == "shows.nightly.summary"' },
  {
    label: 'setlist-retry',
    matchClause: 'event == "setlist.retry.summary"',
  },
  {
    label: 'backfill-performer-images',
    matchClause: 'event == "backfill.performer_images.summary"',
  },
  {
    label: 'backfill-venue-photos',
    matchClause: 'event == "backfill.venue_photos.summary"',
  },
  {
    label: 'daily-digest',
    matchClause: 'event == "notifications.digest.summary"',
  },
  {
    label: 'discover-ingest',
    matchClause: 'event startswith "discover.ingest." and event endswith ".summary"',
    // Discover ingest is scheduled `0 6 * * 1` — Mondays only. We run at
    // 7am Tuesday, so the Tuesday run is the one that should have seen
    // the ingest in its 24h window.
    expectedOnDay: (dow) => dow === 2,
  },
];

interface ScheduleHitRow {
  cnt: number | null;
}

export async function checkMissedSchedules(
  now: Date = new Date(),
  queryAxiom: QueryAxiomFn = defaultQueryAxiom,
): Promise<CheckResult> {
  const etDow = etDayOfWeek(now);
  const expected = SCHEDULED_EXPECTATIONS.filter((e) =>
    e.expectedOnDay ? e.expectedOnDay(etDow) : true,
  );

  const missing: string[] = [];
  let queryFailures = 0;
  let skipped = 0;

  for (const exp of expected) {
    const apl = `["showbook-prod"]
      | where _time > ago(24h) and ${exp.matchClause}
      | summarize cnt = count()`;
    const res = await queryAxiom<ScheduleHitRow>(apl);
    if (res.skipped) {
      skipped++;
      continue;
    }
    if (!res.ok || res.rows === null) {
      queryFailures++;
      continue;
    }
    const cnt = Number(res.rows[0]?.cnt ?? 0);
    if (cnt === 0) missing.push(exp.label);
  }

  if (skipped === expected.length) {
    return {
      name: 'missed_schedules',
      status: 'unknown',
      summary: 'Axiom query token unset — skipped',
    };
  }

  if (queryFailures > 0 && missing.length === 0) {
    return {
      name: 'missed_schedules',
      status: 'warn',
      summary: `${queryFailures} schedule check${queryFailures === 1 ? '' : 's'} couldn't reach Axiom`,
    };
  }

  return {
    name: 'missed_schedules',
    status: missing.length === 0 ? 'ok' : 'fail',
    summary:
      missing.length === 0
        ? 'All expected scheduled jobs ran in last 24h'
        : `Missing scheduled runs: ${missing.join(', ')}`,
    detail: { missing, queryFailures, expected: expected.map((e) => e.label) },
  };
}

interface ErrorVolumeRow {
  event: string | null;
  component: string | null;
  cnt: number | null;
}

export async function checkErrorVolume(
  queryAxiom: QueryAxiomFn = defaultQueryAxiom,
): Promise<CheckResult> {
  const apl = `["showbook-prod"]
    | where _time > ago(24h) and level == "error"
    | summarize cnt = count() by event, component
    | order by cnt desc
    | limit 10`;

  const res = await queryAxiom<ErrorVolumeRow>(apl);
  if (res.skipped) {
    return {
      name: 'error_volume',
      status: 'unknown',
      summary: 'Axiom query token unset — skipped',
    };
  }
  if (!res.ok || res.rows === null) {
    return {
      name: 'error_volume',
      status: 'warn',
      summary: `Axiom query failed: ${res.error ?? 'unknown error'}`,
    };
  }

  const total = res.rows.reduce((sum, r) => sum + Number(r.cnt ?? 0), 0);
  // Threshold is intentionally lenient — anything that warrants paging
  // already shows up under failed_jobs / missed_schedules. This gauge
  // surfaces noisy regressions (e.g. a flap on geocode.* after a config
  // change) without crying wolf on routine retries.
  const status: CheckStatus =
    total === 0 ? 'ok' : total < 50 ? 'ok' : total < 250 ? 'warn' : 'fail';
  return {
    name: 'error_volume',
    status,
    summary: `${total} error log${total === 1 ? '' : 's'} in last 24h${
      res.rows[0] && total > 0 ? ` (top: ${res.rows[0].event ?? '(unset)'})` : ''
    }`,
    detail: { total, top: res.rows },
  };
}

// ── DB-backed checks (work without Axiom) ──────────────────────────────

export async function checkDatabaseConnectivity(): Promise<CheckResult> {
  try {
    await db.execute(sql`select 1`);
    return {
      name: 'database',
      status: 'ok',
      summary: 'Postgres reachable',
    };
  } catch (err) {
    log.error({ err, event: 'health.check.database.failed' }, 'DB ping failed');
    return {
      name: 'database',
      status: 'fail',
      summary: `Postgres unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

interface QueueRow {
  failed: number;
  active_stuck: number;
  active_total: number;
  retry: number;
}

export async function checkPgBossQueue(): Promise<CheckResult> {
  try {
    const result = await db.execute(sql`
      select
        count(*) filter (where state = 'failed') as failed,
        count(*) filter (where state = 'active' and "createdOn" < now() - interval '2 hours') as active_stuck,
        count(*) filter (where state = 'active') as active_total,
        count(*) filter (where state = 'retry') as retry
      from pgboss.job
    `);
    const row = (result as unknown as { rows?: QueueRow[] }).rows?.[0] ??
      (result as unknown as QueueRow[])[0];
    if (!row) {
      return {
        name: 'pgboss_queue',
        status: 'warn',
        summary: 'pgboss.job query returned no rows',
      };
    }
    const failed = Number(row.failed);
    const stuck = Number(row.active_stuck);
    const active = Number(row.active_total);
    const retry = Number(row.retry);

    const status: CheckStatus =
      stuck > 0 || failed > 5 ? 'fail' : failed > 0 || retry > 5 ? 'warn' : 'ok';
    return {
      name: 'pgboss_queue',
      status,
      summary:
        status === 'ok'
          ? 'Queue healthy'
          : `${stuck} stuck active · ${failed} failed · ${retry} retrying`,
      detail: { failed, active_stuck: stuck, active_total: active, retry },
    };
  } catch (err) {
    log.error(
      { err, event: 'health.check.pgboss.failed' },
      'pgboss.job inspection failed',
    );
    return {
      name: 'pgboss_queue',
      status: 'warn',
      summary: `Could not inspect pgboss.job: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

interface FreshnessRow {
  last_discovered: string | Date | null;
}

export async function checkDataFreshness(): Promise<CheckResult> {
  try {
    const result = await db.execute(sql`
      select max(discovered_at) as last_discovered from announcements
    `);
    const row = (result as unknown as { rows?: FreshnessRow[] }).rows?.[0] ??
      (result as unknown as FreshnessRow[])[0];
    const last = row?.last_discovered;
    if (!last) {
      return {
        name: 'data_freshness',
        status: 'warn',
        summary: 'No announcements have ever been discovered',
      };
    }
    const lastMs = last instanceof Date ? last.getTime() : new Date(last).getTime();
    const ageHours = (Date.now() - lastMs) / (1000 * 60 * 60);
    // Discover ingest runs Monday only, so up to ~7d gap is normal.
    const status: CheckStatus =
      ageHours < 8 * 24 ? 'ok' : ageHours < 14 * 24 ? 'warn' : 'fail';
    return {
      name: 'data_freshness',
      status,
      summary: `Last announcement discovered ${formatAge(ageHours)} ago`,
      detail: { lastDiscoveredAt: new Date(lastMs).toISOString(), ageHours },
    };
  } catch (err) {
    return {
      name: 'data_freshness',
      status: 'warn',
      summary: `Could not query announcements: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

interface StalledScrapeRow {
  cnt: number;
}

export async function checkStalledScrapes(): Promise<CheckResult> {
  try {
    const result = await db.execute(sql`
      select count(*)::int as cnt
      from venue_scrape_runs
      where status = 'running' and started_at < now() - interval '1 hour'
    `);
    const row = (result as unknown as { rows?: StalledScrapeRow[] }).rows?.[0] ??
      (result as unknown as StalledScrapeRow[])[0];
    const cnt = Number(row?.cnt ?? 0);
    return {
      name: 'stalled_scrapes',
      status: cnt === 0 ? 'ok' : 'warn',
      summary:
        cnt === 0
          ? 'No stalled scrape runs'
          : `${cnt} scrape run${cnt === 1 ? '' : 's'} stuck > 1h`,
      detail: { stalled: cnt },
    };
  } catch (err) {
    return {
      name: 'stalled_scrapes',
      status: 'warn',
      summary: `Could not query venue_scrape_runs: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── External-API ping check ───────────────────────────────────────────

export interface ExternalPingFns {
  ticketmaster: () => Promise<unknown>;
  setlistfm: () => Promise<unknown>;
  groq: () => Promise<unknown>;
  resend: () => Promise<unknown>;
}

export async function checkExternalApis(
  pings: ExternalPingFns,
): Promise<CheckResult> {
  const entries: Array<[keyof ExternalPingFns, () => Promise<unknown>]> = [
    ['ticketmaster', pings.ticketmaster],
    ['setlistfm', pings.setlistfm],
    ['groq', pings.groq],
    ['resend', pings.resend],
  ];

  const results = await Promise.allSettled(entries.map(([, fn]) => fn()));
  const perApi: Record<string, { ok: boolean; error?: string }> = {};
  const failed: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const [name] = entries[i]!;
    const result = results[i]!;
    if (result.status === 'fulfilled') {
      perApi[name] = { ok: true };
    } else {
      const error =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      perApi[name] = { ok: false, error };
      failed.push(name);
    }
  }

  return {
    name: 'external_apis',
    status: failed.length === 0 ? 'ok' : failed.length < entries.length ? 'warn' : 'fail',
    summary:
      failed.length === 0
        ? `All ${entries.length} external APIs reachable`
        : `${failed.length}/${entries.length} external APIs failing: ${failed.join(', ')}`,
    detail: { perApi },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Day-of-week (0=Sun..6=Sat) for the configured timezone. The cron is
 * scheduled in America/New_York, so we evaluate "expected today?" in ET
 * regardless of the host's local TZ.
 */
function etDayOfWeek(now: Date): number {
  const etStr = now.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  });
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[etStr] ?? 0;
}

function formatAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

export const _testing = { etDayOfWeek, formatAge, SCHEDULED_EXPECTATIONS };
