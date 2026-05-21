/**
 * FestivalPosterHowToSheet — bottom-sheet entry point for the festival
 * poster OCR flow, mirroring the layout of `WalletShareHowToSheet`.
 *
 * The picker runs inside the sheet so the user picks before any
 * navigation happens. On success we stash the picked image via
 * `posterHandoff` and push to `/add/festival-poster`, which consumes
 * the stash on mount and jumps straight into the extracting phase.
 */

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image as ImageIcon } from 'lucide-react-native';

import { Sheet } from './Sheet';
import { useTheme } from '../lib/theme';
import { useFeedback } from '../lib/feedback';
import { pickFestivalImage } from '../lib/festival-lineup/pickFestivalImage';
import { setPendingFestivalPoster } from '../lib/festival-lineup/posterHandoff';

export interface FestivalPosterHowToSheetProps {
  open: boolean;
  onClose: () => void;
}

export function FestivalPosterHowToSheet({
  open,
  onClose,
}: FestivalPosterHowToSheetProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const { showToast } = useFeedback();
  const [picking, setPicking] = React.useState(false);

  const handlePick = React.useCallback(async () => {
    if (picking) return;
    setPicking(true);
    try {
      const res = await pickFestivalImage();
      if (res.permissionDenied) {
        showToast({
          kind: 'error',
          text: 'Photos permission is required to upload a poster.',
        });
        return;
      }
      if (res.cancelled || !res.image) return;
      setPendingFestivalPoster(res.image);
      onClose();
      router.push('/add/festival-poster');
    } finally {
      setPicking(false);
    }
  }, [picking, router, showToast, onClose]);

  return (
    <Sheet open={open} onClose={onClose} snapPoints={['58%']}>
      <View style={styles.body} testID="festival-poster-how-to-sheet">
        <View style={styles.header}>
          <View style={[styles.iconBubble, { backgroundColor: colors.accentFaded }]}>
            <ImageIcon size={18} color={colors.accent} strokeWidth={1.8} />
          </View>
          <Text style={[styles.eyebrow, { color: colors.accent }]}>
            FESTIVAL · LINEUP · POSTER
          </Text>
          <Text style={[styles.title, { color: colors.ink }]}>
            Read a poster, get the lineup
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Upload a festival poster and we&apos;ll extract the artists, festival name,
            dates, and venue. Tweak the list before saving — anything we miss, you can
            add by hand.
          </Text>
        </View>

        <View style={styles.footer}>
          <Pressable
            onPress={() => void handlePick()}
            disabled={picking}
            accessibilityRole="button"
            accessibilityLabel="Pick a poster image"
            testID="festival-poster-how-to-pick"
            style={({ pressed }) => [
              styles.cta,
              {
                backgroundColor: colors.accent,
                opacity: picking ? 0.7 : pressed ? 0.85 : 1,
              },
            ]}
          >
            {picking ? (
              <ActivityIndicator size="small" color={colors.accentText} />
            ) : (
              <>
                <ImageIcon size={16} color={colors.accentText} strokeWidth={2} />
                <Text style={[styles.ctaLabel, { color: colors.accentText }]}>
                  Pick a poster
                </Text>
              </>
            )}
          </Pressable>
          <Text style={[styles.hint, { color: colors.faint }]}>
            JPG / PNG / HEIC, up to ~10 MB. Image only for now — PDF schedules will
            land later.
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
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: '600',
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
    borderRadius: 999,
    minWidth: 200,
    minHeight: 44,
  },
  ctaLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '600',
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
