/**
 * First-run step 4 of 4 — Gmail import (informational for M1).
 *
 * Real Gmail OAuth scope-elevation lands in M3. For now both buttons mark
 * first-run complete and route into the main app. The "Connect Gmail"
 * button shows a "Coming soon" inline note instead of triggering an OAuth
 * flow we haven't built yet.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { FirstRunStep, heroTitleStyle } from './_components';
import { useTheme } from '../../../lib/theme';
import { useAuth } from '../../../lib/auth';

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
  const [pending, setPending] = React.useState(false);
  const [showComingSoon, setShowComingSoon] = React.useState(false);

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

  const onPrimary = React.useCallback(() => {
    // Real Gmail OAuth flow lands in M3. For M1 just surface a brief
    // "Coming soon" then continue.
    setShowComingSoon(true);
    setTimeout(() => {
      void finish();
    }, 600);
  }, [finish]);

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
      <Text style={[styles.fineprint, { color: colors.faint }]}>
        Read-only access · we never store the email body.
      </Text>
      {showComingSoon ? (
        <Text style={[styles.comingSoon, { color: colors.accent }]}>Coming soon — finishing setup…</Text>
      ) : null}
    </View>
  );

  return (
    <FirstRunStep
      step={4}
      total={4}
      eyebrow="STEP 4 OF 4 · OPTIONAL"
      title={
        <Text style={[heroTitleStyle, { color: colors.ink, textAlign: 'center' }]}>
          Pull in <Text style={{ color: colors.accent }}>past tickets.</Text>
        </Text>
      }
      body="Showbook can scan your inbox for ticket confirmations from Ticketmaster, AXS, See Tickets, and Eventbrite — and pre-build your archive in seconds."
      illustration={illustration}
      primaryLabel="Connect Gmail"
      onPrimary={onPrimary}
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
    borderRadius: 8,
    borderWidth: 1,
  },
  emailDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  emailBody: {
    flex: 1,
    minWidth: 0,
  },
  emailFrom: {
    fontFamily: 'Geist Sans',
    fontSize: 10,
    fontWeight: '600',
  },
  emailSubj: {
    fontFamily: 'Geist Sans',
    fontSize: 9,
    fontWeight: '400',
    marginTop: 1,
  },
  matchTag: {
    fontFamily: 'Geist Sans',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  fineprint: {
    fontFamily: 'Geist Sans',
    fontSize: 10,
    fontWeight: '400',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 14,
  },
  comingSoon: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
  },
});
