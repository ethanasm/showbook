/**
 * ShowFormFields — shared form body for the mobile add/edit show
 * screens. Owns the kind segmented control, the title field (whose
 * label flips by kind), the venue typeahead, the date pair, the
 * kind-specific fields (tour / production / end date), the
 * `LineupEditor`, the collapsible "More details" section, and the
 * notes field.
 *
 * State lives on the parent — this component is a stateless renderer
 * that calls back into `set` for every field change.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image as ImageIcon, X as XIcon } from 'lucide-react-native';

import { SegmentedControl } from './SegmentedControl';
import { FormField, FormRow } from './FormField';
import { VenueTypeahead, type VenueSuggestion } from './VenueTypeahead';
import { LineupEditor } from './LineupEditor';
import { Collapsible } from './Collapsible';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { normalizeDashes } from '@/lib/dateInput';
import type {
  PerformerRow,
  ShowFormKind,
  ShowFormValues,
} from '@/lib/showForm';

export interface ShowFormErrors {
  title?: string;
  venue?: string;
  date?: string;
  endDate?: string;
}

const KIND_OPTIONS: { value: ShowFormKind; label: string }[] = [
  { value: 'concert', label: 'Concert' },
  { value: 'theatre', label: 'Theatre' },
  { value: 'comedy', label: 'Comedy' },
  { value: 'festival', label: 'Festival' },
];

const TITLE_LABEL: Record<ShowFormKind, string> = {
  concert: 'Headliner',
  theatre: 'Production',
  comedy: 'Headliner',
  festival: 'Festival name',
};

const TITLE_PLACEHOLDER: Record<ShowFormKind, string> = {
  concert: 'Artist',
  theatre: 'Production name',
  comedy: 'Comedian',
  festival: 'Festival name',
};

export interface ShowFormFieldsProps {
  values: ShowFormValues;
  set: <K extends keyof ShowFormValues>(key: K, next: ShowFormValues[K]) => void;
  venueSuggestions: VenueSuggestion[];
  venueLoading: boolean;
  onVenueSearch: (q: string) => void;
  /**
   * Optional hook for Google Places suggestions (those that carry a
   * `placeId`). The parent screen is responsible for materializing the
   * place into a real venue via `venues.createFromPlace` and then
   * setting the resulting venue on the form. When absent, place
   * suggestions are treated as inert.
   */
  onSelectPlace?: (placeId: string, suggestion: VenueSuggestion) => void;
  /**
   * Per-field validation errors rendered inline under the matching
   * input. The parent screen owns the validation logic and clears
   * errors as the user types (handled here automatically via the
   * `clearError` callback wired into each `onChangeText`).
   */
  errors?: ShowFormErrors;
  clearError?: (key: keyof ShowFormErrors) => void;
  /**
   * Festival-only entry into the poster OCR sheet. When provided and
   * kind is "festival" the form renders an "Extract lineup from poster"
   * pill above the lineup editor. The parent screen owns the sheet so
   * the picker can navigate from the right route context.
   */
  onExtractLineup?: () => void;
}

