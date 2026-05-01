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
import { useTheme, type ColorTokens, type ShowState } from '../lib/theme';
import { RADII } from '../lib/theme-utils';

// Extended state includes wishlist for UI display
type ChipState = ShowState | 'wishlist';

interface StateChipProps {
  state: ChipState;
}

// Module-scope interface — not rebuilt per render
interface ChipConfig {
  label: string;
  bg: string;
  textColor: string;
  borderColor?: string;
  icon: React.JSX.Element;
}

function getChipConfig(state: Exclude<ChipState, 'past'>, colors: ColorTokens): ChipConfig {
  switch (state) {
    case 'ticketed':
      return {
        label: 'TICKETED',
        bg: colors.accent,
        textColor: colors.accentText,
        icon: <Check size={9} color={colors.accentText} strokeWidth={2.5} />,
      };
    case 'watching':
      return {
        label: 'WATCHING',
        bg: 'transparent',
        textColor: colors.ink,
        borderColor: colors.ruleStrong,
        icon: <Eye size={9} color={colors.ink} strokeWidth={2.5} />,
      };
    case 'wishlist':
      return {
        label: 'WISHLIST',
        bg: 'transparent',
        textColor: colors.ink,
        borderColor: colors.ruleStrong,
        icon: <Bookmark size={9} color={colors.ink} strokeWidth={2.5} />,
      };
  }
}

export function StateChip({ state }: StateChipProps): React.JSX.Element | null {
  const { tokens } = useTheme();
  const { colors } = tokens;

  if (state === 'past') return null;

  const chip = getChipConfig(state, colors);

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
    borderRadius: RADII.pill,
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
