/**
 * Horizontal chip rail with an "All" chip plus one chip per group.
 * Picks a single id from a flat list. Tap the active chip to clear.
 *
 * Originally inlined in `app/(tabs)/discover.tsx`; lifted into a
 * shared component so the Setlist tab on festival shows can mirror
 * the Discover filter pattern.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { Plus } from 'lucide-react-native';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';

export interface FilterGroup {
  id: string;
  name: string;
  sublabel?: string;
  count: number;
  /** Overrides the rendered count with arbitrary text. Used by the
   *  festival setlist tab to show per-artist prediction confidence
   *  ("82%") instead of the numeric song count. */
  badgeText?: string;
}

export interface FilterChipsTrailingAction {
  label: string;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
}

export function FilterChipsRow({
  groups,
  selected,
  onSelect,
  totalCount,
  allLabel = 'All',
  showAll = true,
  variant = 'primary',
  testIdPrefix,
  trailingAction,
}: {
  groups: FilterGroup[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Count rendered in the "All" chip; ignored when `showAll` is false. */
  totalCount?: number;
  allLabel?: string;
  /** Render the leading "All" chip. Some surfaces (the festival
   *  setlist tab) default-select an artist and don't want an "All"
   *  option that flattens every lineup setlist into one scroll. */
  showAll?: boolean;
  /** `sub` renders a slightly tighter row used as a second-level filter. */
  variant?: 'primary' | 'sub';
  testIdPrefix?: string;
  /** Trailing "+" chip rendered after the group chips. Suppressed
   *  automatically when `variant === 'sub'` so the second-level row
   *  doesn't pick up an add-affordance it has no use for. */
  trailingAction?: FilterChipsTrailingAction;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[
        styles.chipsRow,
        variant === 'sub' && styles.chipsRowSub,
      ]}
      style={styles.chipsScroll}
      testID={testIdPrefix ? `${testIdPrefix}-row` : undefined}
    >
      {showAll ? (
        <FilterChip
          label={allLabel}
          count={totalCount ?? 0}
          active={selected === null}
          onPress={() => onSelect(null)}
          colors={colors}
          testID={testIdPrefix ? `${testIdPrefix}-all` : undefined}
        />
      ) : null}
      {groups.map((g) => (
        <FilterChip
          key={g.id}
          label={g.name}
          sublabel={g.sublabel}
          count={g.count}
          badgeText={g.badgeText}
          active={selected === g.id}
          // When `showAll` is false the chip rail is required-selection:
          // tapping the active chip is a no-op rather than clearing back
          // to "All". Mirrors how a SegmentedControl behaves.
          onPress={() =>
            onSelect(selected === g.id ? (showAll ? null : g.id) : g.id)
          }
          colors={colors}
          testID={testIdPrefix ? `${testIdPrefix}-${g.id}` : undefined}
        />
      ))}
      {trailingAction && variant !== 'sub' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={trailingAction.accessibilityLabel ?? trailingAction.label}
          onPress={trailingAction.onPress}
          testID={trailingAction.testID}
          style={({ pressed }) => [
            styles.chip,
            {
              backgroundColor: 'transparent',
              borderColor: colors.accent,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Plus size={12} color={colors.accent} strokeWidth={2.5} />
          <Text
            numberOfLines={1}
            style={[
              styles.chipLabel,
              { color: colors.accent, fontWeight: '600' },
            ]}
          >
            {trailingAction.label}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function FilterChip({
  label,
  sublabel,
  count,
  badgeText,
  active,
  onPress,
  colors,
  testID,
}: {
  label: string;
  sublabel?: string;
  count: number;
  badgeText?: string;
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['tokens']['colors'];
  testID?: string;
}): React.JSX.Element {
  const renderedBadge =
    badgeText !== undefined ? badgeText : String(count);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}${sublabel ? ` ${sublabel}` : ''}`}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? colors.ink : 'transparent',
          borderColor: active ? colors.ink : colors.ruleStrong,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.chipLabel,
          {
            color: active ? colors.bg : colors.ink,
            fontWeight: active ? '600' : '500',
          },
        ]}
      >
        {label}
        {sublabel ? (
          <Text style={[styles.chipSublabel, { color: active ? colors.bg : colors.muted }]}>
            {' '}
            · {sublabel}
          </Text>
        ) : null}
      </Text>
      {renderedBadge.length > 0 ? (
        <Text
          style={[
            styles.chipCount,
            { color: active ? colors.bg : colors.muted, opacity: active ? 0.7 : 1 },
          ]}
        >
          {renderedBadge}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chipsScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  chipsRowSub: {
    paddingTop: 0,
    paddingBottom: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.pill,
    maxWidth: 220,
  },
  chipLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    letterSpacing: -0.1,
  },
  chipSublabel: {
    fontFamily: 'Geist Sans 400',
    fontSize: 11,
  },
  chipCount: {
    fontFamily: 'Geist Mono 400',
    fontSize: 10,
  },
});
