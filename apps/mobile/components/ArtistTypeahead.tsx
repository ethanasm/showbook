/**
 * Debounced artist / performer search input.
 *
 * Mirrors `VenueTypeahead`: debounced, headless about API access, just
 * renders the suggestions the caller hands it. Each suggestion shows
 * a thumbnail (when the source returned one) + name + a small source
 * label ("Ticketmaster" or "Followed") so the user can tell local
 * matches from external ones.
 *
 * The caller is expected to combine local (`performers.search`) and
 * external (`performers.searchExternal`) results before passing them
 * in — see `LineupEditor` for the wiring.
 */

import React from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Search } from 'lucide-react-native';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { useDebouncedValue } from '@showbook/shared/hooks';

export interface ArtistSuggestion {
  /** Stable key for the FlatList row. */
  key: string;
  name: string;
  imageUrl?: string | null;
  tmAttractionId?: string | null;
  musicbrainzId?: string | null;
  /** Pill copy — typically "Ticketmaster" or "Followed". */
  source?: string;
}

export interface ArtistTypeaheadProps {
  value: string;
  onChange: (text: string) => void;
  onSelect: (artist: ArtistSuggestion) => void;
  onSearch: (debouncedQuery: string) => void;
  suggestions: ArtistSuggestion[];
  loading?: boolean;
  placeholder?: string;
  debounceMs?: number;
  autoFocus?: boolean;
  testID?: string;
}

const DEFAULT_DEBOUNCE = 250;

export function ArtistTypeahead({
  value,
  onChange,
  onSelect,
  onSearch,
  suggestions,
  loading = false,
  placeholder = 'Search artists',
  debounceMs = DEFAULT_DEBOUNCE,
  autoFocus = false,
  testID,
}: ArtistTypeaheadProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const debounced = useDebouncedValue(value, debounceMs);

  React.useEffect(() => {
    const trimmed = debounced.trim();
    if (trimmed.length === 0) return;
    onSearch(trimmed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const showResults = value.trim().length > 0 && suggestions.length > 0;

  return (
    <View style={styles.wrap} testID={testID}>
      <View
        style={[styles.inputWrap, { borderColor: colors.rule, backgroundColor: colors.surface }]}
      >
        <Search size={14} color={colors.muted} strokeWidth={2} />
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.faint}
          autoCapitalize="words"
          autoCorrect={false}
          autoFocus={autoFocus}
          style={[styles.input, { color: colors.ink }]}
          testID={testID ? `${testID}-input` : undefined}
        />
        {loading && value.trim().length > 0 ? (
          <ActivityIndicator size="small" color={colors.muted} />
        ) : null}
      </View>

      {showResults ? (
        // ScrollView (not View) so the dropdown is bounded + internally
        // scrollable even when the row sits at the bottom of a long
        // LineupEditor — NestableDraggableFlatList does not recompute
        // its content height when a row grows mid-render, so the outer
        // NestableScrollContainer can't reach a tall dropdown otherwise.
        <ScrollView
          style={[styles.list, { borderColor: colors.rule, backgroundColor: colors.surface }]}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          {suggestions.map((artist, i) => (
            <Pressable
              key={artist.key}
              onPress={() => onSelect(artist)}
              accessibilityRole="button"
              accessibilityLabel={`Select ${artist.name}`}
              testID={testID ? `${testID}-row-${artist.key}` : undefined}
              style={({ pressed }) => [
                styles.row,
                i > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.rule,
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              {artist.imageUrl ? (
                <Image
                  source={{ uri: artist.imageUrl }}
                  style={[styles.thumb, { borderColor: colors.rule }]}
                />
              ) : (
                <View
                  style={[
                    styles.thumb,
                    styles.thumbPlaceholder,
                    { borderColor: colors.rule, backgroundColor: colors.bg },
                  ]}
                />
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  style={[styles.rowName, { color: colors.ink }]}
                  numberOfLines={1}
                >
                  {artist.name}
                </Text>
                {artist.source ? (
                  <Text
                    style={[styles.rowMeta, { color: colors.muted }]}
                    numberOfLines={1}
                  >
                    {artist.source}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </ScrollView>
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
    borderRadius: RADII.lg,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  input: {
    flex: 1,
    fontFamily: 'Geist Sans 400',
    fontSize: 14,
    padding: 0,
  },
  list: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.lg,
    // Cap the dropdown so it never extends past the screen edge when
    // the active row sits near the bottom of the lineup. ~5 rows fit
    // before the user has to scroll within the dropdown.
    maxHeight: 240,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  thumb: {
    width: 32,
    height: 32,
    borderRadius: RADII.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumbPlaceholder: {},
  rowName: {
    fontFamily: 'Geist Sans 600',
    fontSize: 14,
  },
  rowMeta: {
    fontFamily: 'Geist Sans 400',
    fontSize: 11,
    marginTop: 1,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
});
