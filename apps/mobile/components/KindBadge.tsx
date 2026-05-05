/**
 * KindBadge — pill-shaped label for a show's kind (concert, theatre, etc.)
 *
 * Icon mapping (lucide-react-native equivalents for design Unicode placeholders):
 *   concert  ♫  → Music
 *   theatre  🎭 → Drama  (Drama exists in lucide-react-native; Theater is the US spelling variant)
 *   comedy   😂 → Smile
 *   festival ⛺ → Tent
 *   sports   ⚽ → Trophy (closest semantic match; soccer-ball glyph unavailable in lucide)
 *
 * Alpha bg: the design source uses `color + '22'` (hex literal 0x22 = 34/255 ≈ 13% opacity).
 * The design comment says "+22%" but the literal hex is 0x22, so we follow the literal.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Music, Drama, Smile, Tent, Trophy, Film, HelpCircle } from 'lucide-react-native';
import { useTheme } from '../lib/theme';
import { RADII } from '../lib/theme-utils';
import type { Kind } from '../lib/theme';

interface KindBadgeProps {
  kind: Kind;
  size?: 'sm' | 'md';
}

const KIND_LABEL: Record<Kind, string> = {
  concert: 'CONCERT',
  theatre: 'THEATRE',
  comedy: 'COMEDY',
  festival: 'FESTIVAL',
  sports: 'SPORTS',
  film: 'FILM',
  unknown: 'UNKNOWN',
};

type LucideIconComponent = React.ComponentType<{
  size?: number;
  color?: string;
  strokeWidth?: number;
}>;

const KIND_ICON: Record<Kind, LucideIconComponent> = {
  concert: Music,
  theatre: Drama,
  comedy: Smile,
  festival: Tent,
  sports: Trophy,
  film: Film,
  unknown: HelpCircle,
};

export function KindBadge({ kind, size = 'sm' }: KindBadgeProps): React.JSX.Element {
  const { tokens } = useTheme();
  const color = tokens.kindColor(kind);
  const IconComponent = KIND_ICON[kind];

  const isSm = size === 'sm';
  const fontSize = isSm ? 10.5 : 12;
  const iconSize = isSm ? 9.5 : 11;
  const paddingVertical = isSm ? 2 : 4;
  const paddingHorizontal = isSm ? 8 : 10;
  const gap = isSm ? 4 : 5;

  return (
    <View
      style={[
        styles.container,
        {
          // hex '22' = 0x22 = 34 alpha ≈ 13% opacity — matches design literal
          backgroundColor: color + '22',
          paddingVertical,
          paddingHorizontal,
          gap,
        },
      ]}
    >
      <IconComponent size={iconSize} color={color} strokeWidth={2.5} />
      <Text
        style={[
          styles.label,
          {
            fontSize,
            color,
            letterSpacing: fontSize * 0.06, // 0.06em equivalent
          },
        ]}
      >
        {KIND_LABEL[kind]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADII.pill,
    alignSelf: 'flex-start',
  },
  label: {
    fontFamily: 'Geist Sans',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
});
