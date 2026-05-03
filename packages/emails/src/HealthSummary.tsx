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
}: HealthSummaryProps) {
  const failing = checks.filter((c) => c.status === 'fail');
  const warning = checks.filter((c) => c.status === 'warn');
  const unknown = checks.filter((c) => c.status === 'unknown');
  const passing = checks.filter((c) => c.status === 'ok');

  const previewText =
    status === 'fail'
      ? `${failing.length} failing check${failing.length === 1 ? '' : 's'}`
      : status === 'warn'
        ? `${warning.length} warning${warning.length === 1 ? '' : 's'}`
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
      ? `${failing.length} failing · ${warning.length} warning`
      : status === 'warn'
        ? `${warning.length} warning${warning.length === 1 ? '' : 's'}`
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
            <Text style={styles.greet}>
              {passing.length}/{checks.length} checks passing
              {unknown.length > 0
                ? ` · ${unknown.length} unknown (Axiom token unset?)`
                : ''}
            </Text>
          </Section>

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
