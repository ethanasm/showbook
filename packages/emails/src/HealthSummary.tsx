import * as React from 'react';
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

export type HealthCheckStatus = 'ok' | 'warn' | 'fail' | 'unknown';

export interface HealthCheckSummaryRow {
  name: string;
  status: HealthCheckStatus;
  summary: string;
  detail?: Record<string, unknown>;
}

export interface HealthSummaryProps {
  status: HealthCheckStatus;
  checks: ReadonlyArray<HealthCheckSummaryRow>;
  runAt: Date;
  appUrl: string;
  /** Optional 1–2 paragraph LLM-generated triage opener. Falls back to
   *  the deterministic count line when null. Paragraphs separated by a
   *  blank line, max 90 words (enforced upstream). */
  preamble?: string | null;
}

// Brand palette mirrors apps/web/app/globals.css (dark default).
const C = {
  bg: '#0C0C0C',
  surface: '#141414',
  ink: '#F5F5F3',
  muted: 'rgba(245,245,243,0.62)',
  faint: 'rgba(245,245,243,0.40)',
  rule: 'rgba(245,245,243,0.10)',
  ruleStrong: 'rgba(245,245,243,0.22)',
  accent: '#FFD166',
  accentText: '#0C0C0C',
  ok: '#7BC97B',
  warn: '#FFD166',
  fail: '#F47174',
  unknown: 'rgba(245,245,243,0.40)',
} as const;

const STATUS_COLORS: Record<HealthCheckStatus, string> = {
  ok: C.ok,
  warn: C.warn,
  fail: C.fail,
  unknown: C.unknown,
};

const STATUS_LABEL: Record<HealthCheckStatus, string> = {
  ok: 'OK',
  warn: 'WARN',
  fail: 'FAIL',
  unknown: '???',
};

