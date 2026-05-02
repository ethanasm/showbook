/**
 * Toast — top-anchored transient notification (4s default, auto-dismiss).
 *
 * Renders a stack of toasts read from useFeedback(). Place once in
 * app/_layout.tsx near the top of the tree (inside SafeAreaProvider).
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../lib/theme';
import { useFeedback, type ToastKind } from '../lib/feedback';
import { RADII } from '../lib/theme-utils';

export function ToastHost(): React.JSX.Element | null {
  const { toasts, dismissToast } = useFeedback();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();

  if (toasts.length === 0) return null;

  return (
    <View
      style={[styles.host, { top: insets.top + 8 }]}
      pointerEvents="box-none"
    >
      {toasts.map((t) => (
        <Pressable
          key={t.id}
          onPress={() => dismissToast(t.id)}
          style={[
            styles.toast,
            {
              backgroundColor: bgFor(t.kind, tokens.colors),
              borderColor: tokens.colors.ruleStrong,
            },
          ]}
        >
          <Text
            style={{
              color: textFor(t.kind, tokens.colors),
              fontFamily: 'Geist Sans',
              fontSize: 13,
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
                  color: tokens.colors.accent,
                  fontFamily: 'Geist Sans',
                  fontSize: 13,
                  fontWeight: '600',
                  marginLeft: 12,
                }}
              >
                {t.action.label}
              </Text>
            </Pressable>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

function bgFor(kind: ToastKind, colors: { surface: string; accentFaded: string; danger: string }): string {
  switch (kind) {
    case 'success':
      return colors.accentFaded;
    case 'error':
      return colors.danger + '22'; // ~13% alpha
    default:
      return colors.surface;
  }
}

function textFor(kind: ToastKind, colors: { ink: string; danger: string }): string {
  if (kind === 'error') return colors.danger;
  return colors.ink;
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
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 8,
    borderRadius: RADII.lg,
    borderWidth: 1,
  },
});
