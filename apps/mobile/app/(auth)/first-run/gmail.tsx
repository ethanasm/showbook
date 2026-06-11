/**
 * First-run step 5 of 5 — Gmail import (informational).
 *
 * Mobile Gmail OAuth scope-elevation isn't built yet (tracked in
 * docs/specs/planned-improvements.md). To avoid teasing a feature
 * the user can't actually use, both CTAs simply mark first-run
 * complete and route into the main app — the illustration + body
 * still teach what the Gmail scan does on the web.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { FirstRunStep, heroTitleStyle } from './_components';
import { ExternalSourceDisclaimer } from '../../../components/ExternalSourceDisclaimer';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { useAuth } from '@/lib/auth';
import { useFirstRunFlow } from '@/lib/useFirstRunFlow';

interface MockEmail {
  from: string;
  subj: string;
  match: boolean;
}

const SAMPLE_EMAILS: MockEmail[] = [
  { from: 'Ticketmaster', subj: 'Your tickets for No Doubt · May 8', match: true },
  { from: 'AXS', subj: 'Order confirmed: Hadestown · Apr 18', match: true },
  { from: 'See Tickets', subj: 'Bleachers tickets · Sep 17', match: true },
  { from: 'Mom', subj: 'Re: Easter weekend?', match: false },
  { from: 'LinkedIn', subj: '5 new connection requests', match: false },
];

export default function FirstRunGmail(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const { markFirstRunComplete } = useAuth();
  const { position } = useFirstRunFlow();
  const pos = position('gmail');
  const [pending, setPending] = React.useState(false);

  const finish = React.useCallback(async () => {
    if (pending) return;
    setPending(true);
    try {
      await markFirstRunComplete();
      router.replace('/(tabs)');
    } finally {
      setPending(false);
    }
  }, [markFirstRunComplete, pending, router]);

  const illustration = (
    <View style={styles.emailList}>
      {SAMPLE_EMAILS.map((e) => {
        const borderColor = e.match ? colors.accent + '55' : colors.rule;
        const opacity = e.match ? 1 : 0.4;
        return (
          <View
            key={e.from + e.subj}
            style={[
              styles.emailRow,
              { backgroundColor: colors.surface, borderColor, opacity },
            ]}
          >
            <View
              style={[styles.emailDot, { backgroundColor: e.match ? colors.accent : colors.rule }]}
            />
            <View style={styles.emailBody}>
              <Text
                style={[
                  styles.emailFrom,
                  { color: e.match ? colors.ink : colors.muted },
                ]}
                numberOfLines={1}
              >
                {e.from}
              </Text>
              <Text style={[styles.emailSubj, { color: colors.muted }]} numberOfLines={1}>
                {e.subj}
              </Text>
            </View>
            {e.match ? (
              <Text style={[styles.matchTag, { color: colors.accent }]}>MATCH</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );

  return (
    <FirstRunStep
      step={pos.step}
      total={pos.total}
      eyebrow={`STEP ${pos.step} OF ${pos.total} · OPTIONAL`}
      title={
        <Text style={[heroTitleStyle, { color: colors.ink, textAlign: 'center' }]}>
          Pull in <Text style={{ color: colors.accent }}>past tickets.</Text>
        </Text>
      }
      body="On the web, Showbook can scan your inbox for ticket confirmations from Ticketmaster, AXS, See Tickets, and Eventbrite — and pre-build your archive in seconds. Mobile Gmail import is coming."
      illustration={illustration}
      footer={
        <View style={styles.disclaimerFooter}>
          <ExternalSourceDisclaimer source="gmail" />
        </View>
      }
      primaryLabel="Got it"
      onPrimary={() => void finish()}
      secondaryLabel="Start with an empty showbook"
      onSecondary={() => void finish()}
      pending={pending}
    />
  );
}

const styles = StyleSheet.create({
  emailList: {
    width: 240,
    gap: 6,
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: RADII.md,
    borderWidth: 1,
  },
  emailDot: {
    width: 6,
    height: 6,
    borderRadius: RADII.pill,
  },
  emailBody: {
    flex: 1,
    minWidth: 0,
  },
  emailFrom: {
    fontFamily: 'Geist Sans 600',
    fontSize: 10,
  },
  emailSubj: {
    fontFamily: 'Geist Sans 400',
    fontSize: 9,
    marginTop: 1,
  },
  matchTag: {
    fontFamily: 'Geist Sans 700',
    fontSize: 8,
    letterSpacing: 0.8,
  },
  disclaimerFooter: {
    width: '100%',
    maxWidth: 320,
    alignSelf: 'center',
  },
});
