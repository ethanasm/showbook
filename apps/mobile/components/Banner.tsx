/**
 * Banner — top-anchored persistent notification (no auto-dismiss).
 *
 * Use for ongoing state: offline, syncing, stale data, etc. Renders below
 * the safe area but above scroll content.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useTheme } from '../lib/theme';
import { useFeedback } from '../lib/feedback';
import { feedbackVariantColors } from '../lib/toast-colors';

export function BannerHost(): React.JSX.Element | null {
  const { banners, dismissBanner } = useFeedback();
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();

  if (banners.length === 0) return null;

  // Render absolute over the screen content so the banner doesn't push
  // a screen's TopBar below the fold (which would happen if we relied
  // on document flow + a paddingTop on the host). insets.top keeps the
  // banner clear of the notch / status bar; screens that need to know
  // the banner is present can read `useFeedback().banners`.
  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { top: insets.top }]}
    >
      {banners.map((b) => {
        const variant = feedbackVariantColors(b.kind, colors);
        // The dismiss "X" needs to sit on the same solid background as
        // the body text; use the variant foreground so it stays
        // readable on every kind.
        const iconColor = variant.text;
        const actionColor = b.kind === 'info' ? colors.accent : variant.text;
        return (
          <View
            key={b.id}
            style={[
              styles.banner,
              {
                backgroundColor: variant.background,
                borderBottomColor: colors.ruleStrong,
              },
            ]}
          >
            <Text
              style={{
                color: variant.text,
                fontFamily: 'Geist Sans',
                fontSize: 13,
                fontWeight: '500',
                flex: 1,
              }}
            >
              {b.text}
            </Text>
            {b.action ? (
              <Pressable onPress={b.action.onPress} hitSlop={8}>
                <Text
                  style={{
                    color: actionColor,
                    fontFamily: 'Geist Sans',
                    fontSize: 13,
                    fontWeight: '700',
                    marginLeft: 12,
                  }}
                >
                  {b.action.label}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => dismissBanner(b.id)}
              hitSlop={8}
              style={{ marginLeft: 12 }}
              accessibilityLabel="Dismiss"
            >
              <X size={16} color={iconColor} />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 999,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
});
