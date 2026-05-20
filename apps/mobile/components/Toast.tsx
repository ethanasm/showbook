/**
 * Toast — top-anchored transient notification (4s default, auto-dismiss).
 *
 * Renders a stack of toasts read from useFeedback(). Place once in
 * app/_layout.tsx near the top of the tree (inside SafeAreaProvider).
 */

import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../lib/theme';
import { useFeedback } from '../lib/feedback';
import { feedbackVariantColors } from '../lib/toast-colors';
import { RADII } from '../lib/theme-utils';

export function ToastHost(): React.JSX.Element | null {
  const { toasts, dismissToast } = useFeedback();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();

  if (toasts.length === 0) return null;

  return (
    <View
      // Sit below the standard TopBar (~50 px tall) so the toast never
      // overlaps the screen title. Without this offset a field-level
      // error showed up across "New show" / "Edit show" titles on the
      // add/edit form because the host was anchored at insets.top + 8,
      // which is *inside* the topbar's vertical span.
      style={[styles.host, { top: insets.top + 56 }]}
      pointerEvents="box-none"
    >
      {toasts.map((t) => {
        const variant = feedbackVariantColors(t.kind, tokens.colors);
        // Action label is rendered on the same solid background as the
        // body text, so it has to use the same foreground. For the
        // success variant that's `accentText` (dark on gold); for
        // error it's white on red; for info it's ink on a neutral
        // surface — fall back to the brand accent there so the action
        // still pops.
        const actionColor =
          t.kind === 'info' ? tokens.colors.accent : variant.text;
        return (
          <Pressable
            key={t.id}
            onPress={() => dismissToast(t.id)}
            style={[
              styles.toast,
              {
                backgroundColor: variant.background,
                borderColor: variant.border,
              },
            ]}
          >
            <Text
              numberOfLines={4}
              ellipsizeMode="tail"
              style={{
                color: variant.text,
                fontFamily: 'Geist Sans',
                fontSize: 13,
                fontWeight: '500',
                flex: 1,
              }}
            >
              {t.text}
            </Text>
            {t.action ? (
              <Pressable
                onPress={() => {
                  t.action?.onPress();
                  dismissToast(t.id);
                }}
                hitSlop={8}
              >
                <Text
                  style={{
                    color: actionColor,
                    fontFamily: 'Geist Sans',
                    fontSize: 13,
                    fontWeight: '700',
                    marginLeft: 12,
                  }}
                >
                  {t.action.label}
                </Text>
              </Pressable>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 1000,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    borderRadius: RADII.lg,
    borderWidth: 1,
    // Lift the toast off the page so the user reads it as floating UI
    // rather than a page element. iOS uses shadow*; Android uses
    // elevation; react-native-web reads boxShadow if available.
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.18,
        shadowRadius: 12,
      },
      android: {
        elevation: 6,
      },
      default: {},
    }),
  },
});
