/**
 * Gmail integration manage screen — mobile mirror of the web Gmail
 * import modal in `apps/web/components/shows-list/ShowsListView.tsx`.
 *
 * Flow:
 *   1. Disclaimer + Connect → OAuth via `useGmailConnection`
 *   2. First-scan Groq disclosure (one-time, gated by
 *      `preferences.acceptedGmailScanAt`)
 *   3. Scan stream → results list (`GmailImportPicker`)
 *   4. Select + Import → bulk `shows.create`
 *   5. Done summary + "Import more"
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, Mail, RefreshCw } from 'lucide-react-native';

import { ExternalSourceDisclaimer } from '../../components/ExternalSourceDisclaimer';
import { GmailConsentSheet } from '../../components/GmailConsentSheet';
import { GmailImportPicker } from '../../components/gmail-import/GmailImportPicker';
import { OfflineEmptyState } from '../../components/OfflineEmptyState';
import { TopBar } from '../../components/TopBar';
import { useFeedback } from '../../lib/feedback';
import { useGmailConnection } from '../../lib/gmail-connection';
import { useGmailImport } from '../../lib/gmail-import/useGmailImport';
import { useNetwork } from '../../lib/network';
import { useTheme } from '../../lib/theme';
import { trpc } from '../../lib/trpc';

export default function GmailIntegrationScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const network = useNetwork();
  const { showToast } = useFeedback();
  const utils = trpc.useUtils();

  const prefsQuery = trpc.preferences.get.useQuery(undefined, {
    staleTime: 60_000,
  });
  const acceptGmailScan = trpc.preferences.acceptGmailScan.useMutation();

  const importFlow = useGmailImport({
    onImported: (summary) => {
      if (summary.added > 0) {
        showToast({
          kind: summary.failed > 0 ? 'info' : 'success',
          text:
            summary.failed > 0
              ? `Imported ${summary.added} · ${summary.failed} failed`
              : `Imported ${summary.added} show${summary.added === 1 ? '' : 's'}`,
        });
      } else if (summary.failed > 0) {
        showToast({
          kind: 'error',
          text: `Couldn't add ${summary.failed} show${summary.failed === 1 ? '' : 's'}`,
        });
      }
    },
  });

  const gmailConn = useGmailConnection();
  const [pendingToken, setPendingToken] = React.useState<string | null>(null);
  const [consentOpen, setConsentOpen] = React.useState(false);

  const hasAcceptedGroq = Boolean(
    prefsQuery.data?.preferences?.acceptedGmailScanAt,
  );

  const handleConnect = React.useCallback(async () => {
    const token = await gmailConn.connect();
    if (!token) return;
    if (hasAcceptedGroq) {
      void importFlow.runScan(token);
    } else {
      setPendingToken(token);
      setConsentOpen(true);
    }
  }, [gmailConn, hasAcceptedGroq, importFlow]);

  const handleAcceptConsent = React.useCallback(async () => {
    try {
      await acceptGmailScan.mutateAsync();
      await utils.preferences.get.invalidate();
      setConsentOpen(false);
      const token = pendingToken;
      setPendingToken(null);
      if (token) void importFlow.runScan(token);
    } catch {
      // Mutation surfaces its own error via the global haptic+toast
      // wrapper; keep the sheet open so the user can retry without
      // dropping the held token.
    }
  }, [acceptGmailScan, utils.preferences, pendingToken, importFlow]);

  const handleCancelConsent = React.useCallback(() => {
    setConsentOpen(false);
    setPendingToken(null);
  }, []);

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const back = (
    <Pressable
      onPress={() => router.back()}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={styles.back}
    >
      <ChevronLeft size={22} color={colors.ink} />
      <Text style={[styles.backLabel, { color: colors.muted, fontFamily: 'Geist Sans' }]}>
        Back
      </Text>
    </Pressable>
  );

  const renderBody = (): React.JSX.Element => {
    if (!network.online) {
      return (
        <OfflineEmptyState
          title="Connect Gmail when online"
          subtitle="The Gmail OAuth handshake and the scan stream both need a live connection."
        />
      );
    }

    if (importFlow.phase === 'scanning') {
      return (
        <View style={styles.scanning}>
          <ActivityIndicator color={colors.accent} />
          <Text
            style={[styles.scanningLabel, { color: colors.ink, fontFamily: 'Geist Sans' }]}
          >
            {importFlow.progress?.phase === 'processing'
              ? `Processing ${importFlow.progress.processed} of ${importFlow.progress.total}`
              : 'Searching Gmail for ticket emails…'}
          </Text>
          <Text
            style={[styles.scanningSub, { color: colors.muted, fontFamily: 'Geist Mono' }]}
          >
            {importFlow.progress?.found
              ? `${importFlow.progress.found} ticket${importFlow.progress.found === 1 ? '' : 's'} found so far`
              : 'This can take a minute on a big inbox.'}
          </Text>
          {importFlow.progress &&
          importFlow.progress.phase === 'processing' &&
          importFlow.progress.total > 0 ? (
            <View style={[styles.progressTrack, { backgroundColor: colors.rule }]}>
              <View
                style={[
                  styles.progressBar,
                  {
                    backgroundColor: colors.accent,
                    width: `${Math.round(
                      (importFlow.progress.processed / importFlow.progress.total) *
                        100,
                    )}%`,
                  },
                ]}
              />
            </View>
          ) : null}
        </View>
      );
    }

    if (importFlow.phase === 'picking' || importFlow.phase === 'importing') {
      return (
        <View style={[styles.pickerCard, { borderColor: colors.rule, backgroundColor: colors.surface }]}>
          <View style={[styles.pickerHeader, { borderBottomColor: colors.rule }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.pickerTitle, { color: colors.ink, fontFamily: 'Geist Sans' }]}>
                Review tickets
              </Text>
              <Text
                style={[styles.pickerSub, { color: colors.muted, fontFamily: 'Geist Mono' }]}
              >
                {importFlow.counts.total} found · uncheck what you don&apos;t want
              </Text>
            </View>
            <Pressable
              onPress={importFlow.reset}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Cancel import"
              disabled={importFlow.phase === 'importing'}
            >
              <Text style={[styles.pickerCancel, { color: colors.muted, fontFamily: 'Geist Mono' }]}>
                CANCEL
              </Text>
            </Pressable>
          </View>
          <GmailImportPicker flow={importFlow} />
          <View style={[styles.pickerFooter, { borderTopColor: colors.rule }]}>
            <Pressable
              onPress={importFlow.importSelected}
              disabled={
                importFlow.counts.selected === 0 || importFlow.phase === 'importing'
              }
              accessibilityRole="button"
              accessibilityLabel="Import selected"
              testID="gmail-import-submit"
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: colors.accent,
                  opacity:
                    importFlow.counts.selected === 0 || importFlow.phase === 'importing'
                      ? 0.4
                      : pressed
                        ? 0.85
                        : 1,
                },
              ]}
            >
              {importFlow.phase === 'importing' ? (
                <ActivityIndicator size="small" color={colors.accentText} />
              ) : (
                <Text style={[styles.primaryLabel, { color: colors.accentText, fontFamily: 'Geist Mono' }]}>
                  IMPORT {importFlow.counts.selected}{' '}
                  SHOW{importFlow.counts.selected === 1 ? '' : 'S'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      );
    }

    if (importFlow.phase === 'done') {
      const added = importFlow.importedSummary?.added ?? 0;
      return (
        <View style={styles.bodyPad}>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.rule },
            ]}
          >
            <Mail size={20} color={colors.accent} />
            <Text style={[styles.cardTitle, { color: colors.ink, fontFamily: 'Geist Sans' }]}>
              {added > 0 ? 'Imported successfully' : 'Nothing imported'}
            </Text>
            <Text style={[styles.cardBody, { color: colors.muted, fontFamily: 'Geist Sans' }]}>
              {added > 0
                ? `Added ${added} show${added === 1 ? '' : 's'} to your logbook.`
                : 'You can scan again any time — Gmail access is read-only.'}
            </Text>
            <View style={styles.actions}>
              <Pressable
                onPress={importFlow.reset}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.secondaryButton,
                  {
                    borderColor: colors.ruleStrong,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Text
                  style={[styles.secondaryLabel, { color: colors.ink, fontFamily: 'Geist Mono' }]}
                >
                  SCAN AGAIN
                </Text>
              </Pressable>
              <Pressable
                onPress={() => router.replace('/(tabs)/shows')}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: colors.accent,
                    opacity: pressed ? 0.85 : 1,
                    flexGrow: 1,
                  },
                ]}
              >
                <Text
                  style={[styles.primaryLabel, { color: colors.accentText, fontFamily: 'Geist Mono' }]}
                >
                  VIEW LOGBOOK
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      );
    }

    // idle
    return (
      <View style={styles.bodyPad}>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.rule },
          ]}
        >
          <Mail size={20} color={colors.ink} />
          <Text style={[styles.cardTitle, { color: colors.ink, fontFamily: 'Geist Sans' }]}>
            Import past shows from Gmail
          </Text>
          <Text style={[styles.cardBody, { color: colors.muted, fontFamily: 'Geist Sans' }]}>
            Showbook scans your inbox for ticket confirmations and pre-fills
            your logbook. You pick which ones to import — nothing is saved
            until you tap.
          </Text>
          <ExternalSourceDisclaimer source="gmail" />
          {importFlow.error || gmailConn.error ? (
            <Text
              accessibilityRole="alert"
              style={[styles.error, { color: colors.danger, fontFamily: 'Geist Mono' }]}
            >
              {importFlow.error ?? gmailConn.error}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            testID="gmail-connect-primary"
            onPress={() => {
              void handleConnect();
            }}
            disabled={gmailConn.busy}
            style={({ pressed }) => [
              styles.primaryButton,
              {
                backgroundColor: colors.accent,
                opacity: gmailConn.busy ? 0.6 : pressed ? 0.85 : 1,
                flexDirection: 'row',
                gap: 8,
              },
            ]}
          >
            {gmailConn.busy ? (
              <ActivityIndicator size="small" color={colors.accentText} />
            ) : (
              <>
                <RefreshCw size={13} color={colors.accentText} strokeWidth={2} />
                <Text
                  style={[styles.primaryLabel, { color: colors.accentText, fontFamily: 'Geist Mono' }]}
                >
                  {hasAcceptedGroq ? 'SCAN GMAIL' : 'CONTINUE WITH GMAIL'}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar title="Gmail" eyebrow="MANAGE INTEGRATION" leading={back} />
      {renderBody()}
      <GmailConsentSheet
        open={consentOpen}
        submitting={acceptGmailScan.isPending}
        onAccept={() => {
          void handleAcceptConsent();
        }}
        onCancel={handleCancelConsent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  backLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  bodyPad: {
    paddingHorizontal: 20,
    paddingTop: 20,
    flex: 1,
  },
  card: {
    padding: 20,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  cardBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  primaryButton: {
    marginTop: 4,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.7,
  },
  secondaryButton: {
    marginTop: 4,
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.7,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  error: {
    fontSize: 11,
    letterSpacing: 0.3,
    marginTop: 4,
  },
  scanning: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  scanningLabel: {
    fontSize: 15,
    textAlign: 'center',
  },
  scanningSub: {
    fontSize: 11,
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  progressTrack: {
    height: 3,
    width: '100%',
    overflow: 'hidden',
    marginTop: 12,
    maxWidth: 280,
  },
  progressBar: {
    height: '100%',
  },
  pickerCard: {
    flex: 1,
    minHeight: 0,
    margin: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  pickerTitle: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  pickerSub: {
    fontSize: 10.5,
    letterSpacing: 0.4,
    marginTop: 2,
  },
  pickerCancel: {
    fontSize: 10.5,
    fontWeight: '500',
    letterSpacing: 0.7,
  },
  pickerFooter: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
