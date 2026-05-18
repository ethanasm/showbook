/**
 * Eyebrow — small-caps mono label used above hero titles and section headers.
 * Mirrors the web `.eyebrow` rule (11pt, 0.22em tracking, uppercase, accent).
 */

import React from 'react';
import { Text, type TextStyle, type StyleProp } from 'react-native';
import { useTheme } from '../../lib/theme';

interface EyebrowProps {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  color?: string;
}

export function Eyebrow({ children, style, color }: EyebrowProps): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <Text
      style={[
        {
          fontFamily: 'Geist Mono',
          fontSize: 11,
          fontWeight: '500',
          letterSpacing: 2.4,
          textTransform: 'uppercase',
          color: color ?? tokens.colors.accent,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
