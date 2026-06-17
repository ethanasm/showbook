/**
 * SearchBar — pinned, controlled local-filter input.
 *
 * The single shared in-place filter affordance, used by the Shows and
 * Discover tabs (below the segmented controls, above the scrolling
 * feed) and the Venues / Artists list screens (pinned above the list).
 * It filters the rows already on screen by headliner / cast / venue /
 * show name / festival name — a *local filter*, not the global
 * omnisearch (`app/search.tsx` + `SearchTopBarAction`). Purely
 * presentational: the owning screen holds the query state and applies
 * `matchesSearchQuery` from `@showbook/shared`.
 *
 * Styling mirrors the omnisearch bar in `app/search.tsx` (pill, leading
 * magnifier, trailing clear) so the two search affordances feel like
 * one system.
 */

import React from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { Search as SearchIcon, X } from 'lucide-react-native';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';

export function SearchBar({
  value,
  onChangeText,
  placeholder,
  testID,
  accessibilityLabel,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  testID?: string;
  /** Defaults to `placeholder` when omitted. */
  accessibilityLabel?: string;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: colors.surface, borderColor: colors.rule },
      ]}
    >
      <SearchIcon size={16} color={colors.muted} strokeWidth={2} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        style={[styles.input, { color: colors.ink }]}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        testID={testID}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChangeText('')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          testID={testID ? `${testID}-clear` : undefined}
        >
          <X size={16} color={colors.muted} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: RADII.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    fontFamily: 'Geist Sans 400',
    fontSize: 15,
    paddingVertical: 0,
  },
});
