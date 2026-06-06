/**
 * KindFilterMenu — a lightweight, header-anchored dropdown for picking a
 * single show kind to filter a screen by. Opened by the filter button in
 * the screen header (next to search / the Me action). Shared across the
 * Discover, Home, Shows, and Map tabs via `KindFilterControl`.
 *
 * There's no floating-popover primitive in the app (only the full-screen
 * `Sheet`), so this rolls a minimal anchored menu: a transparent Modal with
 * a full-screen backdrop that closes on tap, plus a small card pinned near
 * the top-right under the header. Rows reuse the PickerRow look from
 * FilterChipsRow (check on the active row, kind-coloured lucide icon).
 *
 * Options are "All" + the four watchable kinds. "All" clears the filter and
 * shows everything the screen surfaces (including any film/unknown items).
 *
 * `testIDPrefix` namespaces the menu / option / backdrop testIDs per host
 * screen (defaults to `discover` so the original Discover testIDs are
 * preserved); `topOffset` tunes where the card anchors below the header
 * (the large `TopBar` screens use the default 56; `HomeHeader` is shorter).
 */

import React from 'react';
import { Modal, Pressable, View, Text, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type Kind } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { KIND_ICON } from './KindBadge';

export type KindFilterValue = 'all' | Kind;

const OPTIONS: readonly { value: KindFilterValue; label: string }[] = [
  { value: 'all', label: 'All shows' },
  { value: 'concert', label: 'Concert' },
  { value: 'theatre', label: 'Theatre' },
  { value: 'comedy', label: 'Comedy' },
  { value: 'festival', label: 'Festival' },
];

/**
 * Lowercase singular noun for a filtered kind, used in empty-state copy
 * (e.g. "No upcoming comedy shows"). Kept here so every host screen
 * phrases the filtered-empty message the same way.
 */
const KIND_NOUNS: Record<Kind, string> = {
  concert: 'concert',
  theatre: 'theatre',
  comedy: 'comedy',
  festival: 'festival',
  film: 'film',
  unknown: 'unknown',
};

export function kindFilterNoun(kind: Kind): string {
  return KIND_NOUNS[kind];
}

interface KindFilterMenuProps {
  open: boolean;
  value: KindFilterValue;
  onSelect: (value: KindFilterValue) => void;
  onClose: () => void;
  /** Namespaces the menu / option / backdrop testIDs. Default `discover`. */
  testIDPrefix?: string;
  /** Vertical anchor below the safe-area top. Default 56 (large TopBar). */
  topOffset?: number;
}

export function KindFilterMenu({
  open,
  value,
  onSelect,
  onClose,
  testIDPrefix = 'discover',
  topOffset = 56,
}: KindFilterMenuProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close kind filter"
        testID={`${testIDPrefix}-kind-menu-backdrop`}
      >
        {/* Stop propagation so taps inside the card don't close the menu. */}
        <Pressable
          onPress={() => {}}
          style={[
            styles.card,
            {
              top: insets.top + topOffset,
              backgroundColor: colors.surfaceRaised,
              borderColor: colors.ruleStrong,
            },
          ]}
          testID={`${testIDPrefix}-kind-menu`}
        >
          {OPTIONS.map(({ value: v, label }) => {
            const active = v === value;
            const Icon = v === 'all' ? null : KIND_ICON[v];
            return (
              <Pressable
                key={v}
                onPress={() => {
                  onSelect(v);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={label}
                testID={`${testIDPrefix}-kind-option-${v}`}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: active ? colors.accentFaded : 'transparent',
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}
              >
                <View style={styles.icon}>
                  {Icon ? (
                    <Icon size={16} color={tokens.kindColor(v as Kind)} strokeWidth={2.5} />
                  ) : null}
                </View>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.label,
                    { color: colors.ink, fontWeight: active ? '600' : '500' },
                  ]}
                >
                  {label}
                </Text>
                <View style={styles.check}>
                  {active ? (
                    <Check size={16} color={colors.accent} strokeWidth={2.5} />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
  },
  card: {
    position: 'absolute',
    right: 16,
    minWidth: 188,
    borderWidth: 1,
    borderRadius: RADII.lg,
    paddingVertical: 6,
    // Soft elevation so the card reads as a floating popover.
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: RADII.sm,
    marginHorizontal: 4,
  },
  icon: {
    width: 18,
    alignItems: 'center',
  },
  label: {
    flex: 1,
    fontFamily: 'Geist Sans 500',
    fontSize: 14,
  },
  check: {
    width: 18,
    alignItems: 'center',
  },
});
