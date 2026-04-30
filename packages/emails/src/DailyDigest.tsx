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

export interface DailyDigestProps {
  displayName: string;
  todayShows: ReadonlyArray<{
    headliner: string;
    venueName: string;
    seat: string | null;
  }>;
  upcomingShows: ReadonlyArray<{
    headliner: string;
    venueName: string;
    dateLabel: string;
    daysUntil: number;
  }>;
  newAnnouncements: ReadonlyArray<{
    headliner: string;
    venueName: string;
    whenLabel: string;
    reason: 'venue' | 'artist';
    onSaleSoon: boolean;
  }>;
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
} as const;

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
    padding: '0',
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
    margin: '0 0 12px',
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
    margin: '2px 0 0',
  },
  rowAccent: {
    fontSize: '12px',
    color: C.accent,
    fontWeight: 600,
    letterSpacing: '0.02em',
    margin: '4px 0 0',
  },
  chip: {
    display: 'inline-block',
    padding: '2px 8px',
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: C.accentText,
    backgroundColor: C.accent,
    borderRadius: '999px',
    marginLeft: '8px',
    verticalAlign: '2px',
  },
  ctaWrap: {
    padding: '24px 32px 32px',
    textAlign: 'center' as const,
  },
  cta: {
    display: 'inline-block',
    padding: '12px 24px',
    fontSize: '13px',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    color: C.accentText,
    backgroundColor: C.accent,
    borderRadius: '2px',
    textDecoration: 'none',
  },
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

function Row({
  headliner,
  venueName,
  meta,
  accentMeta,
  chip,
}: {
  headliner: string;
  venueName: string;
  meta?: string;
  accentMeta?: string;
  chip?: string;
}) {
  return (
    <Section style={styles.rowWrap}>
      <Text style={styles.rowHead}>
        {headliner}
        {chip ? <span style={styles.chip}>{chip}</span> : null}
      </Text>
      <Text style={styles.rowMeta}>
        {venueName}
        {meta ? ` · ${meta}` : ''}
      </Text>
      {accentMeta ? <Text style={styles.rowAccent}>{accentMeta}</Text> : null}
    </Section>
  );
}

function todayDateLabel(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function DailyDigest({
  displayName,
  todayShows,
  upcomingShows,
  newAnnouncements,
  appUrl,
}: DailyDigestProps) {
  const todayCount = todayShows.length;
  const upcomingCount = upcomingShows.length;
  const announcementCount = newAnnouncements.length;

  const previewText =
    todayCount > 0
      ? `Tonight: ${todayShows.map((s) => s.headliner).join(', ')}`
      : announcementCount > 0
        ? `${announcementCount} new show${announcementCount === 1 ? '' : 's'} for you`
        : `${upcomingCount} upcoming show${upcomingCount === 1 ? '' : 's'} this week`;

  const byVenue = newAnnouncements.filter((a) => a.reason === 'venue');
  const byArtist = newAnnouncements.filter((a) => a.reason === 'artist');
  const onSaleSoon = newAnnouncements.filter((a) => a.onSaleSoon);

  const eyebrow =
    todayCount > 0
      ? 'Show day'
      : announcementCount > 0
        ? 'Just announced'
        : 'On the calendar';

  const headline =
    todayCount > 0
      ? todayCount === 1
        ? 'Tonight, the lights go down.'
        : `${todayCount} shows tonight.`
      : announcementCount > 0
        ? `${announcementCount} new ${announcementCount === 1 ? 'show' : 'shows'} you might want.`
        : upcomingCount > 0
          ? `${upcomingCount} ${upcomingCount === 1 ? 'show' : 'shows'} this week.`
          : 'Your week ahead.';

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
            <Text style={styles.wordmark}>Showbook</Text>
            <Text style={styles.dateLine}>{todayDateLabel()}</Text>
            <Hr style={styles.headerRule} />
          </Section>

          <Section style={styles.hero}>
            <Text style={styles.heroEyebrow}>{eyebrow}</Text>
            <Heading style={styles.heroHeadline}>{headline}</Heading>
            <Text style={styles.greet}>Hi {displayName} — here's what's on.</Text>
          </Section>

          {todayCount > 0 ? (
            <>
              <Hr style={styles.sectionDivider} />
              <Section style={styles.section}>
                <Text style={styles.sectionTitle}>Tonight</Text>
                {todayShows.map((s, i) => (
                  <Row
                    key={`today-${i}`}
                    headliner={s.headliner}
                    venueName={s.venueName}
                    accentMeta={s.seat ? `Seat · ${s.seat}` : undefined}
                  />
                ))}
              </Section>
            </>
          ) : null}

          {upcomingCount > 0 ? (
            <>
              <Hr style={styles.sectionDivider} />
              <Section style={styles.section}>
                <Text style={styles.sectionTitle}>Coming up this week</Text>
                {upcomingShows.map((s, i) => (
                  <Row
                    key={`upcoming-${i}`}
                    headliner={s.headliner}
                    venueName={s.venueName}
                    meta={`${s.dateLabel} · in ${s.daysUntil} day${s.daysUntil === 1 ? '' : 's'}`}
                  />
                ))}
              </Section>
            </>
          ) : null}

          {byVenue.length > 0 ? (
            <>
              <Hr style={styles.sectionDivider} />
              <Section style={styles.section}>
                <Text style={styles.sectionTitle}>At venues you follow</Text>
                {byVenue.map((a, i) => (
                  <Row
                    key={`venue-${i}`}
                    headliner={a.headliner}
                    venueName={a.venueName}
                    meta={a.whenLabel}
                    chip={a.onSaleSoon ? 'On sale soon' : undefined}
                  />
                ))}
              </Section>
            </>
          ) : null}

          {byArtist.length > 0 ? (
            <>
              <Hr style={styles.sectionDivider} />
              <Section style={styles.section}>
                <Text style={styles.sectionTitle}>By artists you follow</Text>
                {byArtist.map((a, i) => (
                  <Row
                    key={`artist-${i}`}
                    headliner={a.headliner}
                    venueName={a.venueName}
                    meta={a.whenLabel}
                    chip={a.onSaleSoon ? 'On sale soon' : undefined}
                  />
                ))}
              </Section>
            </>
          ) : null}

          {onSaleSoon.length > 0 &&
          byVenue.length === 0 &&
          byArtist.length === 0 ? (
            <>
              <Hr style={styles.sectionDivider} />
              <Section style={styles.section}>
                <Text style={styles.sectionTitle}>On sale this week</Text>
                {onSaleSoon.map((a, i) => (
                  <Row
                    key={`onsale-${i}`}
                    headliner={a.headliner}
                    venueName={a.venueName}
                    meta={a.whenLabel}
                    chip="On sale soon"
                  />
                ))}
              </Section>
            </>
          ) : null}

          <Section style={styles.ctaWrap}>
            <Link href={`${appUrl}/discover`} style={styles.cta}>
              Open Showbook
            </Link>
          </Section>

          <Section style={styles.footer}>
            <Text style={{ margin: 0, color: C.faint }}>
              You're receiving this because email notifications are on for your
              Showbook account.
            </Text>
            <Text style={{ margin: '8px 0 0', color: C.faint }}>
              <Link
                href={`${appUrl}/preferences`}
                style={styles.footerLink}
              >
                Manage notifications
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
