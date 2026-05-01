/**
 * StateChip — compact status label for a show's lifecycle state.
 *
 * Renders null for 'past' (no chip needed per design).
 * 'wishlist' state: transparent bg, ruleStrong border, ink text, "WISHLIST" label.
 * Note: ShowState from @showbook/shared has: past | ticketed | watching.
 * 'wishlist' is a display-only state used in the UI (not yet in the DB enum);
 * we accept it as a string union extension here for forward-compat.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Check, Eye, Bookmark } from 'lucide-react-native';
import { useTheme } from '../lib/theme';
import type { ShowState } from '../lib/theme';

// Extended state includes wishlist for UI display
type ChipState = ShowState | 'wishlist';

interface StateChipProps {
  state: ChipState;
}

export function StateChip({ state }: StateChipProps): React.JSX.Element | null {
  const { tokens } = useTheme();
  const { colors } = tokens;

  if (state === 'past') return null;

  interface ChipConfig {
    label: string;
    bg: string;
    textColor: string;
    borderColor?: string;
    icon: React.JSX.Element;
  }

  const config: Record<Exclude<ChipState, 'past'>, ChipConfig> = {
    ticketed: {
      label: 'TICKETED',
      bg: colors.accent,
      textColor: colors.accentText,
      icon: <Check size={9} color={colors.accentText} strokeWidth={2.5} />,
    },
    watching: {
      label: 'WATCHING',
      bg: 'transparent',
      textColor: colors.ink,
      borderColor: colors.ruleStrong,
      icon: <Eye size={9} color={colors.ink} strokeWidth={2.5} />,
    },
    wishlist: {
      label: 'WISHLIST',
      bg: 'transparent',
      textColor: colors.ink,
      borderColor: colors.ruleStrong,
      icon: <Bookmark size={9} color={colors.ink} strokeWidth={2.5} />,
    },
  };

  const chip = config[state as Exclude<ChipState, 'past'>];

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: chip.bg,
          borderColor: chip.borderColor ?? 'transparent',
          borderWidth: chip.borderColor ? 1 : 0,
        },
      ]}
    >
      {chip.icon}
      <Text style={[styles.label, { color: chip.textColor }]}>{chip.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },
  label: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 10.5 * 0.06, // 0.06em
    textTransform: 'uppercase',
  },
});
