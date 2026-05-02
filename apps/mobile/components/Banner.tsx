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
import { useFeedback, type ToastKind } from '../lib/feedback';

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
      {banners.map((b) => (
        <View
          key={b.id}
          style={[
            styles.banner,
            {
              backgroundColor: bgFor(b.kind, colors),
              borderBottomColor: colors.ruleStrong,
            },
          ]}
        >
          <Text
            style={{
              color: colors.ink,
              fontFamily: 'Geist Sans',
              fontSize: 13,
              flex: 1,
            }}
          >
            {b.text}
          </Text>
          {b.action ? (
            <Pressable onPress={b.action.onPress} hitSlop={8}>
              <Text
                style={{
                  color: colors.accent,
                  fontFamily: 'Geist Sans',
                  fontSize: 13,
                  fontWeight: '600',
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
            <X size={16} color={colors.muted} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function bgFor(kind: ToastKind, colors: { surface: string; accentFaded: string; danger: string }): string {
  switch (kind) {
    case 'success':
      return colors.accentFaded;
    case 'error':
      return colors.danger + '22';
    default:
      return colors.surface;
  }
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
