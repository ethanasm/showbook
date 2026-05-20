/**
 * GmailConsentSheet — one-time Groq disclosure (GDPR Art. 6 / Art. 28)
 * shown before the first Gmail scan. Mirrors the web GmailConsentModal
 * in `apps/web/components/shows-list/ShowsListView.tsx`.
 */

import React from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ShieldCheck } from 'lucide-react-native';

import { Sheet } from './Sheet';
import { useTheme } from '../lib/theme';
import { API_URL } from '../lib/env';

export interface GmailConsentSheetProps {
  open: boolean;
  submitting: boolean;
  onAccept: () => void;
  onCancel: () => void;
}

export function GmailConsentSheet({
  open,
  submitting,
  onAccept,
  onCancel,
}: GmailConsentSheetProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  return (
    <Sheet open={open} onClose={onCancel} snapPoints={['62%']}>
      <View style={styles.container}>
        <View style={styles.iconRow}>
          <ShieldCheck size={18} color={colors.ink} />
          <Text style={[styles.eyebrow, { color: colors.muted, fontFamily: 'Geist Mono' }]}>
            BEFORE WE SCAN YOUR EMAIL
          </Text>
        </View>

        <Text style={[styles.title, { color: colors.ink, fontFamily: 'Geist Sans' }]}>
          Tickets are extracted by AI
        </Text>

        <Text style={[styles.body, { color: colors.ink, fontFamily: 'Geist Sans' }]}>
          Showbook sends the matched email subject + body (first 8&nbsp;KB) to{' '}
          <Text style={styles.strong}>Groq</Text>, a third-party AI provider, to
          extract ticket details. We don&apos;t store the raw email — only the
          structured result you save.
        </Text>

        <Pressable
          onPress={() => {
            if (!API_URL) return;
            void Linking.openURL(`${API_URL}/privacy`);
          }}
          accessibilityRole="link"
        >
          <Text style={[styles.link, { color: colors.accent, fontFamily: 'Geist Mono' }]}>
            VIEW PRIVACY POLICY →
          </Text>
        </Pressable>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            testID="gmail-consent-cancel"
            onPress={onCancel}
            disabled={submitting}
            style={({ pressed }) => [
              styles.secondaryButton,
              { borderColor: colors.ruleStrong, opacity: submitting ? 0.5 : pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[styles.secondaryLabel, { color: colors.ink, fontFamily: 'Geist Mono' }]}>
              NOT NOW
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            testID="gmail-consent-accept"
            onPress={onAccept}
            disabled={submitting}
            style={({ pressed }) => [
              styles.primaryButton,
              {
                backgroundColor: colors.accent,
                opacity: submitting ? 0.6 : pressed ? 0.85 : 1,
              },
            ]}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={colors.accentText} />
            ) : (
              <Text style={[styles.primaryLabel, { color: colors.accentText, fontFamily: 'Geist Mono' }]}>
                ACCEPT AND SCAN
              </Text>
            )}
          </Pressable>
        </View>

        <View style={{ height: 16 }} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingTop: 12,
    gap: 12,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  eyebrow: {
    fontSize: 10.5,
    letterSpacing: 0.8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
  },
  strong: {
    fontWeight: '700',
  },
  link: {
    fontSize: 10.5,
    letterSpacing: 0.7,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 10,
  },
  primaryButton: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 160,
  },
  primaryLabel: {
    fontSize: 11,
    letterSpacing: 0.7,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: {
    fontSize: 11,
    letterSpacing: 0.7,
    fontWeight: '600',
  },
});
