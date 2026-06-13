/**
 * Admin-only bottom sheet to edit a venue's CANONICAL location — the
 * shared `venues.city` / `stateRegion` / `country` every user sees.
 * Mirrors the web app's inline `AdminVenueLocation` editor on the venue
 * detail page and routes through the same `admin.updateVenueLocation`
 * mutation.
 *
 * Unlike the per-user `venues.rename` alias, location is a shared field
 * with no per-user override, so this is gated to admins. The mutation is
 * online-only (not routed through the offline outbox) — matching
 * `RenameVenueSheet`'s admin-rename action and `AdminSection`.
 *
 * The primary motivation is fixing Gmail-imported venues whose city came
 * in as the literal "Unknown": nothing else can edit it, and the
 * coordinate / Ticketmaster backfills both skip `city = 'Unknown'` rows.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Sheet } from './Sheet';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { trpc } from '@/lib/trpc';
import { useFeedback } from '@/lib/feedback';
import { toUserMessage } from '@/lib/errors';
import { InputMaxLength } from '@showbook/shared';

export interface EditVenueLocationSheetProps {
  open: boolean;
  onClose: () => void;
  venueId: string;
  city: string;
  stateRegion?: string | null;
  country: string;
}


export function EditVenueLocationSheet({
  open,
  onClose,
  venueId,
  city,
  stateRegion,
  country,
}: EditVenueLocationSheetProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const utils = trpc.useUtils();
  const { showToast } = useFeedback();

  const [cityDraft, setCityDraft] = React.useState(city);
  const [regionDraft, setRegionDraft] = React.useState(stateRegion ?? '');
  const [countryDraft, setCountryDraft] = React.useState(country);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setCityDraft(city);
      setRegionDraft(stateRegion ?? '');
      setCountryDraft(country);
      setSubmitting(false);
    }
  }, [open, city, stateRegion, country]);

  const trimmedCity = cityDraft.trim();
  const trimmedCountry = countryDraft.trim();
  const canSubmit =
    trimmedCity.length > 0 && trimmedCountry.length > 0 && !submitting;

  const updateLocation = trpc.admin.updateVenueLocation.useMutation();

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await updateLocation.mutateAsync({
        venueId,
        city: trimmedCity,
        stateRegion: regionDraft.trim() || null,
        country: trimmedCountry,
      });
      void utils.venues.detail.invalidate({ venueId });
      void utils.venues.followed.invalidate();
      void utils.venues.list.invalidate();
      showToast({ kind: 'success', text: 'Venue location updated' });
      onClose();
    } catch (err) {
      showToast({
        kind: 'error',
        text: toUserMessage(err, 'Could not update venue location'),
      });
      setSubmitting(false);
    }
  };

  const fieldInputStyle = [
    styles.input,
    {
      color: colors.ink,
      borderColor: colors.rule,
      backgroundColor: colors.surface,
    },
  ];

  return (
    <Sheet open={open} onClose={onClose} snapPoints={['56%']}>
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.ink }]}>Edit location</Text>
        <Text style={[styles.hint, { color: colors.muted }]}>
          Admin · everyone sees this. Fixes a venue with no real city.
        </Text>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.faint }]}>CITY</Text>
          <TextInput
            value={cityDraft}
            onChangeText={setCityDraft}
            autoFocus
            maxLength={InputMaxLength.venueCity}
            placeholder="City"
            placeholderTextColor={colors.faint}
            testID="edit-location-city"
            style={fieldInputStyle}
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.faint }]}>
            STATE / REGION
          </Text>
          <TextInput
            value={regionDraft}
            onChangeText={setRegionDraft}
            maxLength={InputMaxLength.venueRegion}
            placeholder="State or region (optional)"
            placeholderTextColor={colors.faint}
            testID="edit-location-region"
            style={fieldInputStyle}
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.faint }]}>COUNTRY</Text>
          <TextInput
            value={countryDraft}
            onChangeText={setCountryDraft}
            maxLength={InputMaxLength.venueCountry}
            placeholder="Country"
            placeholderTextColor={colors.faint}
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
            testID="edit-location-country"
            style={fieldInputStyle}
          />
        </View>

        <View style={styles.actionsRow}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={({ pressed }) => [
              styles.cancelBtn,
              { borderColor: colors.ruleStrong },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.cancelLabel, { color: colors.ink }]}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={() => void submit()}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="Save venue location"
            testID="edit-location-save"
            style={({ pressed }) => [
              styles.confirmBtn,
              {
                backgroundColor: colors.accent,
                opacity: !canSubmit ? 0.5 : pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text style={[styles.confirmLabel, { color: colors.accentText }]}>
              {submitting ? 'Saving…' : 'Save'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 12,
  },
  title: {
    fontFamily: 'Geist Sans 600',
    fontSize: 17,
    letterSpacing: -0.2,
  },
  hint: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  field: {
    gap: 6,
  },
  label: {
    fontFamily: 'Geist Sans 600',
    fontSize: 10.5,
    letterSpacing: 1.05,
  },
  input: {
    fontFamily: 'Geist Sans 400',
    fontSize: 15,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 6,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.pill,
  },
  cancelLabel: {
    fontFamily: 'Geist Sans 500',
    fontSize: 13,
  },
  confirmBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: RADII.pill,
  },
  confirmLabel: {
    fontFamily: 'Geist Sans 600',
    fontSize: 13,
  },
});
