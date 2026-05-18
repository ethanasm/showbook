/**
 * GradientEmphasis — wraps a string in a 135deg accent→theatre gradient
 * fill, mirroring the web `.gradient-emphasis` rule.
 *
 * Native (iOS/Android): uses `@react-native-masked-view/masked-view` with
 * an `expo-linear-gradient` fill so the gradient clips to the glyph shape.
 *
 * Web: `MaskedView` is not reliably supported on react-native-web, so we
 * fall back to a solid accent color. The web bundle is only used for
 * headless Playwright smoke checks (see apps/mobile/CLAUDE.md), so this
 * lighter visual is acceptable — the native build still gets the gradient.
 */

import React from 'react';
import { Platform, Text, type TextStyle, type StyleProp } from 'react-native';
import { useTheme } from '../../lib/theme';

interface GradientEmphasisProps {
  children: string;
  style?: StyleProp<TextStyle>;
}

export function GradientEmphasis({
  children,
  style,
}: GradientEmphasisProps): React.JSX.Element {
  const { tokens } = useTheme();
  const accent = tokens.colors.accent;
  const theatre = tokens.kindColor('theatre');

  if (Platform.OS === 'web') {
    // Solid accent fallback for the headless web bundle.
    return (
      <Text style={[style, { color: accent }]}>
        {children}
      </Text>
    );
  }

  // Lazy-require so the web bundle never tries to resolve the native
  // module path even when this branch isn't entered at runtime.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const MaskedView = require('@react-native-masked-view/masked-view').default as React.ComponentType<{
    maskElement: React.ReactNode;
    children: React.ReactNode;
    style?: StyleProp<TextStyle>;
  }>;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { LinearGradient } = require('expo-linear-gradient') as {
    LinearGradient: React.ComponentType<{
      colors: readonly [string, string, ...string[]];
      start?: { x: number; y: number };
      end?: { x: number; y: number };
      style?: StyleProp<TextStyle>;
      children?: React.ReactNode;
    }>;
  };

  // 135deg in CSS = top-left → bottom-right; in RN gradients that's
  // start={{x:0,y:0}} end={{x:1,y:1}}.
  return (
    <MaskedView
      maskElement={
        <Text style={[style, { backgroundColor: 'transparent' }]}>{children}</Text>
      }
    >
      <LinearGradient
        colors={[accent, theatre]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={style}
      >
        {/* The masked text inherits the gradient by clipping. We still
            need to render a Text with the same metrics so the gradient
            block sizes correctly. The text is transparent because the
            mask provides the visible glyphs. */}
        <Text style={[style, { opacity: 0 }]}>{children}</Text>
      </LinearGradient>
    </MaskedView>
  );
}
