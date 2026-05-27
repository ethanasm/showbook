/**
 * Button — pill-shaped action button matching the rest of the
 * pill-and-chip visual language (KindChip, StateChip, FilterChip,
 * EmptyState CTA). Replaces the rounded-rectangle inline buttons that
 * each screen was defining with `borderRadius: 8` or `12`.
 *
 * Variants:
 *   - `primary`  — accent fill, accentText label (default)
 *   - `secondary`— surface fill with a hairline ruleStrong border
 *   - `ghost`    — transparent, ruleStrong border (used as a quieter
 *                  destructive / cancel companion to a primary)
 *
 * Sizes:
 *   - `sm` — chip-adjacent (28pt min height, 12 / 6 padding)
 *   - `md` — default action button (40pt min height, 18 / 10 padding)
 *   - `lg` — hero CTA (52pt min height, 24 / 14 padding, 15pt label)
 *
 * `leftIcon` slot accepts a node rendered to the left of the label.
 * `loading` swaps the label for an ActivityIndicator; the icon still
 * collapses so the button width stays steady.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Spinner replaces the label and locks the button until cleared. */
  loading?: boolean;
  disabled?: boolean;
  /** Optional leading node (typically a lucide icon at 16pt). */
  leftIcon?: React.ReactNode;
  /** Stretches the button to fill its parent's cross-axis width. */
  fullWidth?: boolean;
  /**
   * Red border + red label on non-primary variants. No-op on `primary`
   * (destructive actions never use the accent fill).
   */
  danger?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}

const SIZE: Record<
  ButtonSize,
  { padV: number; padH: number; minH: number; font: number; iconGap: number }
> = {
  sm: { padV: 6, padH: 12, minH: 28, font: 12, iconGap: 6 },
  md: { padV: 10, padH: 18, minH: 40, font: 14, iconGap: 8 },
  lg: { padV: 14, padH: 24, minH: 52, font: 15, iconGap: 10 },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  leftIcon,
  fullWidth = false,
  danger = false,
  style,
  testID,
  accessibilityLabel,
}: ButtonProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const sizeStyle = SIZE[size];

  const dangerActive = danger && variant !== 'primary';

  const bg =
    variant === 'primary'
      ? colors.accent
      : variant === 'secondary'
        ? colors.surface
        : 'transparent';
  const fg = dangerActive
    ? colors.danger
    : variant === 'primary'
      ? colors.accentText
      : colors.ink;
  const borderColor = dangerActive
    ? colors.danger
    : variant === 'primary'
      ? 'transparent'
      : colors.ruleStrong;
  const borderWidth =
    variant === 'primary' ? 0 : StyleSheet.hairlineWidth;

  const isLocked = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isLocked}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isLocked, busy: loading }}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: bg,
          borderColor,
          borderWidth,
          paddingVertical: sizeStyle.padV,
          paddingHorizontal: sizeStyle.padH,
          minHeight: sizeStyle.minH,
          gap: sizeStyle.iconGap,
          opacity: isLocked ? 0.5 : pressed ? 0.85 : 1,
        },
        fullWidth && styles.fullWidth,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          {leftIcon ? <View style={styles.icon}>{leftIcon}</View> : null}
          <Text
            numberOfLines={1}
            style={{
              color: fg,
              fontFamily: 'Geist Sans',
              fontSize: sizeStyle.font,
              fontWeight: variant === 'primary' ? '700' : '600',
            }}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADII.pill,
    alignSelf: 'flex-start',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
