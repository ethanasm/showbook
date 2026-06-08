/**
 * PlaybillExtractSheet — theatre cast OCR entry point, the mobile twin of
 * the web Add flow's "Extract cast from playbill" upload. Mirrors the
 * layout of `FestivalPosterHowToSheet`, but the extraction runs inline:
 * pick a playbill photo → `enrichment.extractCast` (Groq vision) →
 * map the `{actor, role}` list to cast rows and hand them back to the
 * form. No separate route — the web flow is equally inline.
 */

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Drama } from 'lucide-react-native';

import { Sheet } from './Sheet';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { useFeedback } from '@/lib/feedback';
import { trpc } from '@/lib/trpc';
import { pickFestivalImage } from '@/lib/festival-lineup/pickFestivalImage';
import {
  castToPerformerRows,
  type ExtractedCastMember,
} from '@/lib/playbill/castToPerformerRows';
import { newPerformerRowId } from './LineupEditor';
import type { PerformerRow } from '@/lib/showForm';

export interface PlaybillExtractSheetProps {
  open: boolean;
  onClose: () => void;
  /** Called with the extracted cast rows when extraction succeeds. */
  onExtracted: (rows: PerformerRow[]) => void;
}

export function PlaybillExtractSheet({
  open,
  onClose,
  onExtracted,
}: PlaybillExtractSheetProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { showToast } = useFeedback();
  const [busy, setBusy] = React.useState(false);
  const extractCast = trpc.enrichment.extractCast.useMutation();

  const handlePick = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await pickFestivalImage();
      if (res.permissionDenied) {
        showToast({
          kind: 'error',
          text: 'Photos permission is required to upload a playbill.',
        });
        return;
      }
      if (res.cancelled || !res.image) return;

      const result = await extractCast.mutateAsync({
        imageBase64: res.image.base64,
      });
      const cast = (result?.cast ?? []) as ExtractedCastMember[];
      const rows = castToPerformerRows(cast, newPerformerRowId);
      if (rows.length === 0) {
        showToast({
          kind: 'error',
          text: 'No cast found in that image. Add the cast by hand instead.',
        });
        return;
      }
      onExtracted(rows);
      showToast({ kind: 'success', text: `Added ${rows.length} cast members.` });
      onClose();
    } catch {
      showToast({
        kind: 'error',
        text: "Couldn't read that playbill. Try again or add cast by hand.",
      });
    } finally {
      setBusy(false);
    }
  }, [busy, extractCast, onClose, onExtracted, showToast]);

  return (
    <Sheet open={open} onClose={onClose} snapPoints={['58%']}>
      <View style={styles.body} testID="playbill-extract-sheet">
        <View style={styles.header}>
          <View style={[styles.iconBubble, { backgroundColor: colors.accentFaded }]}>
            <Drama size={18} color={colors.accent} strokeWidth={1.8} />
          </View>
          <Text style={[styles.eyebrow, { color: colors.accent }]}>
            THEATRE · CAST · PLAYBILL
          </Text>
          <Text style={[styles.title, { color: colors.ink }]}>
            Read a playbill, get the cast
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Upload a photo of the playbill cast page and we&apos;ll pull out the
            principal cast and their roles. Tweak the list before saving — anything
            we miss, you can add by hand.
          </Text>
        </View>

        <View style={styles.footer}>
          <Pressable
            onPress={() => void handlePick()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Pick a playbill image"
            testID="playbill-extract-pick"
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: colors.accent, opacity: busy ? 0.7 : pressed ? 0.85 : 1 },
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.accentText} />
            ) : (
              <>
                <Drama size={16} color={colors.accentText} strokeWidth={2} />
                <Text style={[styles.ctaLabel, { color: colors.accentText }]}>
                  Pick a playbill
                </Text>
              </>
            )}
          </Pressable>
          <Text style={[styles.hint, { color: colors.faint }]}>
            JPG / PNG / HEIC. We skip ensemble, swings, and understudies.
          </Text>
        </View>
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
  eyebrow: {
    fontFamily: 'Geist Mono 600',
    fontSize: 11,
    letterSpacing: 1.4,
  },
  title: {
    fontFamily: 'Fraunces',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 26,
    letterSpacing: -0.3,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  subtitle: {
    fontFamily: 'Geist Sans',
    fontSize: 13.5,
    lineHeight: 19,
    textAlign: 'center',
    paddingHorizontal: 6,
  },
  footer: {
    alignItems: 'center',
    gap: 10,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: RADII.pill,
    minWidth: 200,
    minHeight: 44,
  },
  ctaLabel: {
    fontFamily: 'Geist Sans 600',
    fontSize: 14,
    letterSpacing: 0.1,
  },
  hint: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.4,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
});
