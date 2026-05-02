/**
 * Debounced venue search input.
 *
 * Used in both Add and Edit forms. Holds the raw text in local state,
 * debounces it via `useDebouncedValue`, fires a single `onSearch` call
 * for the most recent stable input, and renders the suggestion list
 * the parent supplies. Empty queries render nothing — selection
 * always happens via tap, never by submit.
 *
 * The component is intentionally headless about API access: the
 * caller passes `onSearch(query)` and an array of `suggestions` so
 * tests can drive it without tRPC or React Query.
 */

import React from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { MapPin, Search } from 'lucide-react-native';
import { useTheme } from '../lib/theme';
import { useDebouncedValue } from '../lib/useDebouncedValue';

export interface VenueSuggestion {
  id: string;
  name: string;
  city?: string | null;
  stateRegion?: string | null;
  country?: string | null;
}

export interface VenueTypeaheadProps {
  value: string;
  onChange: (text: string) => void;
  onSelect: (venue: VenueSuggestion) => void;
  /**
   * Fired with the debounced (settled) query string. Caller is
   * responsible for actually executing the search and pushing the
   * results back via `suggestions`.
   */
  onSearch: (debouncedQuery: string) => void;
  suggestions: VenueSuggestion[];
  loading?: boolean;
  placeholder?: string;
  debounceMs?: number;
  testID?: string;
}

const DEFAULT_DEBOUNCE = 250;

export function VenueTypeahead({
  value,
  onChange,
  onSelect,
  onSearch,
  suggestions,
  loading = false,
  placeholder = 'Search venues',
  debounceMs = DEFAULT_DEBOUNCE,
  testID,
}: VenueTypeaheadProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const debounced = useDebouncedValue(value, debounceMs);

  React.useEffect(() => {
    const trimmed = debounced.trim();
    if (trimmed.length === 0) return;
    onSearch(trimmed);
    // Intentionally omit `onSearch` from deps — every keystroke would
    // otherwise re-fire if the parent recreated the callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const showResults = value.trim().length > 0;

  return (
    <View testID={testID} style={styles.wrap}>
      <View style={[styles.inputWrap, { borderColor: colors.rule, backgroundColor: colors.surface }]}>
        <Search size={16} color={colors.muted} strokeWidth={2} />
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.faint}
          autoCapitalize="words"
          autoCorrect={false}
          style={[styles.input, { color: colors.ink }]}
          testID={testID ? `${testID}-input` : undefined}
        />
        {loading && showResults ? (
          <ActivityIndicator size="small" color={colors.muted} />
        ) : null}
      </View>

      {showResults && suggestions.length > 0 ? (
        <View style={[styles.list, { borderColor: colors.rule, backgroundColor: colors.surface }]}>
          {suggestions.map((venue, i) => (
            <Pressable
              key={venue.id}
              onPress={() => onSelect(venue)}
              accessibilityRole="button"
              accessibilityLabel={`Select ${venue.name}`}
              testID={testID ? `${testID}-row-${venue.id}` : undefined}
              style={({ pressed }) => [
                styles.row,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.rule },
                pressed && { opacity: 0.7 },
              ]}
            >
              <MapPin size={14} color={colors.muted} strokeWidth={1.8} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.rowName, { color: colors.ink }]} numberOfLines={1}>
                  {venue.name}
                </Text>
                {venue.city ? (
                  <Text style={[styles.rowMeta, { color: colors.muted }]} numberOfLines={1}>
                    {[venue.city, venue.stateRegion].filter(Boolean).join(', ')}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 6,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  input: {
    flex: 1,
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '400',
    padding: 0,
  },
  list: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  rowName: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '600',
  },
  rowMeta: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
});
