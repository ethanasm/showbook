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

const styles = {
  body: {
    backgroundColor: '#f6f6f4',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    color: '#1a1a1a',
    margin: 0,
    padding: '24px 0',
  },
  container: {
    backgroundColor: '#ffffff',
    maxWidth: '560px',
    margin: '0 auto',
    padding: '32px 28px',
    border: '1px solid #e5e5e5',
  },
  heading: {
    fontSize: '20px',
    fontWeight: 600,
    margin: '0 0 6px',
    letterSpacing: '-0.01em',
  },
  greet: {
    fontSize: '14px',
    color: '#555',
    margin: '0 0 24px',
  },
  sectionTitle: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#666',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    margin: '0 0 10px',
  },
  row: {
    margin: '0 0 6px',
    fontSize: '14px',
    lineHeight: '20px',
  },
  rowHead: {
    fontWeight: 600,
    color: '#111',
  },
  rowMeta: {
    color: '#666',
  },
  hr: {
    borderColor: '#eaeaea',
    margin: '24px 0',
  },
  footer: {
    fontSize: '12px',
    color: '#888',
    marginTop: '24px',
    lineHeight: '18px',
  },
  link: {
    color: '#0a6cff',
    textDecoration: 'none',
  },
};

function ShowRow({
  headliner,
  venueName,
  meta,
}: {
  headliner: string;
  venueName: string;
  meta?: string;
}) {
  return (
    <Text style={styles.row}>
      <span style={styles.rowHead}>{headliner}</span>{' '}
      <span style={styles.rowMeta}>at {venueName}</span>
      {meta ? <span style={styles.rowMeta}> — {meta}</span> : null}
    </Text>
  );
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
      ? `Show day! ${todayShows.map((s) => s.headliner).join(', ')}`
      : announcementCount > 0
        ? `${announcementCount} new show${announcementCount === 1 ? '' : 's'} you might want`
        : `${upcomingCount} upcoming show${upcomingCount === 1 ? '' : 's'} this week`;

  const byVenue = newAnnouncements.filter((a) => a.reason === 'venue');
  const byArtist = newAnnouncements.filter((a) => a.reason === 'artist');
  const onSaleSoon = newAnnouncements.filter((a) => a.onSaleSoon);

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.heading}>
            {todayCount > 0 ? 'Show day' : 'Your Showbook digest'}
          </Heading>
          <Text style={styles.greet}>Hi {displayName},</Text>

          {todayCount > 0 ? (
            <Section>
              <Text style={styles.sectionTitle}>Today</Text>
              {todayShows.map((s, i) => (
                <ShowRow
                  key={`today-${i}`}
                  headliner={s.headliner}
                  venueName={s.venueName}
                  meta={s.seat ? `Seat ${s.seat}` : undefined}
                />
              ))}
            </Section>
          ) : null}

          {upcomingCount > 0 ? (
            <Section>
              {todayCount > 0 ? <Hr style={styles.hr} /> : null}
              <Text style={styles.sectionTitle}>Coming up this week</Text>
              {upcomingShows.map((s, i) => (
                <ShowRow
                  key={`upcoming-${i}`}
                  headliner={s.headliner}
                  venueName={s.venueName}
                  meta={`${s.dateLabel} (in ${s.daysUntil} day${s.daysUntil === 1 ? '' : 's'})`}
                />
              ))}
            </Section>
          ) : null}

          {byVenue.length > 0 ? (
            <Section>
              <Hr style={styles.hr} />
              <Text style={styles.sectionTitle}>At venues you follow</Text>
              {byVenue.map((a, i) => (
                <ShowRow
                  key={`venue-${i}`}
                  headliner={a.headliner}
                  venueName={a.venueName}
                  meta={a.whenLabel}
                />
              ))}
            </Section>
          ) : null}

          {byArtist.length > 0 ? (
            <Section>
              <Hr style={styles.hr} />
              <Text style={styles.sectionTitle}>By artists you follow</Text>
              {byArtist.map((a, i) => (
                <ShowRow
                  key={`artist-${i}`}
                  headliner={a.headliner}
                  venueName={a.venueName}
                  meta={a.whenLabel}
                />
              ))}
            </Section>
          ) : null}

          {onSaleSoon.length > 0 ? (
            <Section>
              <Hr style={styles.hr} />
              <Text style={styles.sectionTitle}>On sale this week</Text>
              {onSaleSoon.map((a, i) => (
                <ShowRow
                  key={`onsale-${i}`}
                  headliner={a.headliner}
                  venueName={a.venueName}
                  meta={a.whenLabel}
                />
              ))}
            </Section>
          ) : null}

          <Hr style={styles.hr} />
          <Text style={styles.footer}>
            <Link href={`${appUrl}/discover`} style={styles.link}>
              Open Showbook
            </Link>
            {' · '}
            <Link href={`${appUrl}/preferences`} style={styles.link}>
              Manage notifications
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
