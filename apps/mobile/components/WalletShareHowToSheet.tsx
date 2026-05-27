/**
 * WalletShareHowToSheet — explains the iOS share-sheet flow for
 * importing a `.pkpass` into Showbook.
 *
 * The wallet importer is share-sheet-only by design: Showbook
 * registers `com.apple.pkpass` as a document type
 * (`app.config.ts` → `CFBundleDocumentTypes`) and the deep-link
 * handler in `app/_layout.tsx` parses passes that iOS hands off via
 * "Open with". There's no in-app file picker — discovery is the
 * surfacing problem this sheet solves.
 *
 * Used by:
 *   - The "Import from Apple Wallet" door on the Add Show tab
 *     (`app/(tabs)/add.tsx`)
 *   - The "Ticket stub" row on past shows' Media tab
 *     (`components/show-tabs/MediaTab.tsx`)
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ticket } from 'lucide-react-native';

import { Sheet } from './Sheet';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';

export interface WalletShareHowToSheetProps {
  open: boolean;
  onClose: () => void;
}

const STEPS: { n: string; title: string; body: string }[] = [
  {
    n: '1',
    title: 'Open your ticket',
    body: 'Tap the .pkpass attachment in Mail or Messages, or open the pass inside Apple Wallet.',
  },
  {
    n: '2',
    title: 'Tap Share',
    body: 'Use the system share button (the square with an upward arrow).',
  },
  {
    n: '3',
    title: 'Choose Showbook',
    body: "Showbook appears in the share sheet. We'll pre-fill the form so you only have to confirm.",
  },
];

export function WalletShareHowToSheet({
  open,
  onClose,
}: WalletShareHowToSheetProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  return (
    <Sheet open={open} onClose={onClose} snapPoints={['62%']}>
      <View style={styles.body} testID="wallet-share-how-to-sheet">
        <View style={styles.header}>
          <View
            style={[styles.iconBubble, { backgroundColor: colors.accentFaded }]}
          >
            <Ticket size={18} color={colors.accent} strokeWidth={1.8} />
          </View>
          <Text style={[styles.title, { color: colors.ink }]}>
            Import from Apple Wallet
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Showbook reads ticket details from any .pkpass file you share to it
            — concerts, theatre, comedy, festivals.
          </Text>
        </View>

        <View style={styles.steps}>
          {STEPS.map((step) => (
            <View key={step.n} style={styles.step}>
              <View
                style={[
                  styles.stepBadge,
                  { borderColor: colors.rule, backgroundColor: colors.surface },
                ]}
              >
                <Text style={[styles.stepBadgeText, { color: colors.muted }]}>
                  {step.n}
                </Text>
              </View>
              <View style={styles.stepBody}>
                <Text style={[styles.stepTitle, { color: colors.ink }]}>
                  {step.title}
                </Text>
                <Text style={[styles.stepText, { color: colors.muted }]}>
                  {step.body}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Got it"
          testID="wallet-share-how-to-dismiss"
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.ctaLabel, { color: colors.accentText }]}>
            Got it
          </Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 8,
    gap: 22,
  },
  header: {
    alignItems: 'center',
    gap: 10,
  },
  iconBubble: {
    width: 40,
    height: 40,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'Fraunces',
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 24,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 6,
  },
  steps: {
    gap: 14,
  },
  step: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: RADII.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepBadgeText: {
    fontFamily: 'Geist Mono 600',
    fontSize: 11,
  },
  stepBody: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  stepTitle: {
    fontFamily: 'Geist Sans 600',
    fontSize: 14,
  },
  stepText: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    lineHeight: 18,
  },
  cta: {
    paddingVertical: 12,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: {
    fontFamily: 'Geist Sans 600',
    fontSize: 14,
    letterSpacing: 0.1,
  },
});
