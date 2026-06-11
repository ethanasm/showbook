/**
 * First-run step 4 of 5 — set the user's home region.
 *
 * Receives optional lat/lng from the previous location step. When present,
 * we reverse-geocode them to a city name and let the user confirm. When
 * absent (permission denied, GPS timed out, "Use city instead"), the city
 * picker is the primary path. Persists via `preferences.addRegion`.
 *
 * Why this step exists: the daily digest filters announcements to the
 * user's followed regions. Without at least one region the email falls back
 * to "shows from everywhere", which is noisy. This step closes that gap
 * during onboarding instead of leaving it as a hidden setting.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { MapPin } from 'lucide-react-native';
import { FirstRunStep, heroTitleStyle } from './_components';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { trpc } from '@/lib/trpc';
import { useFirstRunFlow } from '@/lib/useFirstRunFlow';

type Mode =
  | { kind: 'idle' }
  | { kind: 'resolved'; cityName: string; latitude: number; longitude: number }
  | { kind: 'picker' };

const DEFAULT_RADIUS_MILES = 25;
const RADIUS_OPTIONS = [15, 25, 50, 100] as const;

export default function FirstRunRegion(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { position, goNext } = useFirstRunFlow();
  const pos = position('region');
  const params = useLocalSearchParams<{ lat?: string; lng?: string }>();

  const initialLat = params.lat ? Number(params.lat) : null;
  const initialLng = params.lng ? Number(params.lng) : null;
  const haveCoords =
    initialLat != null &&
    initialLng != null &&
    Number.isFinite(initialLat) &&
    Number.isFinite(initialLng);

  const [mode, setMode] = React.useState<Mode>({ kind: 'idle' });
  const [radius, setRadius] = React.useState<number>(DEFAULT_RADIUS_MILES);
  const [reverseError, setReverseError] = React.useState<string | null>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  // Picker state — driven by enrichment.searchPlaces / placeDetails so we
  // stay in the same backend infrastructure web Preferences uses.
  const [pickerQuery, setPickerQuery] = React.useState('');
  const [debouncedQuery, setDebouncedQuery] = React.useState('');
  const debounceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const advance = React.useCallback(() => {
    goNext('region');
  }, [goNext]);

  const addRegion = trpc.preferences.addRegion.useMutation({
    onSuccess: () => advance(),
    onError: (e) => setSubmitError(e.message ?? 'Could not save region'),
  });

  // Reverse-geocode device coords once on mount. Falls back to the picker
  // if Apple/Google's reverse lookup fails or returns no city.
  React.useEffect(() => {
    if (!haveCoords) {
      setMode({ kind: 'picker' });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const results = await Location.reverseGeocodeAsync({
          latitude: initialLat as number,
          longitude: initialLng as number,
        });
        const first = results[0];
        const city = first?.city ?? first?.subregion ?? first?.region ?? null;
        if (cancelled) return;
        if (city) {
          setMode({
            kind: 'resolved',
            cityName: city,
            latitude: initialLat as number,
            longitude: initialLng as number,
          });
        } else {
          setReverseError("We couldn't name that location — pick a city below.");
          setMode({ kind: 'picker' });
        }
      } catch {
        if (cancelled) return;
        setReverseError("Reverse lookup failed — pick a city below.");
        setMode({ kind: 'picker' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [haveCoords, initialLat, initialLng]);

  const onUseDetected = React.useCallback(() => {
    if (mode.kind !== 'resolved') return;
    setSubmitError(null);
    addRegion.mutate({
      cityName: mode.cityName,
      latitude: mode.latitude,
      longitude: mode.longitude,
      radiusMiles: radius,
    });
  }, [addRegion, mode, radius]);

  const onSwitchToPicker = React.useCallback(() => {
    setMode({ kind: 'picker' });
    setReverseError(null);
  }, []);

  // Debounce city-picker input.
  const onPickerInput = React.useCallback((value: string) => {
    setPickerQuery(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (value.length >= 2) {
      debounceTimer.current = setTimeout(() => setDebouncedQuery(value), 350);
    } else {
      setDebouncedQuery('');
    }
  }, []);

  const citySearch = trpc.enrichment.searchPlaces.useQuery(
    { query: debouncedQuery, types: 'city' },
    { enabled: debouncedQuery.length >= 2, retry: false },
  );

  const utils = trpc.useUtils();

  const onPickCity = React.useCallback(
    async (placeId: string) => {
      setSubmitError(null);
      try {
        const details = await utils.client.enrichment.placeDetails.query({
          placeId,
        });
        if (!details) throw new Error('Place lookup returned no details');
        addRegion.mutate({
          cityName: details.city || details.name,
          latitude: details.latitude,
          longitude: details.longitude,
          radiusMiles: radius,
        });
      } catch (e) {
        setSubmitError(
          e instanceof Error ? e.message : 'Could not load city details',
        );
      }
    },
    [addRegion, radius, utils.client.enrichment.placeDetails],
  );

  const radiusRow = (
    <View style={styles.radiusRow}>
      {RADIUS_OPTIONS.map((mi) => {
        const selected = radius === mi;
        return (
          <Pressable
            key={mi}
            onPress={() => setRadius(mi)}
            style={[
              styles.radiusChip,
              {
                borderColor: selected ? colors.accent : colors.rule,
                backgroundColor: selected ? colors.accentFaded : colors.surface,
              },
            ]}
          >
            <Text
              style={[
                styles.radiusChipLabel,
                { color: selected ? colors.accent : colors.muted },
              ]}
            >
              {mi}mi
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const illustration = (
    <View style={styles.detectedBlock}>
      {mode.kind === 'idle' ? (
        <View style={[styles.detectedCard, { backgroundColor: colors.surface, borderColor: colors.rule }]}>
          <ActivityIndicator color={colors.accent} />
          <Text style={[styles.detectedSub, { color: colors.muted }]}>
            Finding your area…
          </Text>
        </View>
      ) : mode.kind === 'resolved' ? (
        <View style={[styles.detectedCard, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
          <MapPin size={18} color={colors.accent} strokeWidth={2} />
          <Text style={[styles.detectedCity, { color: colors.ink }]}>
            {mode.cityName}
          </Text>
          <Text style={[styles.detectedSub, { color: colors.muted }]}>
            within {radius}mi
          </Text>
          {radiusRow}
        </View>
      ) : (
        <View style={[styles.pickerCard, { backgroundColor: colors.surface, borderColor: colors.rule }]}>
          <TextInput
            style={[styles.pickerInput, { color: colors.ink, borderColor: colors.rule }]}
            value={pickerQuery}
            onChangeText={onPickerInput}
            placeholder="e.g. San Francisco"
            placeholderTextColor={colors.faint}
            autoCorrect={false}
            autoCapitalize="words"
            testID="region-city-input"
          />
          {citySearch.isLoading && debouncedQuery.length >= 2 ? (
            <Text style={[styles.pickerHint, { color: colors.muted }]}>Searching…</Text>
          ) : null}
          {citySearch.data?.slice(0, 5).map((p) => (
            <Pressable
              key={p.placeId}
              onPress={() => onPickCity(p.placeId)}
              style={[styles.pickerOption, { borderColor: colors.rule }]}
              disabled={addRegion.isPending}
            >
              <Text style={[styles.pickerOptionName, { color: colors.ink }]} numberOfLines={1}>
                {p.displayName}
              </Text>
              <Text style={[styles.pickerOptionMeta, { color: colors.muted }]} numberOfLines={1}>
                {p.formattedAddress}
              </Text>
            </Pressable>
          ))}
          {citySearch.data?.length === 0 && debouncedQuery.length >= 2 && !citySearch.isLoading ? (
            <Text style={[styles.pickerHint, { color: colors.faint }]}>No matches</Text>
          ) : null}
          {radiusRow}
        </View>
      )}
      {(reverseError || submitError) && (
        <Text style={[styles.errorText, { color: colors.accent }]}>
          {submitError ?? reverseError}
        </Text>
      )}
    </View>
  );

  const primaryLabel =
    mode.kind === 'resolved' ? 'Use this region' : 'Skip for now';
  const onPrimary =
    mode.kind === 'resolved' ? onUseDetected : advance;
  const secondaryLabel =
    mode.kind === 'resolved' ? 'Pick a different city' : 'Skip for now';
  const onSecondary =
    mode.kind === 'resolved' ? onSwitchToPicker : advance;

  return (
    <FirstRunStep
      step={pos.step}
      total={pos.total}
      eyebrow={`STEP ${pos.step} OF ${pos.total}`}
      title={
        <Text style={[heroTitleStyle, { color: colors.ink, textAlign: 'center' }]}>
          Your <Text style={{ color: colors.accent }}>home base.</Text>
        </Text>
      }
      body="We'll focus your daily email and Discover feed on shows here. You can add more regions later in Preferences."
      illustration={illustration}
      primaryLabel={primaryLabel}
      onPrimary={onPrimary}
      secondaryLabel={secondaryLabel}
      onSecondary={onSecondary}
      pending={addRegion.isPending}
    />
  );
}

const styles = StyleSheet.create({
  detectedBlock: {
    width: '100%',
    maxWidth: 320,
    alignItems: 'stretch',
    gap: 8,
  },
  detectedCard: {
    borderWidth: 1,
    borderRadius: RADII.lg,
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 8,
  },
  detectedCity: {
    fontFamily: 'Geist Sans 700',
    fontSize: 18,
  },
  detectedSub: {
    fontFamily: 'Geist Sans 400',
    fontSize: 12,
  },
  radiusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
    marginTop: 6,
  },
  radiusChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  radiusChipLabel: {
    fontFamily: 'Geist Sans 600',
    fontSize: 11,
    letterSpacing: 0.4,
  },
  pickerCard: {
    borderWidth: 1,
    borderRadius: RADII.lg,
    padding: 12,
    gap: 8,
  },
  pickerInput: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: RADII.md,
  },
  pickerOption: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderTopWidth: 1,
  },
  pickerOptionName: {
    fontFamily: 'Geist Sans 600',
    fontSize: 13,
  },
  pickerOptionMeta: {
    fontFamily: 'Geist Sans 400',
    fontSize: 10.5,
    marginTop: 1,
  },
  pickerHint: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  errorText: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },
});