export function ShowFormFields({
  values,
  set,
  venueSuggestions,
  venueLoading,
  onVenueSearch,
  onSelectPlace,
  errors,
  clearError,
  onExtractLineup,
}: ShowFormFieldsProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  const isFestival = values.kind === 'festival';

  return (
    <View style={styles.wrap}>
      <FormField label="Kind">
        <SegmentedControl
          options={KIND_OPTIONS}
          value={values.kind}
          onChange={(k) => set('kind', k)}
        />
      </FormField>

      <FormField
        label={TITLE_LABEL[values.kind]}
        value={values.title}
        onChangeText={(v) => {
          set('title', v);
          clearError?.('title');
        }}
        placeholder={TITLE_PLACEHOLDER[values.kind]}
        autoCapitalize="words"
        error={errors?.title}
        testID="title-input"
      />

      <FormField label="Venue" error={errors?.venue}>
        <VenueTypeahead
          value={values.venueQuery}
          onChange={(v) => {
            set('venueQuery', v);
            if (values.venue && v !== values.venue.name) {
              set('venue', null);
            }
            clearError?.('venue');
          }}
          onSelect={(venue) => {
            if (venue.placeId) {
              // Google Places hit — defer to the parent so it can call
              // `venues.createFromPlace` and set the resulting real
              // venue. We still echo the name into the query so the
              // user sees the tap registered while the network call
              // settles.
              set('venueQuery', venue.name);
              clearError?.('venue');
              onSelectPlace?.(venue.placeId, venue);
              return;
            }
            set('venue', {
              id: venue.id,
              name: venue.name,
              city: venue.city ?? null,
              stateRegion: venue.stateRegion ?? null,
              country: venue.country ?? null,
            });
            set('venueQuery', venue.name);
            clearError?.('venue');
          }}
          onSearch={onVenueSearch}
          suggestions={venueSuggestions}
          loading={venueLoading}
          placeholder={isFestival ? 'Festival grounds' : 'Search venues'}
          testID="venue-typeahead"
        />
        {values.venue ? (
          <Pressable
            onPress={() => set('venue', null)}
            style={[styles.venuePill, { backgroundColor: colors.accent }]}
            accessibilityRole="button"
            accessibilityLabel="Clear venue"
          >
            <Text style={[styles.venuePillText, { color: colors.accentText }]}>
              {values.venue.name}
            </Text>
            <XIcon size={12} color={colors.accentText} strokeWidth={2.4} />
          </Pressable>
        ) : null}
      </FormField>

      <FormRow>
        <FormField
          label={isFestival ? 'Start date' : 'Date'}
          flex={1}
          value={values.date}
          onChangeText={(v) => {
            // Normalize en-dash / em-dash / other Unicode dash variants
            // to ASCII hyphen on every keystroke. iOS smart punctuation
            // can silently substitute en-dash (U+2013) inside a date,
            // and the field looks identical to the user but fails the
            // YYYY-MM-DD validator. Stripping eagerly means the user
            // can't accidentally end up with a "wrong" date that looks
            // right.
            set('date', normalizeDashes(v));
            clearError?.('date');
          }}
          placeholder="YYYY-MM-DD"
          autoCapitalize="none"
          keyboardType="numbers-and-punctuation"
          error={errors?.date}
        />
        {isFestival ? (
          <FormField
            label="End date"
            flex={1}
            value={values.endDate}
            onChangeText={(v) => {
              set('endDate', normalizeDashes(v));
              clearError?.('endDate');
            }}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
            error={errors?.endDate}
          />
        ) : null}
      </FormRow>

      {values.kind === 'concert' ? (
        <FormField
          label="Tour name (optional)"
          value={values.tourName}
          onChangeText={(v) => set('tourName', v)}
          placeholder="World tour, residency, …"
        />
      ) : null}

      {isFestival && onExtractLineup ? (
        <Pressable
          onPress={onExtractLineup}
          accessibilityRole="button"
          accessibilityLabel="Extract lineup from poster"
          testID="extract-lineup-from-poster"
          style={({ pressed }) => [
            styles.extractBtn,
            { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <ImageIcon size={14} color={colors.accentText} strokeWidth={2} />
          <Text style={[styles.extractBtnLabel, { color: colors.accentText }]}>
            Extract lineup from poster
          </Text>
        </Pressable>
      ) : null}

      <LineupEditor
        rows={values.performers}
        onChange={(rows: PerformerRow[]) => set('performers', rows)}
        kind={values.kind}
        testID="lineup-editor"
      />

      <Collapsible label="More details" testID="more-details">
        {!isFestival ? (
          <FormField
            label="Seat"
            value={values.seat}
            onChangeText={(v) => set('seat', v)}
            placeholder="Section, row, seat"
          />
        ) : null}
        <FormRow>
          <FormField
            label="Tickets"
            flex={1}
            value={values.ticketCount}
            onChangeText={(v) =>
              set('ticketCount', v.replace(/[^0-9]/g, ''))
            }
            placeholder="1"
            keyboardType="numeric"
          />
          <FormField
            label="Price paid"
            flex={1}
            value={values.pricePaid}
            onChangeText={(v) =>
              set('pricePaid', v.replace(/[^0-9.]/g, ''))
            }
            placeholder="0.00"
            keyboardType="decimal-pad"
          />
        </FormRow>
      </Collapsible>

      <FormField
        label="Notes"
        value={values.notes}
        onChangeText={(v) => set('notes', v)}
        placeholder="Anything you want to remember"
        multiline
        numberOfLines={4}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 16,
  },
  venuePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: RADII.pill,
    marginTop: 4,
  },
  venuePillText: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '600',
  },
  extractBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: RADII.pill,
  },
  extractBtnLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '600',
  },
});