const FONT_STACK =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const styles = {
  body: {
    backgroundColor: C.bg,
    fontFamily: FONT_STACK,
    color: C.ink,
    margin: 0,
    padding: '32px 0',
  },
  container: {
    backgroundColor: C.surface,
    maxWidth: '600px',
    margin: '0 auto',
    border: `1px solid ${C.rule}`,
    borderRadius: '4px',
    overflow: 'hidden',
  },
  header: {
    padding: '28px 32px 0',
  },
  wordmark: {
    fontSize: '12px',
    fontWeight: 700,
    color: C.accent,
    letterSpacing: '0.22em',
    textTransform: 'uppercase' as const,
    margin: 0,
  },
  dateLine: {
    fontSize: '12px',
    color: C.faint,
    letterSpacing: '0.04em',
    margin: '4px 0 0',
  },
  headerRule: {
    borderTop: `1px solid ${C.ruleStrong}`,
    borderBottom: 'none',
    borderLeft: 'none',
    borderRight: 'none',
    margin: '20px 0 0',
  },
  hero: {
    padding: '24px 32px 28px',
  },
  heroEyebrow: {
    fontSize: '11px',
    fontWeight: 700,
    color: C.accent,
    letterSpacing: '0.16em',
    textTransform: 'uppercase' as const,
    margin: '0 0 8px',
  },
  heroHeadline: {
    fontSize: '28px',
    fontWeight: 700,
    color: C.ink,
    letterSpacing: '-0.02em',
    lineHeight: '32px',
    margin: 0,
  },
  greet: {
    fontSize: '14px',
    color: C.muted,
    margin: '12px 0 0',
    lineHeight: '20px',
  },
  preamble: {
    fontSize: '15px',
    color: C.ink,
    margin: '16px 0 0',
    lineHeight: '24px',
    letterSpacing: '-0.005em',
  },
  preambleBreak: {
    fontSize: '15px',
    color: C.ink,
    margin: '10px 0 0',
    lineHeight: '24px',
    letterSpacing: '-0.005em',
  },
  section: {
    padding: '0 32px',
  },
  sectionDivider: {
    borderTop: `1px solid ${C.rule}`,
    borderBottom: 'none',
    borderLeft: 'none',
    borderRight: 'none',
    margin: '20px 32px 20px',
  },
  sectionTitle: {
    fontSize: '11px',
    fontWeight: 700,
    color: C.muted,
    letterSpacing: '0.14em',
    textTransform: 'uppercase' as const,
    margin: '0 0 14px',
  },
  rowWrap: {
    margin: '0 0 14px',
  },
  rowHead: {
    fontSize: '15px',
    fontWeight: 600,
    color: C.ink,
    letterSpacing: '-0.005em',
    lineHeight: '20px',
    margin: 0,
  },
  rowMeta: {
    fontSize: '13px',
    color: C.muted,
    lineHeight: '18px',
    margin: '4px 0 0',
  },
  rowDetail: {
    fontSize: '12px',
    color: C.faint,
    lineHeight: '16px',
    margin: '6px 0 0',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  badge: (status: HealthCheckStatus) =>
    ({
      display: 'inline-block',
      padding: '2px 8px',
      fontSize: '10px',
      fontWeight: 700,
      letterSpacing: '0.08em',
      textTransform: 'uppercase' as const,
      color: status === 'warn' ? C.accentText : C.ink,
      backgroundColor: STATUS_COLORS[status],
      borderRadius: '999px',
      marginRight: '8px',
      verticalAlign: '2px',
    }) as React.CSSProperties,
  ciRunWrap: {
    margin: '0 0 18px',
    paddingBottom: '14px',
    borderBottom: `1px solid ${C.rule}`,
  },
  ciRunHead: {
    fontSize: '15px',
    fontWeight: 600,
    color: C.ink,
    letterSpacing: '-0.005em',
    lineHeight: '20px',
    margin: 0,
  },
  ciRunMeta: {
    fontSize: '12px',
    color: C.faint,
    lineHeight: '16px',
    margin: '4px 0 0',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    wordBreak: 'break-word' as const,
  },
  ciJobRow: {
    fontSize: '13px',
    color: C.muted,
    lineHeight: '18px',
    margin: '8px 0 0',
    paddingLeft: '4px',
  },
  ciLink: {
    color: C.muted,
    textDecoration: 'underline',
  },
  jobBadge: (status: HealthCheckStatus) =>
    ({
      display: 'inline-block',
      padding: '1px 6px',
      fontSize: '9px',
      fontWeight: 700,
      letterSpacing: '0.06em',
      textTransform: 'uppercase' as const,
      color: status === 'warn' ? C.accentText : C.ink,
      backgroundColor: STATUS_COLORS[status],
      borderRadius: '999px',
      marginRight: '8px',
      verticalAlign: '1px',
    }) as React.CSSProperties,
  footer: {
    padding: '20px 32px 28px',
    borderTop: `1px solid ${C.rule}`,
    fontSize: '12px',
    color: C.faint,
    lineHeight: '18px',
    textAlign: 'center' as const,
  },
  footerLink: {
    color: C.muted,
    textDecoration: 'underline',
  },
} as const;

function formatRunAt(d: Date): string {
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function splitPreamble(text: string): string[] {
  return text
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .slice(0, 2);
}

function summarizeDetail(detail: Record<string, unknown> | undefined): string | null {
  if (!detail) return null;
  // Compact, single-line render — keep email small even when nested
  // arrays come back. Strings hit the wire as-is.
  try {
    const compact = JSON.stringify(detail);
    if (compact.length <= 240) return compact;
    return compact.slice(0, 237) + '…';
  } catch {
    return null;
  }
}

// ── CI health (GitHub Actions) rendering ───────────────────────────────
// The `ci_health` check ships a structured per-workflow / per-job payload
// in `detail.ci` (see packages/jobs/src/health-check/github.ts). The
// generic CheckRow truncates detail to 240 chars, which is useless for a
// nested job list — so we pull this check out and render it as its own
// section. These render types are a defensive local copy of the producer
// shape; `extractCiData` validates so a malformed payload can never throw
// inside the email.

interface CiJobView {
  name: string;
  status: string;
  conclusion: string | null;
  url: string | null;
}

interface CiRunView {
  workflowName: string;
  runNumber: number | null;
  status: string;
  conclusion: string | null;
  branch: string | null;
  commitSha: string | null;
  title: string | null;
  url: string | null;
  jobs: CiJobView[];
}

interface CiView {
  repo: string;
  branch: string;
  runs: CiRunView[];
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function extractCiData(detail: Record<string, unknown> | undefined): CiView | null {
  const ci = detail?.ci;
  if (!ci || typeof ci !== 'object') return null;
  const obj = ci as Record<string, unknown>;
  if (!Array.isArray(obj.runs)) return null;
  const runs: CiRunView[] = obj.runs.map((r) => {
    const run = (r ?? {}) as Record<string, unknown>;
    const jobsRaw = Array.isArray(run.jobs) ? run.jobs : [];
    return {
      workflowName: asString(run.workflowName) ?? '(unnamed workflow)',
      runNumber: typeof run.runNumber === 'number' ? run.runNumber : null,
      status: asString(run.status) ?? 'unknown',
      conclusion: asString(run.conclusion),
      branch: asString(run.branch),
      commitSha: asString(run.commitSha),
      title: asString(run.title),
      url: asString(run.url),
      jobs: jobsRaw.map((j) => {
        const job = (j ?? {}) as Record<string, unknown>;
        return {
          name: asString(job.name) ?? '(unnamed)',
          status: asString(job.status) ?? 'unknown',
          conclusion: asString(job.conclusion),
          url: asString(job.url),
        };
      }),
    };
  });
  return {
    repo: asString(obj.repo) ?? '',
    branch: asString(obj.branch) ?? '',
    runs,
  };
}

/** Map a GitHub Actions status/conclusion to a badge colour + label. */
function ciBadge(status: string, conclusion: string | null): {
  badge: HealthCheckStatus;
  label: string;
} {
  if (status !== 'completed' || conclusion === null) {
    return { badge: 'unknown', label: status.replace(/_/g, ' ') };
  }
  if (['failure', 'timed_out', 'startup_failure'].includes(conclusion)) {
    return { badge: 'fail', label: conclusion.replace(/_/g, ' ') };
  }
  if (['cancelled', 'action_required', 'stale'].includes(conclusion)) {
    return { badge: 'warn', label: conclusion.replace(/_/g, ' ') };
  }
  if (conclusion === 'success') return { badge: 'ok', label: 'success' };
  // skipped / neutral / anything else — informational, not a failure.
  return { badge: 'unknown', label: conclusion.replace(/_/g, ' ') };
}

function CiRun({ run }: { run: CiRunView }) {
  const { badge, label } = ciBadge(run.status, run.conclusion);
  const metaBits = [
    run.runNumber != null ? `#${run.runNumber}` : null,
    run.branch,
    run.commitSha,
    run.title,
  ].filter((b): b is string => Boolean(b));
  return (
    <Section style={styles.ciRunWrap}>
      <Text style={styles.ciRunHead}>
        <span style={styles.badge(badge)}>{label}</span>
        {run.url ? (
          <Link href={run.url} style={styles.ciLink}>
            {run.workflowName}
          </Link>
        ) : (
          run.workflowName
        )}
      </Text>
      {metaBits.length > 0 ? (
        <Text style={styles.ciRunMeta}>{metaBits.join(' · ')}</Text>
      ) : null}
      {run.jobs.map((job, i) => {
        const jb = ciBadge(job.status, job.conclusion);
        return (
          <Text key={`${run.workflowName}-job-${i}`} style={styles.ciJobRow}>
            <span style={styles.jobBadge(jb.badge)}>{jb.label}</span>
            {job.url ? (
              <Link href={job.url} style={styles.ciLink}>
                {job.name}
              </Link>
            ) : (
              job.name
            )}
          </Text>
        );
      })}
    </Section>
  );
}

function CiSection({ row }: { row: HealthCheckSummaryRow }) {
  const ci = extractCiData(row.detail);
  return (
    <>
      <Hr style={styles.sectionDivider} />
      <Section style={styles.section}>
        <Text style={styles.sectionTitle}>
          CI Health
          {ci?.branch ? ` · ${ci.branch}` : ''}
        </Text>
        <Text style={styles.rowMeta}>
          <span style={styles.badge(row.status)}>{STATUS_LABEL[row.status]}</span>
          {row.summary}
        </Text>
        {ci && ci.runs.length > 0
          ? ci.runs.map((run) => <CiRun key={run.workflowName} run={run} />)
          : null}
      </Section>
    </>
  );
}

function CheckRow({ row }: { row: HealthCheckSummaryRow }) {
  const detail = summarizeDetail(row.detail);
  return (
    <Section style={styles.rowWrap}>
      <Text style={styles.rowHead}>
        <span style={styles.badge(row.status)}>{STATUS_LABEL[row.status]}</span>
        {row.name}
      </Text>
      <Text style={styles.rowMeta}>{row.summary}</Text>
      {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
    </Section>
  );
}

export function HealthSummary({
  status,
  checks,
  runAt,
  appUrl,
  preamble,
}: HealthSummaryProps) {
  // CI health renders as its own section with a per-job breakdown, so
  // pull it out of the generic status buckets (it carries a large nested
  // detail payload the compact CheckRow can't show). It still counts
  // toward the hero's overall severity via `checks`.
  const ciCheck = checks.find((c) => c.name === 'ci_health');
  const generic = checks.filter((c) => c.name !== 'ci_health');
  const failing = generic.filter((c) => c.status === 'fail');
  const warning = generic.filter((c) => c.status === 'warn');
  const unknown = generic.filter((c) => c.status === 'unknown');
  const passing = generic.filter((c) => c.status === 'ok');

  // Hero counts span every check (CI included) so the headline matches the
  // rolled-up `status`, even when CI is the only thing failing.
  const allFailing = checks.filter((c) => c.status === 'fail').length;
  const allWarning = checks.filter((c) => c.status === 'warn').length;
  const allUnknown = checks.filter((c) => c.status === 'unknown').length;
  const allPassing = checks.filter((c) => c.status === 'ok').length;

  const previewText =
    status === 'fail'
      ? `${allFailing} failing check${allFailing === 1 ? '' : 's'}`
      : status === 'warn'
        ? `${allWarning} warning${allWarning === 1 ? '' : 's'}`
        : status === 'unknown'
          ? 'Health check could not query Axiom'
          : 'All checks passing';

  const eyebrow =
    status === 'fail'
      ? 'Action needed'
      : status === 'warn'
        ? 'Heads up'
        : status === 'unknown'
          ? 'Partial signal'
          : 'All good';

  const headline =
    status === 'fail'
      ? `${allFailing} failing · ${allWarning} warning`
      : status === 'warn'
        ? `${allWarning} warning${allWarning === 1 ? '' : 's'}`
        : status === 'unknown'
          ? 'Some checks could not be evaluated'
          : 'Everything looks healthy';

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="dark" />
        <meta name="supported-color-schemes" content="dark" />
      </Head>
      <Preview>{previewText}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.header}>
            <Text style={styles.wordmark}>Showbook · Health</Text>
            <Text style={styles.dateLine}>{formatRunAt(runAt)}</Text>
            <Hr style={styles.headerRule} />
          </Section>

          <Section style={styles.hero}>
            <Text style={styles.heroEyebrow}>{eyebrow}</Text>
            <Heading style={styles.heroHeadline}>{headline}</Heading>
            {preamble ? (
              splitPreamble(preamble).map((para, i) => (
                <Text
                  key={`preamble-${i}`}
                  style={i === 0 ? styles.preamble : styles.preambleBreak}
                >
                  {para}
                </Text>
              ))
            ) : (
              <Text style={styles.greet}>
                {allPassing}/{checks.length} checks passing
                {allUnknown > 0
                  ? ` · ${allUnknown} unknown (Axiom/GitHub token unset?)`
                  : ''}
              </Text>
            )}
          </Section>

          {ciCheck ? <CiSection row={ciCheck} /> : null}

          {failing.length > 0 ? (
            <>
              <Hr style={styles.sectionDivider} />
              <Section style={styles.section}>
                <Text style={styles.sectionTitle}>Failing</Text>
                {failing.map((c) => (
                  <CheckRow key={c.name} row={c} />
                ))}
              </Section>
            </>
          ) : null}

          {warning.length > 0 ? (
            <>
              <Hr style={styles.sectionDivider} />
              <Section style={styles.section}>
                <Text style={styles.sectionTitle}>Warning</Text>
                {warning.map((c) => (
                  <CheckRow key={c.name} row={c} />
                ))}
              </Section>
            </>
          ) : null}

          {unknown.length > 0 ? (
            <>
              <Hr style={styles.sectionDivider} />
              <Section style={styles.section}>
                <Text style={styles.sectionTitle}>Unknown</Text>
                {unknown.map((c) => (
                  <CheckRow key={c.name} row={c} />
                ))}
              </Section>
            </>
          ) : null}

          {passing.length > 0 ? (
            <>
              <Hr style={styles.sectionDivider} />
              <Section style={styles.section}>
                <Text style={styles.sectionTitle}>Passing</Text>
                {passing.map((c) => (
                  <CheckRow key={c.name} row={c} />
                ))}
              </Section>
            </>
          ) : null}

          <Section style={styles.footer}>
            <Text style={{ margin: 0, color: C.faint }}>
              Run at {formatRunAt(runAt)}.
            </Text>
            <Text style={{ margin: '8px 0 0', color: C.faint }}>
              <Link href={`${appUrl}/admin`} style={styles.footerLink}>
                Open admin
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
