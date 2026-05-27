/**
 * ScreenWrapper — the SafeArea + theme-bg + TopBar shell every full
 * screen was open-coding as:
 *
 *   <View style={{ flex:1, backgroundColor: colors.bg, paddingTop: insets.top }}>
 *     <TopBar title="…" eyebrow="…" />
 *     {body}
 *   </View>
 *
 * Centralises that pattern so screens only own their body, and gives
 * us one place to evolve the safe-area / chrome behaviour later.
 *
 * If a screen needs bespoke chrome (e.g. custom Pressable in place of
 * the TopBar) it can keep importing <TopBar> directly and skip this
 * wrapper.
 */

import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar, type TopBarProps } from './TopBar';
import { useTheme } from '@/lib/theme';

export interface ScreenWrapperProps extends Pick<TopBarProps, 'title' | 'eyebrow' | 'rightAction' | 'leading' | 'large'> {
  children: React.ReactNode;
  /**
   * Override the wrapper's outer style. Useful for screens that need
   * a different background (e.g. a media lightbox).
   */
  style?: StyleProp<ViewStyle>;
}

export function ScreenWrapper({
  title,
  eyebrow,
  rightAction,
  leading,
  large,
  children,
  style,
}: ScreenWrapperProps): React.JSX.Element {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        { flex: 1, backgroundColor: tokens.colors.bg, paddingTop: insets.top },
        style,
      ]}
    >
      <TopBar
        title={title}
        eyebrow={eyebrow}
        rightAction={rightAction}
        leading={leading}
        large={large}
      />
      {children}
    </View>
  );
}
