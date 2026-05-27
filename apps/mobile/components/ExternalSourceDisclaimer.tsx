/**
 * ExternalSourceDisclaimer — three-bullet "what we store / why /
 * how to revoke" block surfaced before any external-source connect
 * action. Web mirror lives at
 * `apps/web/components/external-connection/ExternalSourceDisclaimer.tsx`
 * — keep the copy in sync.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Database, Shield, Sparkles } from 'lucide-react-native';

import { useTheme } from '@/lib/theme';

export type ExternalSource = 'spotify' | 'setlistfm' | 'gmail' | 'eventbrite';

interface SourceCopy {
  store: string;
  use: string;
  revoke: string;
}

const COPY: Record<ExternalSource, SourceCopy> = {
  spotify: {
    store:
      "Your Spotify display name and an access token (we refresh it for you), plus the artists you've dismissed in import.",
    use: 'Builds Hype and Heard playlists, identifies songs, and surfaces show stats. We never post on your behalf.',
    revoke:
      'Disconnect anytime in Preferences — tokens are deleted within 30 days.',
  },
  setlistfm: {
    store:
      "Your setlist.fm username (no password, no token — it's the only credential setlist.fm uses).",
    use: "Pulls every concert you've marked attended on setlist.fm, including the setlist itself.",
    revoke: 'Change or clear it anytime in Preferences.',
  },
  gmail: {
    store:
      'Nothing from your inbox. We read tickets in real time and only persist the shows you tick to import.',
    use: 'Finds ticket confirmations from Ticketmaster, AXS, See Tickets, and Eventbrite to pre-fill your logbook.',
    revoke: 'Read-only access. Revoke anytime from your Google account.',
  },
  eventbrite: {
    store:
      'An access token to fetch your past Eventbrite orders. No order content is kept beyond the shows you save.',
    use: 'Backfills past Eventbrite orders into your logbook.',
    revoke: 'Revoke anytime from your Eventbrite account.',
  },
};

export function ExternalSourceDisclaimer({
  source,
}: {
  source: ExternalSource;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const copy = COPY[source];

  return (
    <View
      style={[styles.container, { borderTopColor: colors.rule }]}
      testID={`disclaimer-${source}`}
    >
      <Text
        style={[
          styles.eyebrow,
          { color: colors.muted, fontFamily: 'Geist Mono' },
        ]}
      >
        WHAT WE STORE
      </Text>
      <Row
        icon={<Database size={12} color={colors.muted} />}
        text={copy.store}
        inkColor={colors.ink}
      />
      <Row
        icon={<Sparkles size={12} color={colors.muted} />}
        text={copy.use}
        inkColor={colors.ink}
      />
      <Row
        icon={<Shield size={12} color={colors.muted} />}
        text={copy.revoke}
        inkColor={colors.ink}
      />
    </View>
  );
}

function Row({
  icon,
  text,
  inkColor,
}: {
  icon: React.ReactNode;
  text: string;
  inkColor: string;
}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <View style={styles.iconCell}>{icon}</View>
      <Text style={[styles.text, { color: inkColor, fontFamily: 'Geist Sans' }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 12,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  eyebrow: {
    fontSize: 10.5,
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  iconCell: {
    width: 16,
    marginTop: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
});
