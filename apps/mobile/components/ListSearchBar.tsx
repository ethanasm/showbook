/**
 * ListSearchBar — pill-shaped filter input pinned above a list.
 *
 * Used by the Venues and Artists list screens to filter the rendered rows
 * by name client-side. Mirrors the omnisearch screen's search bar metrics
 * (`app/search.tsx`) so the two affordances feel like one control. This is
 * a *local filter*, not the global omnisearch — it narrows the list already
 * on screen rather than querying the server.
 */

import React from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';

export interface ListSearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  accessibilityLabel: string;
}

export function ListSearchBar({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
}: ListSearchBarProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View
      style={[
        styles.searchBar,
        { backgroundColor: colors.surface, borderColor: colors.rule },
      ]}
    >
      <Search size={16} color={colors.muted} strokeWidth={2} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="never"
        style={[styles.searchInput, { color: colors.ink }]}
        accessibilityLabel={accessibilityLabel}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChangeText('')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <X size={16} color={colors.muted} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: RADII.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Geist Sans 400',
    fontSize: 15,
    paddingVertical: 0,
  },
});
