/**
 * GradientEmphasis — wraps a string in a 135deg accent→theatre gradient
 * fill, mirroring the web `.gradient-emphasis` rule.
 *
 * Native (iOS/Android): uses `@react-native-masked-view/masked-view` with
 * an `expo-linear-gradient` fill so the gradient clips to the glyph shape.
 * Falls back to a solid accent color when the native view manager isn't
 * registered (web bundle, or a stale dev client built before the
 * dependency was added).
 */

import React from 'react';
import { Platform, Text, UIManager, type TextStyle, type StyleProp } from 'react-native';
import { useTheme } from '../../lib/theme';

interface GradientEmphasisProps {
  children: string;
  style?: StyleProp<TextStyle>;
}

// A native binary built before `@react-native-masked-view/masked-view` was
// added (PR #250) ships the JS module via Metro but lacks the registered
// native view manager, so rendering <MaskedView> throws "View config not
// found for component RNCMaskedView" and breaks the screen that calls it
// (e.g. show detail). Probe the registry up-front so older dev clients —
// and any future architecture where the manager fails to register — fall
// back to the solid accent fill instead of crashing.
function isMaskedViewAvailable(): boolean {
  if (Platform.OS === 'web') return false;
  try {
    const has = UIManager.hasViewManagerConfig;
    if (typeof has !== 'function') return false;
    return Boolean(has.call(UIManager, 'RNCMaskedView'));
  } catch {
    return false;
  }
}

export function GradientEmphasis({
  children,
  style,
}: GradientEmphasisProps): React.JSX.Element {
  const { tokens } = useTheme();
  const accent = tokens.colors.accent;
  const theatre = tokens.kindColor('theatre');

  if (!isMaskedViewAvailable()) {
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
